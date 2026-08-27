/**
 * Relayer nonce allocator (I-402).
 *
 * CLAUDE.md §8.3 names this as the component most likely to break the project
 * in production, and the reason is structural rather than subtle: Ethereum
 * nonces are strictly sequential per sender, so a single allocated-but-never-
 * landed nonce blocks every subsequent transaction from that relayer. One
 * user's stuck submission stalls all of them, and it only shows up under real
 * concurrency.
 *
 * The design:
 *
 *  - **Single writer, enforced by Postgres.** Allocation runs inside
 *    `pg_advisory_xact_lock` keyed on (chain, relayer), so concurrent workers
 *    serialise rather than race. The lock is transaction-scoped: it cannot be
 *    leaked by a crashing worker.
 *
 *  - **Persisted, and reconciled with the chain.** The counter survives
 *    restarts, and every allocation takes `max(persisted, chainPendingNonce)`.
 *    Never the minimum, and never a rewind: moving backwards would silently
 *    replace a transaction that is already in flight.
 *
 *  - **Holes are reclaimed, not burned.** A worker that dies between
 *    allocating and sending leaves an `ALLOCATED` row with no transaction.
 *    That nonce is reused after a visibility timeout, which is what keeps a
 *    crash from costing a permanent gap.
 *
 *  - **One live claim per nonce**, guaranteed by a unique partial index, not
 *    by this query being clever. See `002_corral_relayer.sql`.
 *
 * This module allocates and records. It never signs and never decides whether
 * a submission is allowed — the relayer holds gas only (SEC-16).
 */
import type { PoolClient } from "pg";

import { query, withTransaction } from "../db/pool.js";

export type RelayerTxStatus = "ALLOCATED" | "SENT" | "MINED" | "FAILED" | "ABANDONED";

export interface RelayerTx {
  readonly id: string;
  readonly chain_id: string;
  readonly relayer: string;
  readonly nonce: string;
  readonly execution_id: string | null;
  readonly session_id: string | null;
  readonly status: RelayerTxStatus;
  readonly tx_hash: string | null;
  readonly attempt: number;
  readonly max_fee: string | null;
  readonly max_priority: string | null;
  readonly allocated_at: Date;
  readonly sent_at: Date | null;
  readonly settled_at: Date | null;
  readonly last_error: string | null;
}

export interface AllocateInput {
  readonly chainId: number;
  readonly relayer: string;
  /**
   * `eth_getTransactionCount(relayer, "pending")`, read BEFORE the
   * transaction opens. Chain I/O never happens while the lock is held.
   */
  readonly chainPendingNonce: bigint;
  readonly executionId?: string | null;
  readonly sessionId?: string | null;
  /** How long an unsent allocation may sit before it is reclaimed. */
  readonly staleAfterMs?: number;
}

export interface Allocation {
  readonly id: string;
  readonly nonce: bigint;
  /** True when this reused a nonce abandoned by a crashed worker. */
  readonly reclaimed: boolean;
}

const DEFAULT_STALE_MS = 90_000;

/** Advisory-lock key for one relayer on one chain. */
async function lock(tx: PoolClient, chainId: number, relayer: string): Promise<void> {
  // Two 32-bit keys: the chain id, and a stable hash of the relayer address.
  await tx.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [chainId, relayer.toLowerCase()]);
}

/**
 * Allocate the next usable nonce for this relayer.
 *
 * Serialised against every other allocation for the same (chain, relayer).
 * Callers MUST subsequently call `markSent`, `markSettled` or `abandon` —
 * an allocation that is merely dropped is recovered by the stale sweep, but
 * only after the timeout, and every allocation behind it waits.
 */
