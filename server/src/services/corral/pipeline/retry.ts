/**
 * Turn an `ErrorCode` into a queue decision (spec §7.1).
 *
 * The mapping is not a UX choice: `NEVER` on every policy rejection is the
 * security property (CLAUDE.md §2.4). `null` here means dead-letter — the job
 * is not retried, ever. Reject any change that gives a policy code a delay.
 */
import { retryClass, type ErrorCode } from "@corral/core";

import { backoffMs } from "../jobs/queue.js";

export interface RetryDecision {
  /** Milliseconds until the next attempt, or `null` to dead-letter. */
  readonly retryInMs: number | null;
  readonly reason: string;
}

export interface RetryContext {
  readonly attempt: number;
  /** How long until the next scheduled slot (used by NEXT_WINDOW). */
  readonly nextWindowMs: number;
}

export function decideRetry(code: ErrorCode, ctx: RetryContext): RetryDecision {
  const [cls, maxAttempts] = retryClass(code);
  if (cls === "NEVER") return { retryInMs: null, reason: `${code} is terminal` };
  if (ctx.attempt >= maxAttempts) return { retryInMs: null, reason: `${code} exhausted ${maxAttempts} attempts` };

  switch (cls) {
    case "IMMEDIATE":
      return { retryInMs: 0, reason: `${code}: retry immediately` };
    case "BACKOFF":
      return { retryInMs: backoffMs(ctx.attempt), reason: `${code}: backoff` };
    case "REQUOTE":
      return { retryInMs: 15_000, reason: `${code}: retry with a fresh quote` };
    case "NEXT_WINDOW":
      return { retryInMs: Math.max(60_000, ctx.nextWindowMs), reason: `${code}: wait for the next window` };
  }
}
