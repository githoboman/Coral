/**
 * Production relayer submission (I-401 hardened, I-403, I-406).
 *
 * Wraps `handleOps` with the three things the testnet path did not have:
 * an allocated, persisted nonce; replace-by-fee for a transaction that does
 * not land; and an independent refusal to submit for a session that is no
 * longer executable.
 *
 * That last one matters more than it looks. Revocation disables the signer
 * first, so nothing new gets signed — but a userOp signed one second earlier
 * may still be sitting in this function. Because we run our own relayer and
 * there is no shared mempool (D13), this check is the final gate: refusing
 * here means the operation never reaches the chain at all. It is also why the
 * revocation guarantee is stated as "our own submission latency" rather than
 * "instant" (CLAUDE.md §10) — the window is this function, and nothing else.
 *
 * The relayer key is hot and holds gas only. It cannot widen a policy and
 * cannot choose what to submit; it receives a signed operation and sends it
 * (SEC-16).
 */
import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { entryPoint07Abi, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";

import { getSession, isExecutable } from "../sessions/repository.js";
import { bumpFees, FeeCeilingExceeded, initialFees, type Fees } from "./fees.js";
import { abandon, allocateNonce, markSent, markSettled } from "./nonces.js";

export class SubmissionRefused extends Error {
  constructor(readonly reason: string) {
    super(`relayer refused to submit: ${reason}`);
    this.name = "SubmissionRefused";
  }
}

export interface RelayedResult {
  readonly txHash: Hex;
  readonly nonce: bigint;
  readonly blockNumber: bigint;
  readonly txSuccess: boolean;
  /** The user operation's own outcome — never inferred from the tx status. */
  readonly opSuccess: boolean;
  readonly opRevertReason: Hex | null;
  readonly userOpHash: Hex | null;
  readonly gasUsed: bigint;
  /** How many transactions were broadcast for this nonce (1 = landed first try). */
  readonly attempts: number;
}

export interface RelayParams {
  readonly client: PublicClient;
  readonly relayer: WalletClient;
  readonly entryPoint: Address;
  readonly userOp: UserOperation<"0.7">;
  readonly chainId: number;
  /** Re-checked immediately before broadcast; a revoked session is refused. */
  readonly sessionId: string;
  readonly executionId?: string | null;
  /** How long to wait for inclusion before replacing by fee. */
  readonly stuckAfterMs?: number;
  /** Maximum replacement attempts before giving up and reporting. */
  readonly maxAttempts?: number;
}

const DEFAULT_STUCK_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 4;

async function marketFees(client: PublicClient): Promise<Fees> {
  const est = await client.estimateFeesPerGas();
  return {
    maxFeePerGas: est.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: est.maxPriorityFeePerGas ?? 0n,
  };
}

function decodeOpOutcome(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], entryPoint: Address): {
  opSuccess: boolean;
  opRevertReason: Hex | null;
  userOpHash: Hex | null;
} {
  let opSuccess = false;
  let opRevertReason: Hex | null = null;
  let userOpHash: Hex | null = null;
  for (const log of logs) {
    if (log.address.toLowerCase() !== entryPoint.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({
        abi: entryPoint07Abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (ev.eventName === "UserOperationEvent") {
        opSuccess = ev.args.success;
        userOpHash = ev.args.userOpHash;
      } else if (ev.eventName === "UserOperationRevertReason") {
        opRevertReason = ev.args.revertReason;
      }
    } catch {
      // not an EntryPoint event we model
    }
  }
  return { opSuccess, opRevertReason, userOpHash };
}

/**
 * Submit a signed user operation, replacing it by fee until it lands or the
 * attempt/fee ceiling is reached.
 *
 * The nonce is allocated once and reused for every replacement — that is the
 * point of replace-by-fee. Allocating a second nonce for a retry would leave
 * the first one as a hole, which is the failure this whole subsystem exists
 * to prevent.
 */
export async function submitRelayed(p: RelayParams): Promise<RelayedResult> {
  const account = p.relayer.account;
  if (!account) throw new Error("relayer wallet has no account");

  // Final gate. The signer already refused anything new; this catches an
  // operation signed just before revocation and still in our hands.
  const session = await getSession(p.sessionId);
  if (!session) throw new SubmissionRefused("unknown session");
  const gate = isExecutable(session);
  if (!gate.ok) throw new SubmissionRefused(gate.reason);

  const packed = toPackedUserOperation(p.userOp);
  const args = [[packed], account.address] as const;

  // Simulate before burning a nonce, so an EntryPoint FailedOp surfaces with
  // its reason instead of as an opaque on-chain revert — and so a doomed
  // operation never consumes a sequence number at all.
  await p.client.simulateContract({
    address: p.entryPoint,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args,
    account,
  });

  // Chain read happens BEFORE the allocator opens its transaction; no chain
  // I/O ever runs while the advisory lock is held.
  const chainPendingNonce = BigInt(
    await p.client.getTransactionCount({ address: account.address, blockTag: "pending" }),
  );
  const allocation = await allocateNonce({
    chainId: p.chainId,
    relayer: account.address,
    chainPendingNonce,
    executionId: p.executionId ?? null,
    sessionId: p.sessionId,
  });

  const stuckAfterMs = p.stuckAfterMs ?? DEFAULT_STUCK_MS;
  const maxAttempts = p.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let fees = initialFees(await marketFees(p.client));
  let attempts = 0;
  let lastHash: Hex | null = null;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const txHash = await p.relayer.writeContract({
        address: p.entryPoint,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args,
        account,
        chain: p.relayer.chain,
        nonce: Number(allocation.nonce),
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      attempts += 1;
      lastHash = txHash;
      await markSent(allocation.id, txHash, fees);

      try {
        const receipt = await p.client.waitForTransactionReceipt({ hash: txHash, timeout: stuckAfterMs });
        const outcome = decodeOpOutcome(receipt.logs, p.entryPoint);
        await markSettled(allocation.id, receipt.status === "success" ? "MINED" : "FAILED");
        return {
          txHash,
          nonce: allocation.nonce,
          blockNumber: receipt.blockNumber,
          txSuccess: receipt.status === "success",
          gasUsed: receipt.gasUsed,
          attempts,
          ...outcome,
        };
      } catch {
        // Not mined in time. A replacement reusing this nonce either lands or
        // is rejected as a duplicate because the original just landed — both
        // outcomes are recoverable. Leaving it alone is not: the nonce stays
        // blocked and every later submission queues behind it.
        if (attempt === maxAttempts - 1) break;
        fees = bumpFees(fees, await marketFees(p.client));
      }
    }
  } catch (e) {
    if (e instanceof FeeCeilingExceeded) {
      // Deliberately not escalated further. A stuck transaction at the fee
      // ceiling is an operational decision, not one to make automatically.
      await markSettled(allocation.id, "FAILED", e.message);
      throw e;
    }
    await abandon(allocation.id, e instanceof Error ? e.message : String(e));
    throw e;
  }

  await markSettled(
    allocation.id,
    "FAILED",
    `not included after ${String(attempts)} attempts (last ${lastHash ?? "none"})`,
  );
  throw new Error(
    `relayer transaction for nonce ${allocation.nonce.toString(10)} was not included after ${String(attempts)} attempts`,
  );
}
