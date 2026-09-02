/**
 * Agent execution: a compiled batch, signed by the session signer, submitted
 * through our relayer (FR-4.x, spec §7 steps 9–11).
 *
 * The agent's authority is exactly the session: the userOp nonce selects the
 * SmartSessions validator (`nonce >> 96`), and the signature envelope names
 * the permissionId. Everything the op may do is decided on-chain by the
 * policies installed at T-008 — this module cannot widen anything (§2.3).
 */
import { decodeEventLog, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { entryPoint07Abi, getUserOperationHash, type UserOperation } from "viem/account-abstraction";

import { corralJournalAbi } from "../abi/corralJournal.js";
import type { ChainAddresses } from "../addresses.js";
import { submitViaHandleOps, type SubmitResult } from "../relayer/handleOps.js";
import { encodeUseSignature, type SessionSigner } from "./sessionSigner.js";

export interface SessionOpParams {
  readonly client: PublicClient;
  readonly addresses: ChainAddresses;
  readonly account: Address;
  readonly permissionId: Hex;
  readonly signer: SessionSigner;
  readonly callData: Hex;
  readonly gas?: { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint };
}

const DEFAULT_GAS = { callGasLimit: 1_500_000n, verificationGasLimit: 1_500_000n, preVerificationGas: 150_000n };

/** EntryPoint nonce key that routes validation to SmartSessions on a Safe7579 account. */
export function sessionNonceKey(smartSessions: Address): bigint {
  return BigInt(smartSessions) << 32n;
}

/** Build and sign the agent userOp. Pure except for nonce + fee reads. */
export async function buildSessionUserOp(p: SessionOpParams): Promise<UserOperation<"0.7">> {
  const gas = p.gas ?? DEFAULT_GAS;
  const nonce = await p.client.readContract({
    address: p.addresses.entryPoint.address,
    abi: entryPoint07Abi,
    functionName: "getNonce",
    args: [p.account, sessionNonceKey(p.addresses.smartSessions.address)],
  });
  const fees = await p.client.estimateFeesPerGas();
  const unsigned: UserOperation<"0.7"> = {
    sender: p.account,
    nonce,
    callData: p.callData,
    callGasLimit: gas.callGasLimit,
    verificationGasLimit: gas.verificationGasLimit,
    preVerificationGas: gas.preVerificationGas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    signature: "0x",
  };
  const chainId = p.client.chain?.id;
  if (chainId === undefined) throw new Error("client must have a chain");
  const hash = getUserOperationHash({ userOperation: unsigned, entryPointAddress: p.addresses.entryPoint.address, entryPointVersion: "0.7", chainId });
  const sig = await p.signer.signHash(hash);
  return { ...unsigned, signature: encodeUseSignature(p.permissionId, sig) };
}

export interface JournalEntry {
  readonly sessionId: Hex;
  readonly intentHash: Hex;
  readonly strategyId: Hex;
  readonly seq: number;
  readonly timestamp: bigint;
}

/**
 * How a signed op reaches the chain. Defaults to the direct `handleOps` call;
 * the engine injects the hardened relayer (allocated nonce, replace-by-fee,
 * revocation refusal) instead. Kept as an injection point so this module —
 * and the scripts that use it — stay free of any database dependency.
 */
export type SubmitFn = (args: {
  readonly client: PublicClient;
  readonly relayer: WalletClient;
  readonly entryPoint: Address;
  readonly userOp: UserOperation<"0.7">;
}) => Promise<SubmitResult>;

export interface ExecutionOutcome {
  readonly submission: SubmitResult;
  /** The journal entry emitted by this op, if execution succeeded. */
  readonly journal: JournalEntry | null;
}

/** Submit a signed session op via our relayer and read back its journal entry. */
export async function executeSessionUserOp(
  p: { client: PublicClient; relayer: WalletClient; addresses: ChainAddresses; submit?: SubmitFn },
  userOp: UserOperation<"0.7">,
): Promise<ExecutionOutcome> {
  const submit = p.submit ?? submitViaHandleOps;
  const submission = await submit({ client: p.client, relayer: p.relayer, entryPoint: p.addresses.entryPoint.address, userOp });
  let journal: JournalEntry | null = null;
  if (submission.opSuccess) {
    const receipt = await p.client.getTransactionReceipt({ hash: submission.txHash });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== p.addresses.corralJournal.address.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: corralJournalAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Logged" && ev.args.account.toLowerCase() === userOp.sender.toLowerCase()) {
          journal = { sessionId: ev.args.sessionId, intentHash: ev.args.intentHash, strategyId: ev.args.strategyId, seq: ev.args.seq, timestamp: ev.args.timestamp };
        }
      } catch {
        // not a Logged event
      }
    }
  }
  return { submission, journal };
}
