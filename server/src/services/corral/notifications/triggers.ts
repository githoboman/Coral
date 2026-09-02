/**
 * What is worth telling a user, and how it should read (C-703, FR-10.2/10.3/10.4).
 *
 * Two rules shape everything here:
 *
 *  1. **A notification either needs action or it does not, and it must say
 *     which.** "Your agent traded" and "your agent is paused and will not
 *     trade again until you look at it" cannot arrive looking the same. Every
 *     message carries `actionRequired` and a link to the exact thing it is
 *     about (FR-10.4).
 *
 *  2. **Success is a digest; failure is immediate.** A weekly DCA that emails
 *     on every internal event trains its user to ignore it, and the one
 *     message that mattered arrives in a stream they have stopped reading.
 *
 * Copy is written the way the policy review screen is: short sentences, no
 * jargon, and never a raw revert string — error codes go through
 * `userMessage()` from `@corral/core` (FR-11.8).
 */
import { userMessage, type ErrorCode } from "@corral/core";

export type TriggerKind =
  | "EXECUTION_SUCCEEDED"
  | "EXECUTION_FAILED"
  | "BUDGET_THRESHOLD"
  | "SESSION_EXPIRING"
  | "SESSION_EXPIRED"
  | "ANOMALY_DETECTED"
  | "SESSION_PAUSED"
  | "REVOKE_CONFIRMED";

export interface NotificationDraft {
  readonly trigger: TriggerKind;
  readonly subject: string;
  readonly body: string;
  readonly link: string;
  readonly actionRequired: boolean;
  /** One message per key per window (FR-10.3). */
  readonly digestKey: string;
  /** Delay before sending, so a digest can accumulate. */
  readonly delayMs: number;
}

export interface NotificationContext {
  readonly sessionId: string;
  readonly executionId?: string | null;
  readonly appBaseUrl: string;
}

/** Budget thresholds announced, in percent (FR-10.2). */
export const BUDGET_THRESHOLDS = [50, 80, 100] as const;

/** How long a success digest waits for siblings before going out. */
export const SUCCESS_DIGEST_MS = 5 * 60_000;

function sessionLink(ctx: NotificationContext): string {
  return `${ctx.appBaseUrl}/agents/${ctx.sessionId}`;
}

function executionLink(ctx: NotificationContext): string {
  return ctx.executionId ? `${sessionLink(ctx)}/activity/${ctx.executionId}` : sessionLink(ctx);
}

/**
 * A successful run. Batched, and explicitly not urgent — the whole point of
 * an agent is that this is the boring case.
 */
export function successDraft(ctx: NotificationContext, summary: string): NotificationDraft {
  return {
    trigger: "EXECUTION_SUCCEEDED",
    subject: "Your agent completed a trade",
    body: `${summary}\n\nNothing needs your attention. You can see the details, including the price you got, on the activity page.`,
    link: executionLink(ctx),
    actionRequired: false,
    // Keyed on the session and the digest window, so several successes in the
    // same window collapse into one message (FR-10.3).
    digestKey: `success:${ctx.sessionId}`,
    delayMs: SUCCESS_DIGEST_MS,
  };
}

/**
 * A failure. Immediate, and honest about whether the user has to do anything —
 * most failures are transient and will retry on their own, and saying so is
 * the difference between a useful alert and an alarming one.
 */
export function failureDraft(ctx: NotificationContext, code: ErrorCode, willRetry: boolean): NotificationDraft {
  const explanation = userMessage(code) ?? "The trade did not go through.";
  return {
    trigger: "EXECUTION_FAILED",
    subject: willRetry ? "A trade did not go through (it will retry)" : "A trade was stopped",
    body: willRetry
      ? `${explanation}\n\nYour agent will try again automatically. No money moved. You do not need to do anything.`
      : `${explanation}\n\nYour agent will not retry this one. Your money did not move, and your limits are unchanged.`,
    link: executionLink(ctx),
    actionRequired: !willRetry,
    // Not digested: each distinct failure is its own message.
    digestKey: `failure:${ctx.executionId ?? ctx.sessionId}`,
    delayMs: 0,
  };
}

