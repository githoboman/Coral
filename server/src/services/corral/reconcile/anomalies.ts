/**
 * Anomaly detection (SEC-9, C-902): unusual execution frequency, unusual size
 * relative to budget, and repeated policy rejections → alert and auto-pause.
 *
 * What this is, and what it is not. The on-chain policies are the guarantee;
 * a compromised backend is already bounded by them. This layer exists for the
 * space *inside* the policy — an attacker who owns the planner cannot exceed
 * the budget, but they can burn all of it in an hour instead of over a month,
 * and every one of those executions is individually legitimate. Nothing
 * on-chain will object, because nothing on-chain was asked to.
 *
 * So the detectors here look for shape, not permission:
 *
 *  - **Burn rate** — spending far faster than the session's own schedule
 *    implies. The signal is the pace, not any single execution.
 *  - **Size** — a single execution taking an outsized share of what remains.
 *    This overlaps the planner's own bound (FR-4.7) deliberately: that one
 *    prevents, this one notices if it was ever bypassed.
 *  - **Rejection rate** — a run of policy rejections means something is
 *    repeatedly proposing work the policy refuses. Benign causes exist, but
 *    "probing the boundary" looks exactly like this.
 *
 * Pausing stops *new plans*; it never touches funds and never signs anything.
 * The user's revoke path is unaffected and remains theirs alone.
 */
import { query } from "../db/pool.js";
import { notifyAnomaly, notifyPaused } from "../notifications/emit.js";
import { getSession } from "../sessions/repository.js";
import { recordAnomaly } from "./budget.js";

export type AnomalyKind = "BURN_RATE" | "OUTSIZED_EXECUTION" | "REJECTION_RATE";

export interface AnomalyFinding {
  readonly sessionId: string;
  readonly kind: AnomalyKind;
  readonly detail: Record<string, unknown>;
  readonly shouldPause: boolean;
}

export interface Thresholds {
  /** Executions in the window before the pace itself is the signal. */
  readonly burstCount: number;
  readonly burstWindowMinutes: number;
  /** Share of remaining budget, in basis points, that makes one execution outsized. */
  readonly outsizedShareBps: bigint;
  /** Consecutive policy rejections tolerated before pausing. */
  readonly rejectionStreak: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  burstCount: 5,
  burstWindowMinutes: 60,
  // Matches the deterministic planner's own ceiling, so a plan that got past
  // it is by definition anomalous.
  outsizedShareBps: 2500n,
  rejectionStreak: 3,
};

interface CountRow {
  readonly n: string;
}

/**
 * Executions submitted far faster than this session's strategies schedule.
 *
 * Compared against the session's *own* cadence rather than a global constant:
 * a weekly DCA firing five times in an hour is alarming, and a strategy that
 * legitimately runs every ten minutes is not.
 */
async function burstCheck(sessionId: string, t: Thresholds): Promise<AnomalyFinding | null> {
  const rows = await query<CountRow>(
    `SELECT count(*)::text AS n
       FROM corral_executions
      WHERE session_id = $1
        AND created_at > now() - make_interval(mins => $2)
        AND status IN ('SUBMITTED', 'SUCCEEDED')`,
    [sessionId, t.burstWindowMinutes],
  );
  const count = Number(rows[0]?.n ?? "0");
  if (count < t.burstCount) return null;

  // How many runs the session's own schedule would produce in this window.
  const expected = await query<{ expected: string }>(
    `SELECT coalesce(sum(greatest(1, ($2 * 60) / greatest(interval_seconds, 1))), 0)::text AS expected
       FROM corral_strategies
      WHERE session_id = $1 AND status = 'ACTIVE'`,
    [sessionId, t.burstWindowMinutes],
  );
  const allowed = Number(expected[0]?.expected ?? "0");
  if (count <= allowed) return null;

  return {
    sessionId,
    kind: "BURN_RATE",
    detail: { executions: count, windowMinutes: t.burstWindowMinutes, scheduleWouldAllow: allowed },
    shouldPause: true,
  };
}

/**
 * A single execution taking an outsized share of what was left.
 *
 * Integer basis-point comparison, no division: `amount * 10000 > remaining *
 * bps`. Money never touches a float, not even to compare a ratio.
 */
