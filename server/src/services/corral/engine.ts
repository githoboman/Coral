/**
 * Engine bootstrap: migrations, the worker loop, and the scheduler tick.
 *
 * Opt-in via `CORRAL_ENGINE=true` so the inherited server boots exactly as
 * before when the engine is not wanted. Nothing here can widen a policy: the
 * worker only plans, preflights, signs (through the DB gate) and submits.
 */
import { runMigrations } from "./db/migrate.js";
import { isDatabaseConfigured } from "./db/pool.js";
import { enqueue, reapStale } from "./jobs/queue.js";
import { runOnce, scheduleDueStrategies, type JobHandler } from "./jobs/worker.js";

export interface EngineOptions {
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly tickIntervalMs?: number;
  readonly visibilityTimeoutMs?: number;
  /**
   * How often the safety sweeps run. These are cheap reads; the default is
   * frequent because FR-1.5 wants a module change caught within a block, and
   * a stranded execution is a budget the chain has already spent.
   */
  readonly safetyIntervalMs?: number;
}

/** Periodic safety work, enqueued rather than run inline so it is claimed once across all workers. */
const SAFETY_JOBS = [
  "indexer.poll",
  "execution.recover",
  "module.monitor",
  "anomaly.scan",
  "rpc.health",
  "notification.dispatch",
] as const;

export interface EngineHandle {
  stop(): Promise<void>;
}

export function isEngineEnabled(): boolean {
  return process.env["CORRAL_ENGINE"] === "true" && isDatabaseConfigured();
}

/**
 * Start the engine. Returns a handle whose `stop()` lets in-flight work finish
 * — a job killed mid-run is safe (the ledger prevents repetition) but a clean
 * stop keeps the queue tidy.
 */
export async function startEngine(opts: EngineOptions): Promise<EngineHandle> {
  const applied = await runMigrations();
  const fresh = applied.filter((m) => !m.alreadyApplied).map((m) => m.name);
  console.log(`[corral] migrations ok${fresh.length ? ` — applied ${fresh.join(", ")}` : " (nothing new)"}`);

  const workerId = opts.workerId ?? `worker-${process.pid}`;
  let stopping = false;
  let idle: Promise<void> = Promise.resolve();

  const loop = async (): Promise<void> => {
    while (!stopping) {
      let did = false;
      try {
        did = await runOnce({ handlers: opts.handlers, workerId });
      } catch (e) {
        console.error("[corral] worker cycle failed:", e instanceof Error ? e.message : e);
      }
      if (!did) {
        await reapStale(opts.visibilityTimeoutMs ?? 5 * 60_000).catch(() => 0);
        await new Promise((r) => setTimeout(r, opts.pollIntervalMs ?? 1_000));
      }
    }
  };
  idle = loop();

  const tick = setInterval(() => {
    void scheduleDueStrategies().catch((e: unknown) => {
      console.error("[corral] strategy tick failed:", e instanceof Error ? e.message : e);
    });
  }, opts.tickIntervalMs ?? 60_000);

  // Safety sweeps. The dedupe key is the slot, so several engine processes
  // ticking at once still enqueue one job per sweep per slot.
  const safetyMs = opts.safetyIntervalMs ?? 30_000;
  const safety = setInterval(() => {
    const slot = Math.floor(Date.now() / safetyMs);
    for (const kind of SAFETY_JOBS) {
      if (!opts.handlers[kind]) continue;
      void enqueue({ kind, dedupeKey: `${kind}:${String(slot)}`, maxAttempts: 3 }).catch((e: unknown) => {
        console.error(`[corral] could not enqueue ${kind}:`, e instanceof Error ? e.message : e);
      });
    }
  }, safetyMs);

  console.log(`[corral] engine started (worker ${workerId})`);
  return {
    async stop() {
      stopping = true;
      clearInterval(tick);
      clearInterval(safety);
      await idle;
      console.log("[corral] engine stopped");
    },
  };
}
