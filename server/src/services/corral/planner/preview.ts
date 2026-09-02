/**
 * Plan preview (FR-11.5): the next three runs a strategy will attempt.
 *
 * The point of showing this before activation is that an agent's *schedule* is
 * as much a commitment as its budget, and a schedule is much harder to picture
 * than a number. "Weekly, 125 USDC, for 30 days" is abstract; three dated rows
 * with amounts on them is not.
 *
 * Two rules keep it honest:
 *
 *  - It is a **projection, not a promise**. Prices move, budgets run down, and
 *    conditions may not hold. Every row says what could stop it.
 *  - It never touches the signer, the relayer, or the queue. Previewing is a
 *    read; it cannot cause an execution, and it does not reserve a slot.
 */
import { query } from "../db/pool.js";
import { StrategyConfigSchema, type StrategyConfig } from "./strategies.js";

export interface PreviewRun {
  /** ISO timestamp of the slot. */
  readonly scheduledFor: string;
  readonly seq: number;
  /** Base units. `null` when the amount depends on a balance we have not read. */
  readonly amountIn: string | null;
  readonly assetIn: string;
  readonly assetOut: string;
  /** Plain-language caveat: what would stop this run from happening. */
  readonly caveat: string;
}

export interface StrategyPreview {
  readonly strategyId: string;
  readonly kind: StrategyConfig["kind"];
  readonly runs: PreviewRun[];
  /** Runs remaining under the session's usage cap, if it binds before the end date. */
  readonly runsRemaining: number | null;
}

interface StrategyRow {
  readonly id: string;
  readonly config: Record<string, unknown>;
  readonly interval_seconds: number;
  readonly next_run_at: Date;
  readonly seq: number;
  readonly runs_completed: number;
  readonly status: string;
}

function caveatFor(config: StrategyConfig): string {
  switch (config.kind) {
    case "DCA_FIXED":
      return "This runs on schedule as long as the budget covers it.";
    case "DCA_PERCENT":
      return "The amount depends on your balance at the time, so it is not known yet.";
    case "CONDITIONAL_PRICE":
      return `This only runs if the price condition still holds at the time.`;
  }
}

function amountFor(config: StrategyConfig): string | null {
  switch (config.kind) {
    case "DCA_FIXED":
    case "CONDITIONAL_PRICE":
      return config.amountIn;
    case "DCA_PERCENT":
      // Deliberately null rather than a guess: showing a figure derived from
      // today's balance as though it were next month's would be a fiction.
      return null;
  }
}

/**
 * Project the next `count` runs.
 *
 * Bounded by the session's expiry and by its remaining usage allowance,
 * because a preview that shows runs the policy will refuse is worse than one
 * that stops early.
 */
export function projectRuns(
  config: StrategyConfig,
  from: Date,
  intervalSeconds: number,
  startSeq: number,
  count: number,
  limits: { validUntilSeconds: number; runsRemaining: number | null },
): PreviewRun[] {
  const runs: PreviewRun[] = [];
  const caveat = caveatFor(config);
  const amountIn = amountFor(config);

  for (let i = 0; i < count; i++) {
    const at = new Date(from.getTime() + i * intervalSeconds * 1000);
    if (Math.floor(at.getTime() / 1000) >= limits.validUntilSeconds) break;
    if (limits.runsRemaining !== null && i >= limits.runsRemaining) break;
    runs.push({
      scheduledFor: at.toISOString(),
      seq: startSeq + i + 1,
      amountIn,
      assetIn: config.assetIn.symbol,
      assetOut: config.assetOut.symbol,
      caveat,
    });
  }
  return runs;
}

/** Preview every active strategy on a session. Read-only. */
export async function previewSession(sessionId: string, count = 3): Promise<StrategyPreview[]> {
  const sessions = await query<{ valid_until: string; policy: { max_executions?: number } }>(
    `SELECT valid_until, policy FROM corral_sessions WHERE id = $1`,
    [sessionId],
  );
  const session = sessions[0];
  if (!session) return [];

  const maxExecutions = session.policy.max_executions ?? null;
  const used = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM corral_executions WHERE session_id = $1 AND status IN ('SUBMITTED','INCLUDED','SUCCEEDED')`,
    [sessionId],
  );
  const runsRemaining = maxExecutions === null ? null : Math.max(0, maxExecutions - Number(used[0]?.n ?? "0"));

  const strategies = await query<StrategyRow>(
    `SELECT id, config, interval_seconds, next_run_at, seq, runs_completed, status
       FROM corral_strategies
      WHERE session_id = $1 AND status IN ('DRAFT', 'ACTIVE')
      ORDER BY next_run_at`,
    [sessionId],
  );

  const out: StrategyPreview[] = [];
  for (const s of strategies) {
    const parsed = StrategyConfigSchema.safeParse(s.config);
    // A config we cannot parse is not previewed. Rendering a guess about
    // something we do not understand is worse than showing nothing.
    if (!parsed.success) continue;
    out.push({
      strategyId: s.id,
      kind: parsed.data.kind,
      runs: projectRuns(parsed.data, s.next_run_at, s.interval_seconds, s.seq, count, {
        validUntilSeconds: Number(session.valid_until),
        runsRemaining,
      }),
      runsRemaining,
    });
  }
  return out;
}
