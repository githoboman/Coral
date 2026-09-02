/**
 * Error taxonomy and retry classification (T-004, PRD §9, spec §7.1).
 *
 * Every failure maps to exactly one code; each code has a fixed retry rule
 * and a fixed user-facing message. `NEVER` on every policy rejection is a
 * security property, not a UX choice: a retry loop around a policy error is
 * what turns a safe system into an unsafe one. Reject any change that adds
 * a retry around one.
 *
 * Both tables are `Record<ErrorCode, …>` — TypeScript's substitute for the
 * Rust exhaustive match: adding an `ErrorCode` without classifying it fails
 * to compile. That is the point; do not "fix" it with a partial record or
 * an index-signature cast.
 */

import { z } from "zod";

/** Canonical failure codes (PRD §9). Wire format is SCREAMING_SNAKE_CASE. */
export const ERROR_CODES = [
  // Policy rejections — terminal, always.
  "POLICY_ASSET_NOT_IN_SCOPE",
  "POLICY_BUDGET_EXCEEDED",
  "POLICY_TARGET_NOT_ALLOWED",
  "POLICY_PARAM_VIOLATION",
  "POLICY_EXPIRED",
  "POLICY_USAGE_LIMIT",
  "SESSION_REVOKED",
  // Planner failures.
  "PLAN_INVALID_SCHEMA",
  "PLAN_UNSAFE_BOUNDS",
  // Market / chain-state outcomes.
  "SIMULATION_REVERT",
  "SLIPPAGE_EXCEEDED",
  "INSUFFICIENT_BALANCE",
  // Transient infrastructure.
  "GAS_SPONSOR_UNAVAILABLE",
  "RELAYER_TIMEOUT",
  "NONCE_CONFLICT",
  "SIGNER_UNAVAILABLE",
  "NODE_UNAVAILABLE",
  // Safety pauses — resolved by a human, never by a retry.
  "MIRROR_DRIFT",
  "MODULE_SET_CHANGED",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** How a failure may be retried, if at all. */
export type RetryClass =
  /** Terminal. Policy rejections and safety pauses live here permanently. */
  | "NEVER"
  /** Retry at once (e.g. with a fresh nonce key). */
  | "IMMEDIATE"
  /** Exponential backoff with jitter. */
  | "BACKOFF"
  /** Wait for the next schedule/usage window. */
  | "NEXT_WINDOW"
  /** Retry with a fresh quote. */
  | "REQUOTE";

/** `[class, maxAttempts]` per code — the single source of truth. */
const RETRY_TABLE: Record<ErrorCode, readonly [RetryClass, number]> = {
  POLICY_ASSET_NOT_IN_SCOPE: ["NEVER", 0],
  POLICY_BUDGET_EXCEEDED: ["NEVER", 0],
  POLICY_TARGET_NOT_ALLOWED: ["NEVER", 0],
  POLICY_PARAM_VIOLATION: ["NEVER", 0],
  POLICY_EXPIRED: ["NEVER", 0],
  SESSION_REVOKED: ["NEVER", 0],
  PLAN_UNSAFE_BOUNDS: ["NEVER", 0],
  // Deterministic planner: identical input produces identical output, so a
  // schema failure cannot be retried into success.
  PLAN_INVALID_SCHEMA: ["NEVER", 0],
  // Pause + page. Human resolution only (FR-6.3, SEC-9).
  MIRROR_DRIFT: ["NEVER", 0],
  MODULE_SET_CHANGED: ["NEVER", 0],
  POLICY_USAGE_LIMIT: ["NEXT_WINDOW", 1],
  INSUFFICIENT_BALANCE: ["NEXT_WINDOW", 1],
  SLIPPAGE_EXCEEDED: ["REQUOTE", 3],
  SIMULATION_REVERT: ["REQUOTE", 3],
  RELAYER_TIMEOUT: ["BACKOFF", 5],
  SIGNER_UNAVAILABLE: ["BACKOFF", 5],
  NODE_UNAVAILABLE: ["BACKOFF", 5],
  GAS_SPONSOR_UNAVAILABLE: ["BACKOFF", 5],
  NONCE_CONFLICT: ["IMMEDIATE", 3],
};

export function retryClass(e: ErrorCode): readonly [RetryClass, number] {
  return RETRY_TABLE[e];
}

/**
 * Fixed user-facing message templates (PRD §9; FR-11.8: never a raw revert
 * or hex). `{...}` placeholders are interpolated by the frontend. `null`
 * means the failure is deliberately silent to the user.
 */
const USER_MESSAGES: Record<ErrorCode, string | null> = {
  POLICY_ASSET_NOT_IN_SCOPE: "This agent isn't allowed to use that asset.",
  POLICY_BUDGET_EXCEEDED: "Budget for {asset} is used up.",
  POLICY_TARGET_NOT_ALLOWED: "This agent can only trade on {venue}.",
  POLICY_PARAM_VIOLATION: "The planned action didn't meet your rules.",
  POLICY_EXPIRED: "This agent's permission expired on {date}.",
  POLICY_USAGE_LIMIT: "Daily action limit reached.",
  SESSION_REVOKED: "You revoked this agent.",
  PLAN_INVALID_SCHEMA: "Couldn't build a valid plan; nothing was executed.",
  PLAN_UNSAFE_BOUNDS: "Plan looked unusual and was blocked.",
  SIMULATION_REVERT: "Trade would have failed; skipped this run.",
  SLIPPAGE_EXCEEDED: "Price moved too much; skipped this run.",
  INSUFFICIENT_BALANCE: "Not enough {asset} in your account.",
  GAS_SPONSOR_UNAVAILABLE: "Temporary network issue; will retry.",
  RELAYER_TIMEOUT: "Temporary network issue; will retry.",
  SIGNER_UNAVAILABLE: "Temporary issue; will retry.",
  NODE_UNAVAILABLE: "Temporary network issue; will retry.",
  NONCE_CONFLICT: null,
  MIRROR_DRIFT: "Paused for a safety check.",
  MODULE_SET_CHANGED: "Paused: your account settings changed unexpectedly.",
};

export function userMessage(e: ErrorCode): string | null {
  return USER_MESSAGES[e];
}
