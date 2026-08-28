/**
 * The execution ledger — the commit point of the pipeline (spec §7 step 8).
 *
 * `claimExecutionSlot` inserts the idempotency key BEFORE anything is signed.
 * The UNIQUE constraint is the concurrency control: a duplicate attempt for
 * the same (session, strategy, scheduled slot, seq) cannot insert, therefore
 * cannot sign, therefore cannot double-execute (NFR-7 — non-negotiable).
 *
 * After the commit point, failure is recovered by READING this row and
 * reconciling against the chain — never by re-planning from scratch.
 */
import type { ErrorCode } from "@corral/core";

import { isUniqueViolation, query } from "../db/pool.js";

export type ExecutionStatus =
  | "PLANNED"
  | "SIMULATED"
  | "SUBMITTED"
  | "INCLUDED"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "ABORTED"
  | "EXPIRED";

export interface ExecutionRow {
  readonly id: string;
  readonly session_id: string;
  readonly strategy_id: string | null;
  readonly idempotency_key: string;
  readonly seq: number;
  readonly scheduled_for: Date;
  readonly status: ExecutionStatus;
  readonly plan: Record<string, unknown> | null;
  readonly intent_hash: string | null;
  readonly user_op_hash: string | null;
  readonly tx_hash: string | null;
  readonly error_code: string | null;
  readonly error_detail: string | null;
  readonly attempts: number;
  readonly block_number: string | null;
  // Trade detail, filled by the indexer from chain logs (C-701).
  readonly asset_in: string | null;
  readonly amount_in: string | null;
  readonly asset_out: string | null;
  readonly quoted_out: string | null;
  readonly realised_out: string | null;
  readonly slippage_bps: number | null;
  readonly venue: string | null;
  // Gas, always apart from the asset amounts above (FR-6.5).
  readonly gas_used: string | null;
  readonly gas_price_wei: string | null;
  readonly gas_cost_wei: string | null;
  readonly gas_paid_by: string | null;
}

export interface SlotInput {
  readonly sessionId: string;
  readonly strategyId: string | null;
  /** The scheduled slot this execution belongs to (not "now"). */
  readonly scheduledFor: Date;
  readonly seq: number;
}

/** Stable across retries and workers: the same slot always yields the same key. */
export function idempotencyKey(input: SlotInput): string {
  return `${input.sessionId}:${input.strategyId ?? "none"}:${input.scheduledFor.toISOString()}:${input.seq}`;
}

/**
 * Reserve the slot. `null` means another worker already owns it — the correct
 * response is to stop, not to retry or re-plan.
 */
export async function claimExecutionSlot(input: SlotInput): Promise<ExecutionRow | null> {
  try {
    const rows = await query<ExecutionRow>(
      `INSERT INTO corral_executions (session_id, strategy_id, idempotency_key, seq, scheduled_for, status)
       VALUES ($1, $2, $3, $4, $5, 'PLANNED')
       RETURNING *`,
      [input.sessionId, input.strategyId, idempotencyKey(input), input.seq, input.scheduledFor],
    );
    return rows[0] ?? null;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

export async function getExecution(id: string): Promise<ExecutionRow | null> {
  const rows = await query<ExecutionRow>(`SELECT * FROM corral_executions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface SimulatedInput {
  readonly plan: Record<string, unknown>;
  readonly intentHash: string;
  readonly callDataHash: string;
  readonly assetIn: string;
  readonly amountIn: bigint;
  readonly assetOut: string;
  readonly quotedOut: bigint;
  readonly venue: string;
}

/** Preflight passed; the plan is fixed. Recorded before signing (FR-4.8). */
export async function markSimulated(id: string, i: SimulatedInput): Promise<void> {
  await query(
    `UPDATE corral_executions
        SET status = 'SIMULATED', plan = $2::jsonb, intent_hash = $3, call_data_hash = $4,
            asset_in = $5, amount_in = $6::numeric, asset_out = $7, quoted_out = $8::numeric,
            venue = $9, attempts = attempts + 1, updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(i.plan), i.intentHash, i.callDataHash, i.assetIn, i.amountIn.toString(), i.assetOut, i.quotedOut.toString(), i.venue],
  );
}

export async function markSubmitted(id: string, userOpHash: string, txHash: string | null): Promise<void> {
  await query(`UPDATE corral_executions SET status = 'SUBMITTED', user_op_hash = $2, tx_hash = $3, updated_at = now() WHERE id = $1`, [id, userOpHash, txHash]);
}

export interface IncludedInput {
  readonly txHash: string;
  readonly blockNumber: bigint;
  readonly gasUsed: bigint;
  readonly opSuccess: boolean;
  readonly realisedOut?: bigint | null;
  readonly slippageBps?: number | null;
  readonly errorCode?: ErrorCode | null;
  readonly errorDetail?: string | null;
}

export async function markIncluded(id: string, i: IncludedInput): Promise<void> {
  await query(
    `UPDATE corral_executions
        SET status = $2, tx_hash = $3, block_number = $4, gas_used = $5::numeric,
            realised_out = $6::numeric, slippage_bps = $7, error_code = $8, error_detail = left($9, 2000), updated_at = now()
      WHERE id = $1`,
    [
      id,
      i.opSuccess ? "SUCCEEDED" : "FAILED",
      i.txHash,
      i.blockNumber.toString(),
      i.gasUsed.toString(),
      i.realisedOut?.toString() ?? null,
      i.slippageBps ?? null,
      i.errorCode ?? null,
      i.errorDetail ?? null,
    ],
  );
}

/**
 * A policy rejection or an aborted attempt. Terminal: `REJECTED` rows are
 * never retried (CLAUDE.md §2.4).
 */
export async function markRejected(id: string, code: ErrorCode, detail: string, status: "REJECTED" | "ABORTED" = "REJECTED"): Promise<void> {
  await query(`UPDATE corral_executions SET status = $2, error_code = $3, error_detail = left($4, 2000), updated_at = now() WHERE id = $1`, [id, status, code, detail]);
}

/** Rows the recovery job resolves: past the commit point, outcome unknown. */
export async function findInFlight(olderThanMs: number, limit = 50): Promise<ExecutionRow[]> {
  return query<ExecutionRow>(
    `SELECT * FROM corral_executions
      WHERE status IN ('SIMULATED','SUBMITTED')
        AND updated_at < now() - make_interval(secs => $1 / 1000.0)
      ORDER BY updated_at
      LIMIT $2`,
    [olderThanMs, limit],
  );
}

export async function listExecutions(sessionId: string, limit = 50): Promise<ExecutionRow[]> {
  return query<ExecutionRow>(`SELECT * FROM corral_executions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`, [sessionId, limit]);
}
