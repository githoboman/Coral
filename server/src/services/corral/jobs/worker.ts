/**
 * The worker loop and the scheduler tick (spec §6.3).
 *
 * Every handler must be safe to run twice: the queue is at-least-once, and
 * at-most-once *execution* comes from the ledger's idempotency key. The loop
 * itself owns only claiming, dispatching, and applying the retry decision.
 */
import type { ErrorCode } from "@corral/core";

import { query } from "../db/pool.js";
import { decideRetry } from "../pipeline/retry.js";
import { claim, complete, enqueue, fail, reapStale, type Job } from "./queue.js";

export type JobHandler = (job: Job) => Promise<HandlerResult>;
export type HandlerResult =
  | { readonly kind: "DONE"; readonly note?: string }
  /** A typed failure; the retry class decides what the queue does next. */
  | { readonly kind: "FAILED"; readonly code: ErrorCode; readonly detail: string; readonly nextWindowMs?: number }
  /** An untyped crash: treated as transient infrastructure, bounded by attempts. */
  | { readonly kind: "ERROR"; readonly detail: string };

export interface WorkerOptions {
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly workerId: string;
  readonly pollIntervalMs?: number;
  readonly visibilityTimeoutMs?: number;
  /** Stop when this returns true (tests, graceful shutdown). */
  readonly shouldStop?: () => boolean;
}

/** Run one claim-and-dispatch cycle. Returns false when there was nothing to do. */
export async function runOnce(opts: WorkerOptions): Promise<boolean> {
  const job = await claim(opts.workerId);
  if (!job) return false;

  const handler = opts.handlers[job.kind];
  if (!handler) {
    await fail(job.id, `no handler for kind '${job.kind}'`, null);
    return true;
  }

  let result: HandlerResult;
  try {
    result = await handler(job);
  } catch (e) {
    result = { kind: "ERROR", detail: e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e) };
  }

  if (result.kind === "DONE") {
    await complete(job.id);
    return true;
  }
  if (result.kind === "FAILED") {
    const decision = decideRetry(result.code, { attempt: job.attempt, nextWindowMs: result.nextWindowMs ?? 3_600_000 });
    await fail(job.id, `${result.code}: ${result.detail} (${decision.reason})`, decision.retryInMs);
    return true;
  }
  // Unclassified crash: transient by assumption, bounded by max_attempts.
  await fail(job.id, result.detail, Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempt - 1)));
  return true;
}

/** Long-running loop. Reaps stale jobs between idle polls. */
export async function runWorker(opts: WorkerOptions): Promise<void> {
  const poll = opts.pollIntervalMs ?? 1_000;
  const visibility = opts.visibilityTimeoutMs ?? 5 * 60_000;
  while (!opts.shouldStop?.()) {
    const did = await runOnce(opts);
    if (!did) {
      await reapStale(visibility).catch(() => 0);
      await new Promise((r) => setTimeout(r, poll));
    }
  }
}

interface DueStrategy {
  readonly id: string;
  readonly session_id: string;
  readonly next_run_at: Date;
}

/**
 * `strategy.tick` (every minute): enqueue one execution job per due strategy.
 * The dedupe key is the scheduled slot, so a tick that fires twice — or two
 * schedulers running at once — still enqueues exactly one job per slot.
 */
export async function scheduleDueStrategies(limit = 100): Promise<number> {
  const due = await query<DueStrategy>(
    `SELECT s.id, s.session_id, s.next_run_at
       FROM corral_strategies s
       JOIN corral_sessions ses ON ses.id = s.session_id
      WHERE s.status = 'ACTIVE'
        AND s.next_run_at <= now()
        AND ses.status = 'ACTIVE'
        AND NOT ses.signer_disabled
      ORDER BY s.next_run_at
      LIMIT $1`,
    [limit],
  );

  let enqueued = 0;
  for (const s of due) {
    const slot = s.next_run_at.toISOString();
    const job = await enqueue({
      kind: "execution.run",
      sessionId: s.session_id,
      payload: { strategyId: s.id, scheduledFor: slot },
      dedupeKey: `execution.run:${s.id}:${slot}`,
    });
    if (job) enqueued += 1;
  }
  return enqueued;
}

/**
 * Advance a strategy to its next slot. Called after a terminal outcome for the
 * current slot (executed, or aborted in a way that will not be retried), never
 * while an attempt is still live.
 */
export async function advanceStrategy(strategyId: string, executed: boolean): Promise<void> {
  await query(
    `UPDATE corral_strategies
        SET seq = seq + 1,
            runs_completed = runs_completed + CASE WHEN $2 THEN 1 ELSE 0 END,
            last_run_at = now(),
            next_run_at = greatest(now(), next_run_at) + make_interval(secs => interval_seconds),
            updated_at = now()
      WHERE id = $1`,
    [strategyId, executed],
  );
}
