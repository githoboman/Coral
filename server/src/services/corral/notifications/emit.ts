/**
 * The call sites: where the engine decides a user should be told something.
 *
 * Every function here is **best-effort and non-throwing**. The outbox already
 * guarantees that delivery cannot block an execution (FR-10.5); this layer
 * adds the second half of that promise — a bug in *deciding* what to notify
 * cannot fail an execution either. A missed email is a bad day; an execution
 * that aborts because an email could not be composed is a broken product.
 */
import type { ErrorCode } from "@corral/core";

import { query } from "../db/pool.js";
import type { SessionRow } from "../sessions/repository.js";
import { notifiedThresholds, notify, recordThreshold, suppressForSession } from "./outbox.js";
import {
  anomalyDraft,
  budgetDraft,
  crossedThresholds,
  expiryDraft,
  failureDraft,
  pausedDraft,
  revokeDraft,
  successDraft,
  type NotificationContext,
} from "./triggers.js";

function baseUrl(): string {
  return process.env["APP_BASE_URL"] ?? "https://app.corral.xyz";
}

function contextFor(session: SessionRow, executionId?: string | null): NotificationContext {
  return { sessionId: session.id, executionId: executionId ?? null, appBaseUrl: baseUrl() };
}

/** Swallow anything: notification problems never surface as execution problems. */
async function safely(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error("[corral-notify]", e instanceof Error ? e.message : e);
  }
}

export async function notifyExecuted(session: SessionRow, executionId: string, summary: string): Promise<void> {
  await safely(() =>
    notify({
      owner: session.owner,
      sessionId: session.id,
      executionId,
      draft: successDraft(contextFor(session, executionId), summary),
    }),
  );
}

export async function notifyFailed(
  session: SessionRow,
  executionId: string | null,
  code: ErrorCode,
  willRetry: boolean,
): Promise<void> {
  await safely(() =>
    notify({
      owner: session.owner,
      sessionId: session.id,
      executionId,
      draft: failureDraft(contextFor(session, executionId), code, willRetry),
    }),
  );
}

export async function notifyPaused(session: SessionRow, reason: string): Promise<void> {
  await safely(() =>
    notify({ owner: session.owner, sessionId: session.id, draft: pausedDraft(contextFor(session), reason) }),
  );
}

export async function notifyAnomaly(session: SessionRow, kind: string): Promise<void> {
  await safely(() =>
    notify({ owner: session.owner, sessionId: session.id, draft: anomalyDraft(contextFor(session), kind) }),
  );
}

/**
 * Revocation. Also suppresses everything else still queued for the session:
 * a "your agent traded" digest landing after "your agent has been revoked"
 * reads as though revocation did not work.
 */
export async function notifyRevoked(session: SessionRow): Promise<void> {
  await safely(async () => {
    await notify({ owner: session.owner, sessionId: session.id, draft: revokeDraft(contextFor(session)) });
    await suppressForSession(session.id);
  });
}

export async function notifyExpiry(session: SessionRow, hoursLeft: number | null): Promise<void> {
  await safely(() =>
    notify({ owner: session.owner, sessionId: session.id, draft: expiryDraft(contextFor(session), hoursLeft) }),
  );
}

/**
 * Budget milestones, announced once per crossing (FR-10.2).
 *
 * Reads the mirror rather than being handed a number, so the figure in the
 * message is the same one the meters show.
 */
export async function notifyBudgetThresholds(session: SessionRow): Promise<number[]> {
  const announced: number[] = [];
  await safely(async () => {
    const rows = await query<{ asset: string; limit_amount: string; spent_amount: string }>(
      `SELECT asset, limit_amount, spent_amount FROM corral_budget_mirror WHERE session_id = $1`,
      [session.id],
    );
    for (const r of rows) {
      const already = await notifiedThresholds(session.id, r.asset);
      const crossed = crossedThresholds(BigInt(r.spent_amount), BigInt(r.limit_amount), already);
      for (const pct of crossed) {
        // Record first: a crash between sending and recording would repeat the
        // message, and repeating "you have spent everything" is worse than
        // missing it once.
        await recordThreshold(session.id, r.asset, pct);
        await notify({
          owner: session.owner,
          sessionId: session.id,
          draft: budgetDraft(contextFor(session), symbolFor(session, r.asset), pct),
        });
        announced.push(pct);
      }
    }
  });
  return announced;
}

/** The symbol the user chose for this asset, falling back to a short address. */
function symbolFor(session: SessionRow, asset: string): string {
  const policy = session.policy as { asset_scope?: { symbol: string; address: string | null }[] };
  const match = policy.asset_scope?.find((a) => (a.address ?? "").toLowerCase() === asset.toLowerCase());
  return match?.symbol ?? `${asset.slice(0, 6)}…`;
}
