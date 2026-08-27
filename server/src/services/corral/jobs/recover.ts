/**
 * `execution.recover` (C-504) — resolve executions stranded in SUBMITTED.
 *
 * A row is SUBMITTED between "we broadcast" and "we saw the receipt". A worker
 * that dies in that gap leaves a row nobody will ever finish, and — worse — a
 * budget that the chain has already spent but the mirror still shows as
 * available. The recovery rule is the same one the whole system uses: **the
 * chain decides**. We never guess an outcome from our own records.
 *
 * Three possible truths for a stranded row:
 *   - the transaction landed          → record its real outcome
 *   - the transaction is still queued → leave it alone, look again later
 *   - it never existed / was dropped  → mark it ABORTED so the slot is closed
 *
 * What this must never do is re-submit. The idempotency key is already
 * consumed; re-planning that slot is precisely the double execution NFR-7
 * forbids.
 */
import { decodeEventLog, type Hex, type PublicClient } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

import type { ChainAddresses } from "../../evm/addresses.js";
import { query } from "../db/pool.js";
import { markIncluded, markRejected } from "../executions/ledger.js";
import { recordAnomaly } from "../reconcile/budget.js";

export interface StrandedExecution {
  readonly id: string;
  readonly session_id: string;
  readonly tx_hash: string | null;
  /** The row is keyed off `updated_at`, which is what the in-flight index in
   *  migration 001 was created for. */
  readonly updated_at: Date;
}

export interface RecoveryOutcome {
  readonly executionId: string;
  readonly resolution: "INCLUDED" | "FAILED" | "STILL_PENDING" | "ABANDONED";
  readonly txHash: string | null;
}

/** Executions left in SUBMITTED longer than a worker could plausibly still be alive. */
export async function findStranded(olderThanMs: number, limit = 50): Promise<StrandedExecution[]> {
  return query<StrandedExecution>(
    `SELECT id, session_id, tx_hash, updated_at
       FROM corral_executions
      WHERE status = 'SUBMITTED'
        AND updated_at < now() - make_interval(secs => $1)
      ORDER BY updated_at
      LIMIT $2`,
    [olderThanMs / 1000, limit],
  );
}

function opOutcome(
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[],
  entryPoint: string,
): { success: boolean; revertReason: Hex | null } {
  let success = false;
  let revertReason: Hex | null = null;
  for (const log of logs) {
    if (log.address.toLowerCase() !== entryPoint.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: entryPoint07Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "UserOperationEvent") success = ev.args.success;
      else if (ev.eventName === "UserOperationRevertReason") revertReason = ev.args.revertReason;
    } catch {
      // not an EntryPoint event we model
    }
  }
  return { success, revertReason };
}

/**
 * Resolve one stranded execution against the chain.
 *
 * `abandonAfterMs` bounds how long a row with no transaction hash — or with a
 * hash the chain has never heard of — stays open. Closing it is safe: the
 * execution ledger keeps the slot consumed, so nothing re-plans it.
 */
export async function recoverExecution(
  client: PublicClient,
  addresses: ChainAddresses,
  row: StrandedExecution,
  abandonAfterMs = 30 * 60_000,
): Promise<RecoveryOutcome> {
  const ageMs = Date.now() - row.updated_at.getTime();

  if (!row.tx_hash) {
    // Signed and recorded, but we have no evidence it was ever broadcast.
    if (ageMs < abandonAfterMs) return { executionId: row.id, resolution: "STILL_PENDING", txHash: null };
    await markRejected(row.id, "RELAYER_TIMEOUT", "no transaction hash recorded; abandoned by recovery", "ABORTED");
    await recordAnomaly(row.session_id, "EXECUTION_ABANDONED", { executionId: row.id, reason: "no tx hash" });
    return { executionId: row.id, resolution: "ABANDONED", txHash: null };
  }

  let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>> | null = null;
  try {
    receipt = await client.getTransactionReceipt({ hash: row.tx_hash as Hex });
  } catch {
    receipt = null; // not mined, or not known to this node
  }

  if (!receipt) {
    if (ageMs < abandonAfterMs) return { executionId: row.id, resolution: "STILL_PENDING", txHash: row.tx_hash };
    // Dropped from the mempool. The nonce is handled by the relayer's own
    // sweep; here we only close the ledger row.
    await markRejected(row.id, "RELAYER_TIMEOUT", `transaction ${row.tx_hash} never mined`, "ABORTED");
    await recordAnomaly(row.session_id, "EXECUTION_ABANDONED", { executionId: row.id, txHash: row.tx_hash });
    return { executionId: row.id, resolution: "ABANDONED", txHash: row.tx_hash };
  }

  const { success, revertReason } = opOutcome(receipt.logs, addresses.entryPoint.address);
  await markIncluded(row.id, {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    opSuccess: success && receipt.status === "success",
    errorCode: success && receipt.status === "success" ? null : "SIMULATION_REVERT",
    errorDetail: revertReason ?? (receipt.status === "success" ? null : "transaction reverted"),
  });
  return {
    executionId: row.id,
    resolution: success && receipt.status === "success" ? "INCLUDED" : "FAILED",
    txHash: receipt.transactionHash,
  };
}

/** Sweep every stranded execution. Safe to run concurrently and repeatedly. */
export async function recoverStranded(
  client: PublicClient,
  addresses: ChainAddresses,
  olderThanMs = 2 * 60_000,
): Promise<RecoveryOutcome[]> {
  const rows = await findStranded(olderThanMs);
  const out: RecoveryOutcome[] = [];
  for (const row of rows) {
    out.push(await recoverExecution(client, addresses, row));
  }
  return out;
}
