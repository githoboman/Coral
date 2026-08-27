/**
 * Postgres job queue (spec §6.3, D12 — deliberately not Temporal).
 *
 * Guarantees:
 *  - At most one RUNNING job per session. Enforced by a unique partial index,
 *    not by the claim query — see `001_corral_execution.sql`. The claim also
 *    filters on RUNNING rows so the conflict path is rare; when it does fire
 *    the loser simply claims nothing.
 *  - Crashed workers are recovered by the visibility-timeout reaper.
 *  - Every job must be safe to run twice: the queue promises at-least-once
 *    delivery; at-most-once EXECUTION comes from the execution ledger's
 *    idempotency key, not from here.
 */
import { isUniqueViolation, query } from "../db/pool.js";

export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "DEAD";

export interface Job {
  readonly id: string;
  readonly kind: string;
  readonly session_id: string | null;
  readonly payload: Record<string, unknown>;
  readonly status: JobStatus;
  readonly run_at: Date;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly locked_at: Date | null;
  readonly locked_by: string | null;
  readonly last_error: string | null;
  readonly dedupe_key: string | null;
}

export interface EnqueueInput {
  readonly kind: string;
  readonly sessionId?: string | null;
  readonly payload?: Record<string, unknown>;
  /** Delay before the job becomes claimable. Default: immediately. */
  readonly runInMs?: number;
  readonly maxAttempts?: number;
  /** One live job per key. A scheduler tick that fires twice enqueues once. */
  readonly dedupeKey?: string;
}

/** Returns the job, or `null` when an identical live job already exists. */
export async function enqueue(input: EnqueueInput): Promise<Job | null> {
  try {
    const rows = await query<Job>(
      `INSERT INTO corral_jobs (kind, session_id, payload, run_at, max_attempts, dedupe_key)
       VALUES ($1, $2, $3::jsonb, now() + make_interval(secs => $4), $5, $6)
       RETURNING *`,
      [
        input.kind,
        input.sessionId ?? null,
        JSON.stringify(input.payload ?? {}),
        (input.runInMs ?? 0) / 1000,
        input.maxAttempts ?? 5,
        input.dedupeKey ?? null,
      ],
    );
    return rows[0] ?? null;
  } catch (e) {
    if (isUniqueViolation(e)) return null; // dedupe_key already live
    throw e;
  }
}

/**
 * Claim the oldest due job whose session has nothing running.
 *
 * `FOR UPDATE SKIP LOCKED` keeps concurrent workers off the same row. The
 * RUNNING-row filter is an optimisation; the unique index is the guarantee,
 * so a lost race surfaces as a unique violation and we simply try again —
 * by then the winner's RUNNING row excludes that session.
 */
export async function claim(workerId: string, attempts = 3): Promise<Job | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const rows = await query<Job>(
        `UPDATE corral_jobs
            SET status = 'RUNNING', locked_at = now(), locked_by = $1,
                attempt = attempt + 1, updated_at = now()
          WHERE id = (
            SELECT j.id FROM corral_jobs j
             WHERE j.status = 'PENDING'
               AND j.run_at <= now()
               AND (j.session_id IS NULL OR NOT EXISTS (
                     SELECT 1 FROM corral_jobs r
                      WHERE r.session_id = j.session_id AND r.status = 'RUNNING'))
             ORDER BY j.run_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1)
        RETURNING *`,
        [workerId],
      );
      return rows[0] ?? null;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Another worker won this session; loop and look for a different job.
    }
  }
  return null;
}

export async function complete(jobId: string): Promise<void> {
  await query(`UPDATE corral_jobs SET status = 'DONE', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1`, [jobId]);
}

/**
 * Record a failure. `retryInMs === null` (or attempts exhausted) sends the job
 * to the dead-letter state — which is exactly what a terminal policy rejection
 * must do: never retried, never worked around (CLAUDE.md §2.4).
 */
export async function fail(jobId: string, error: string, retryInMs: number | null): Promise<JobStatus> {
  const rows = await query<{ status: JobStatus }>(
    `UPDATE corral_jobs
        SET status = CASE
              WHEN $2::double precision IS NULL THEN 'DEAD'
              WHEN attempt >= max_attempts     THEN 'DEAD'
              ELSE 'PENDING' END,
            run_at = CASE WHEN $2::double precision IS NULL THEN run_at
                          ELSE now() + make_interval(secs => $2 / 1000.0) END,
            last_error = left($3, 2000),
            locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE id = $1
      RETURNING status`,
    [jobId, retryInMs, error],
  );
  return rows[0]?.status ?? "DEAD";
}

/**
 * Visibility timeout: return jobs whose worker died mid-run to PENDING so
 * another worker can pick them up. Safe because every handler is idempotent
 * and the execution ledger is the real at-most-once guard.
 */
export async function reapStale(visibilityTimeoutMs: number): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE corral_jobs
        SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
            last_error = coalesce(last_error, 'reclaimed after visibility timeout'), updated_at = now()
      WHERE status = 'RUNNING'
        AND locked_at < now() - make_interval(secs => $1 / 1000.0)
      RETURNING id`,
    [visibilityTimeoutMs],
  );
  return rows.length;
}

export interface QueueDepth {
  readonly pending: number;
  readonly running: number;
  readonly dead: number;
}

export async function depth(): Promise<QueueDepth> {
  const rows = await query<{ status: JobStatus; n: string }>(`SELECT status, count(*)::text AS n FROM corral_jobs GROUP BY status`);
  const get = (s: JobStatus): number => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { pending: get("PENDING"), running: get("RUNNING"), dead: get("DEAD") };
}

/** Exponential backoff with full jitter, capped. */
export function backoffMs(attempt: number, baseMs = 2_000, capMs = 5 * 60_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exp);
}
