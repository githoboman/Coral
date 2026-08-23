/**
 * Owner-initiated session install (T-008, FR-1.3, CLAUDE.md §2.2/§2.3).
 *
 * Flow: account (address depends only on owner + salt, never on a session)
 * → compose(policy, account) → first userOp, signed by the OWNER, that
 * deploys the account (initCode), installs the SmartSessions validator with
 * this session, and journals the install → submitted through our own
 * relayer → post-install read-back verification. Only a zero-mismatch
 * verification yields ACTIVE. For an already-deployed account the same
 * userOp simply omits the initCode.
 *
 * This is the ONLY module that creates sessions, and it runs only from an
 * owner-signed flow. The planner, adapters, jobs and relayer have no path
 * here (§2.3, CI-enforced by the enableSessions grep).
 */
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { UserOperation } from "viem/account-abstraction";
import { getSmartSessionsValidator } from "@rhinestone/module-sdk";

import { corralJournalAbi } from "../abi/corralJournal.js";
import type { CorralAccount } from "../account.js";
import type { ChainAddresses } from "../addresses.js";
import { submitViaHandleOps, type SubmitResult } from "../relayer/handleOps.js";
import type { ComposedSession } from "./compose.js";
import { verifyInstalledSession, type VerifyResult } from "./verify.js";

export type InstallStatus = "ACTIVE" | "PAUSED_MISMATCH" | "SUBMISSION_FAILED";

export interface InstallParams {
  readonly client: PublicClient;
  /** The owner's account (built by createCorralAccount; the owner key signs the userOp). */
  readonly account: CorralAccount;
  /** Composed against `account.address`. */
  readonly composed: ComposedSession;
  readonly addresses: ChainAddresses;
  /** Our relayer EOA (D13). Pays gas; cannot widen policy. */
  readonly relayer: WalletClient;
  /** Testnet gas ceilings; the production relayer estimates (later ticket). */
  readonly gas?: { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint };
}

export interface InstallResult {
  readonly status: InstallStatus;
  readonly permissionId: Hex;
  readonly submission: SubmitResult | null;
  readonly verification: VerifyResult | null;
  readonly error?: string;
}

/** Intent hash journaled for the install itself — a fixed, documented sentinel. */
export const INSTALL_INTENT_HASH: Hex = keccak256(stringToHex("corral.session.install.v1"));

/** ERC-7579 module type id for validators. */
const MODULE_TYPE_VALIDATOR = 1n;

const erc7579InstallAbi = [
  {
    type: "function",
    name: "installModule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "moduleTypeId", type: "uint256" },
      { name: "module", type: "address" },
      { name: "initData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const DEFAULT_GAS = { callGasLimit: 3_000_000n, verificationGasLimit: 3_500_000n, preVerificationGas: 300_000n };

/** The two calls of the install userOp: install SmartSessions with the session, then journal it. */
export function installCalls(account: Address, composed: ComposedSession, addresses: ChainAddresses) {
  // useRegistry mirrors the chain's registry-gating config: with it on,
  // SmartSessions also requires every policy to be attested at enable time.
  const validator = getSmartSessionsValidator({ sessions: [composed.session], useRegistry: addresses.registryGating !== null });
  return [
    {
      to: account,
      value: 0n,
      data: encodeFunctionData({
        abi: erc7579InstallAbi,
        functionName: "installModule",
        args: [MODULE_TYPE_VALIDATOR, addresses.smartSessions.address, validator.initData],
      }),
    },
    {
      to: addresses.corralJournal.address,
      value: 0n,
      data: encodeFunctionData({
        abi: corralJournalAbi,
        functionName: "log",
        args: [composed.permissionId, INSTALL_INTENT_HASH, `0x${"0".repeat(64)}`, 0],
      }),
    },
  ];
}

/**
 * Read-after-write on load-balanced RPCs can lag a block or two; verify
 * with bounded retries before judging (ops finding, session 7).
 */
async function verifyWithRetry(client: PublicClient, addresses: ChainAddresses, composed: ComposedSession): Promise<VerifyResult> {
  let last: VerifyResult = { ok: false, mismatches: [{ what: "unverified", expected: "", actual: "" }] };
  for (let attempt = 1; attempt <= 6; attempt++) {
    last = await verifyInstalledSession(client, addresses, composed.expectation);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return last;
}

export async function installSession(params: InstallParams): Promise<InstallResult> {
  const { client, account, composed, addresses } = params;
  const gas = params.gas ?? DEFAULT_GAS;
  const permissionId = composed.permissionId;

  if (account.address.toLowerCase() !== composed.expectation.account.toLowerCase()) {
    throw new Error(`session composed for ${composed.expectation.account} but account is ${account.address}`);
  }

  const inner = account.inner;
  const deployed = await account.isDeployed();
  const factoryArgs = deployed ? null : await account.getFactoryArgs();
  const nonce = await inner.getNonce();
  const callData = await inner.encodeCalls(installCalls(account.address, composed, addresses));
  const fees = await client.estimateFeesPerGas();

  const unsigned: UserOperation<"0.7"> = {
    sender: account.address,
    nonce,
    ...(factoryArgs ? { factory: factoryArgs.factory, factoryData: factoryArgs.factoryData } : {}),
    callData,
    callGasLimit: gas.callGasLimit,
    verificationGasLimit: gas.verificationGasLimit,
    preVerificationGas: gas.preVerificationGas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    signature: "0x",
  };
  // The OWNER signs: session installation is owner-initiated, always (§2.3).
  const signature = await inner.signUserOperation(unsigned);
  const userOp: UserOperation<"0.7"> = { ...unsigned, signature };

  let submission: SubmitResult;
  try {
    submission = await submitViaHandleOps({ client, relayer: params.relayer, entryPoint: addresses.entryPoint.address, userOp });
  } catch (e) {
    return { status: "SUBMISSION_FAILED", permissionId, submission: null, verification: null, error: e instanceof Error ? e.message : String(e) };
  }
  if (!submission.txSuccess) {
    return { status: "SUBMISSION_FAILED", permissionId, submission, verification: null, error: "handleOps tx reverted" };
  }
  if (!submission.opSuccess) {
    // The tx landed but the operation's execution reverted: nothing was
    // installed. Surface the EntryPoint-reported reason; do not verify.
    return {
      status: "SUBMISSION_FAILED",
      permissionId,
      submission,
      verification: null,
      error: `userOp execution reverted (UserOperationEvent.success=false), reason ${submission.opRevertReason ?? "0x"}`,
    };
  }

  const verification = await verifyWithRetry(client, addresses, composed);
  return { status: verification.ok ? "ACTIVE" : "PAUSED_MISMATCH", permissionId, submission, verification };
}
