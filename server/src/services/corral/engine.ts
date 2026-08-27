/**
 * Engine bootstrap: migrations, the worker loop, and the scheduler tick.
 *
 * Opt-in via `CORRAL_ENGINE=true` so the inherited server boots exactly as
 * before when the engine is not wanted. Nothing here can widen a policy: the
 * worker only plans, preflights, signs (through the DB gate) and submits.
 */
import { runMigrations } from "./db/migrate.js";
import { isDatabaseConfigured } from "./db/pool.js";
import { reapStale } from "./jobs/queue.js";
import { runOnce, scheduleDueStrategies, type JobHandler } from "./jobs/worker.js";

export interface EngineOptions {
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly tickIntervalMs?: number;
  readonly visibilityTimeoutMs?: number;
}

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

  console.log(`[corral] engine started (worker ${workerId})`);
  return {
    async stop() {
      stopping = true;
      clearInterval(tick);
      await idle;
      console.log("[corral] engine stopped");
    },
  };
}