export async function allocateNonce(input: AllocateInput): Promise<Allocation> {
  const relayer = input.relayer.toLowerCase();
  const staleMs = input.staleAfterMs ?? DEFAULT_STALE_MS;

  return withTransaction(async (tx) => {
    await lock(tx, input.chainId, relayer);

    // 1. Reclaim the lowest stale allocation first. Reusing a hole is always
    //    better than advancing past it: the gap would block everything after.
    const stale = await tx.query<{ id: string; nonce: string }>(
      `SELECT id, nonce FROM corral_relayer_txs
        WHERE chain_id = $1 AND relayer = $2 AND status = 'ALLOCATED'
          AND allocated_at < now() - make_interval(secs => $3)
        ORDER BY nonce
        LIMIT 1`,
      [input.chainId, relayer, staleMs / 1000],
    );
    const reclaim = stale.rows[0];
    if (reclaim) {
      await tx.query(
        `UPDATE corral_relayer_txs
            SET allocated_at = now(), attempt = 0, execution_id = $2, session_id = $3,
                last_error = 'reclaimed after stale allocation'
          WHERE id = $1`,
        [reclaim.id, input.executionId ?? null, input.sessionId ?? null],
      );
      return { id: reclaim.id, nonce: BigInt(reclaim.nonce), reclaimed: true };
    }

    // 2. Otherwise take the counter, reconciled forward against the chain.
    //    `max` and never `min`: the chain's pending count already includes
    //    anything we sent, and the counter may legitimately be ahead of it
    //    for allocations not yet broadcast.
    const persisted = await tx.query<{ next_nonce: string }>(
      `SELECT next_nonce FROM corral_relayer_nonces WHERE chain_id = $1 AND relayer = $2 FOR UPDATE`,
      [input.chainId, relayer],
    );
    const stored = persisted.rows[0] ? BigInt(persisted.rows[0].next_nonce) : 0n;
    const nonce = stored > input.chainPendingNonce ? stored : input.chainPendingNonce;

    await tx.query(
      `INSERT INTO corral_relayer_nonces (chain_id, relayer, next_nonce, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (chain_id, relayer)
       DO UPDATE SET next_nonce = EXCLUDED.next_nonce, updated_at = now()`,
      [input.chainId, relayer, (nonce + 1n).toString(10)],
    );

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO corral_relayer_txs (chain_id, relayer, nonce, execution_id, session_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.chainId, relayer, nonce.toString(10), input.executionId ?? null, input.sessionId ?? null],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("nonce allocation produced no row");
    return { id: row.id, nonce, reclaimed: false };
  });
}

export async function markSent(
  id: string,
  txHash: string,
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
): Promise<void> {
  await query(
    `UPDATE corral_relayer_txs
        SET status = 'SENT', tx_hash = $2, sent_at = now(),
            max_fee = $3, max_priority = $4, attempt = attempt + 1
      WHERE id = $1`,
    [id, txHash, fees.maxFeePerGas.toString(10), fees.maxPriorityFeePerGas.toString(10)],
  );
}

/** A replacement reuses the row and the nonce; only the hash and fees change. */
export async function markReplaced(
  id: string,
  txHash: string,
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
): Promise<void> {
  await markSent(id, txHash, fees);
}

export async function markSettled(id: string, outcome: "MINED" | "FAILED", detail?: string): Promise<void> {
  await query(`UPDATE corral_relayer_txs SET status = $2, settled_at = now(), last_error = $3 WHERE id = $1`, [
    id,
    outcome,
    detail ?? null,
  ]);
}

/**
 * Give up on an allocation. The nonce is released for reuse immediately —
 * this is the safe direction, because the alternative is a permanent hole.
 */
export async function abandon(id: string, reason: string): Promise<void> {
  await query(`UPDATE corral_relayer_txs SET status = 'ABANDONED', settled_at = now(), last_error = $2 WHERE id = $1`, [
    id,
    reason,
  ]);
}

/** Transactions sent but not settled after `olderThanMs` — candidates for replacement. */
export async function findStuck(chainId: number, relayer: string, olderThanMs: number): Promise<RelayerTx[]> {
  return query<RelayerTx>(
    `SELECT * FROM corral_relayer_txs
      WHERE chain_id = $1 AND relayer = $2 AND status = 'SENT'
        AND sent_at < now() - make_interval(secs => $3)
      ORDER BY nonce`,
    [chainId, relayer.toLowerCase(), olderThanMs / 1000],
  );
}

/**
 * The lowest live nonce that is blocking the queue, if any. Operationally
 * this is the number to alert on: while it stays constant, nothing this
 * relayer submits can land.
 */
export async function headOfLine(chainId: number, relayer: string): Promise<RelayerTx | null> {
  const rows = await query<RelayerTx>(
    `SELECT * FROM corral_relayer_txs
      WHERE chain_id = $1 AND relayer = $2 AND status IN ('ALLOCATED', 'SENT')
      ORDER BY nonce
      LIMIT 1`,
    [chainId, relayer.toLowerCase()],
  );
  return rows[0] ?? null;
}

/** In-flight depth for metrics. */
export async function inFlightCount(chainId: number, relayer: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM corral_relayer_txs
      WHERE chain_id = $1 AND relayer = $2 AND status IN ('ALLOCATED', 'SENT')`,
    [chainId, relayer.toLowerCase()],
  );
  return Number(rows[0]?.n ?? "0");
}