async function sizeCheck(sessionId: string, t: Thresholds): Promise<AnomalyFinding | null> {
  const rows = await query<{ id: string; amount_in: string | null; asset_in: string | null }>(
    `SELECT id, amount_in, asset_in
       FROM corral_executions
      WHERE session_id = $1 AND amount_in IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId],
  );
  const latest = rows[0];
  if (!latest?.amount_in) return null;

  const mirror = await query<{ limit_amount: string; spent_amount: string }>(
    `SELECT limit_amount, spent_amount FROM corral_budget_mirror
      WHERE session_id = $1 AND ($2::text IS NULL OR asset = $2) LIMIT 1`,
    [sessionId, latest.asset_in],
  );
  const m = mirror[0];
  if (!m) return null;

  const limit = BigInt(m.limit_amount);
  const spent = BigInt(m.spent_amount);
  const amount = BigInt(latest.amount_in);
  // Remaining *before* this execution: the mirror already includes it.
  const remainingBefore = limit > spent ? limit - spent + amount : amount;
  if (remainingBefore === 0n) return null;
  if (amount * 10_000n <= remainingBefore * t.outsizedShareBps) return null;

  return {
    sessionId,
    kind: "OUTSIZED_EXECUTION",
    detail: {
      executionId: latest.id,
      amount: amount.toString(10),
      remainingBefore: remainingBefore.toString(10),
      thresholdBps: t.outsizedShareBps.toString(10),
    },
    shouldPause: true,
  };
}

/** A run of consecutive policy rejections — the shape of someone probing. */
async function rejectionCheck(sessionId: string, t: Thresholds): Promise<AnomalyFinding | null> {
  const rows = await query<{ status: string; error_code: string | null }>(
    `SELECT status, error_code FROM corral_executions
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [sessionId, t.rejectionStreak],
  );
  if (rows.length < t.rejectionStreak) return null;
  const allRejected = rows.every((r) => r.status === "REJECTED");
  if (!allRejected) return null;

  return {
    sessionId,
    kind: "REJECTION_RATE",
    detail: { streak: rows.length, codes: rows.map((r) => r.error_code) },
    shouldPause: true,
  };
}

/** Run every detector for one session. Read-only; recording is separate. */
export async function detectAnomalies(sessionId: string, t: Thresholds = DEFAULT_THRESHOLDS): Promise<AnomalyFinding[]> {
  const found = await Promise.all([burstCheck(sessionId, t), sizeCheck(sessionId, t), rejectionCheck(sessionId, t)]);
  return found.filter((f): f is AnomalyFinding => f !== null);
}

/**
 * Detect, record, and pause. Returns what was found.
 *
 * Recording is idempotent-ish by design: repeated detection of the same
 * ongoing condition appends rows, which is what an operator wants to see —
 * a condition that keeps firing is louder than one that fired once.
 */
export async function detectAndPause(
  sessionId: string,
  t: Thresholds = DEFAULT_THRESHOLDS,
): Promise<{ findings: AnomalyFinding[]; paused: boolean }> {
  const findings = await detectAnomalies(sessionId, t);
  let paused = false;

  const session = findings.length > 0 ? await getSession(sessionId) : null;
  for (const f of findings) {
    await recordAnomaly(f.sessionId, f.kind, f.detail);
    if (session) await notifyAnomaly(session, f.kind);
  }
  if (findings.some((f) => f.shouldPause)) {
    // Pausing stops new plans. It does not touch funds, does not sign, and
    // does not affect the owner's ability to revoke.
    const rows = await query<{ id: string }>(
      `UPDATE corral_sessions SET status = 'PAUSED_DRIFT', updated_at = now()
        WHERE id = $1 AND status = 'ACTIVE'
        RETURNING id`,
      [sessionId],
    );
    paused = rows.length > 0;
    // A paused agent stays paused until a human looks at it. Saying so is the
    // difference between a user who knows and a user who assumes it is still
    // working.
    if (paused && session) await notifyPaused(session, findings.map((f) => f.kind).join(", "));
  }
  return { findings, paused };
}