/** Budget milestone. Informational until 100%, which ends the agent's usefulness. */
export function budgetDraft(ctx: NotificationContext, assetSymbol: string, pct: number): NotificationDraft {
  const spent = pct >= 100;
  return {
    trigger: "BUDGET_THRESHOLD",
    subject: spent
      ? `Your agent has spent its full ${assetSymbol} budget`
      : `Your agent has used ${String(pct)}% of its ${assetSymbol} budget`,
    body: spent
      ? `The limit you set has been reached, so your agent has stopped trading. It cannot spend any more. To continue, revoke this agent and create a new one with a fresh limit.`
      : `Your agent has used ${String(pct)}% of the ${assetSymbol} you allowed it. It will stop by itself at 100%.`,
    link: sessionLink(ctx),
    actionRequired: spent,
    digestKey: `budget:${ctx.sessionId}:${assetSymbol}:${String(pct)}`,
    delayMs: 0,
  };
}

/** Expiry warning (FR-10.2: 72h) and the expiry itself. */
export function expiryDraft(ctx: NotificationContext, hoursLeft: number | null): NotificationDraft {
  if (hoursLeft === null) {
    return {
      trigger: "SESSION_EXPIRED",
      subject: "Your agent's permission has ended",
      body: "The end date you set has passed, so your agent has stopped. It can no longer spend anything. Nothing needs your attention unless you want to set up a new one.",
      link: sessionLink(ctx),
      actionRequired: false,
      digestKey: `expired:${ctx.sessionId}`,
      delayMs: 0,
    };
  }
  return {
    trigger: "SESSION_EXPIRING",
    subject: `Your agent stops in ${String(hoursLeft)} hours`,
    body: `The permission you gave this agent ends soon. After that it stops on its own — you do not have to do anything. If you want it to keep going, you will need to set up a new one.`,
    link: sessionLink(ctx),
    actionRequired: false,
    digestKey: `expiring:${ctx.sessionId}`,
    delayMs: 0,
  };
}

/**
 * A pause. Always action-required: a paused agent stays paused until a human
 * looks at it, and a user who does not know that will assume it is still
 * working.
 */
export function pausedDraft(ctx: NotificationContext, reason: string): NotificationDraft {
  return {
    trigger: "SESSION_PAUSED",
    subject: "Your agent has been paused",
    body: `We stopped your agent because something did not look right: ${reason}\n\nNo money has moved and your limits are unchanged. It will stay paused until you review it. If you would rather end it entirely, you can revoke it at any time.`,
    link: sessionLink(ctx),
    actionRequired: true,
    digestKey: `paused:${ctx.sessionId}`,
    delayMs: 0,
  };
}

export function anomalyDraft(ctx: NotificationContext, kind: string): NotificationDraft {
  return {
    trigger: "ANOMALY_DETECTED",
    subject: "Something unusual on your agent",
    body: `We noticed something worth a look: ${kind}. Your agent's limits still hold — it cannot spend more than you allowed, or send anywhere you did not permit. We are telling you because the pattern was unusual, not because the limits failed.`,
    link: sessionLink(ctx),
    actionRequired: true,
    digestKey: `anomaly:${ctx.sessionId}:${kind}`,
    delayMs: 0,
  };
}

/** Revoke confirmed on chain. States plainly what revoke did and did not do (FR-8.4). */
export function revokeDraft(ctx: NotificationContext): NotificationDraft {
  return {
    trigger: "REVOKE_CONFIRMED",
    subject: "Your agent has been revoked",
    body: "Your agent can no longer spend anything. This takes effect from now on: it does not undo trades that already happened, and it does not move any money. Your funds stayed in your account the whole time.",
    link: sessionLink(ctx),
    actionRequired: false,
    digestKey: `revoked:${ctx.sessionId}`,
    delayMs: 0,
  };
}

/**
 * Which budget thresholds a reading has newly crossed.
 *
 * Integer basis points against bigints — the percentage is never computed as
 * a float, so a reading that lands exactly on 80% is reported as 80%.
 */
export function crossedThresholds(spent: bigint, limit: bigint, alreadyNotified: readonly number[]): number[] {
  if (limit <= 0n) return [];
  const crossed: number[] = [];
  for (const pct of BUDGET_THRESHOLDS) {
    if (alreadyNotified.includes(pct)) continue;
    if (spent * 100n >= limit * BigInt(pct)) crossed.push(pct);
  }
  return crossed;
}
