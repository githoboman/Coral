// T-004 acceptance — parity port of crates/corral-core/tests/errors.rs:
// every error code has exactly one retry rule and one user-facing message;
// policy rejections are never retried. Exhaustiveness is compile-time: the
// tables are Record<ErrorCode, …>, so an unclassified code fails tsc.

import { expect, test } from "vitest";
import { ERROR_CODES, retryClass, userMessage, type ErrorCode } from "../src/index.js";

// The security property (PRD §9): a retry loop around a policy rejection is
// what turns a safe system into an unsafe one.
test("policy rejections are terminal (parity: policy_rejections_are_terminal)", () => {
  const terminal: ErrorCode[] = [
    "POLICY_ASSET_NOT_IN_SCOPE",
    "POLICY_BUDGET_EXCEEDED",
    "POLICY_TARGET_NOT_ALLOWED",
    "POLICY_PARAM_VIOLATION",
    "POLICY_EXPIRED",
    "SESSION_REVOKED",
    "PLAN_UNSAFE_BOUNDS",
    "PLAN_INVALID_SCHEMA",
  ];
  for (const code of terminal) {
    expect(retryClass(code), `${code} must never be retried`).toStrictEqual(["NEVER", 0]);
  }
});

test("safety pauses are terminal (parity: safety_pauses_are_terminal)", () => {
  for (const code of ["MIRROR_DRIFT", "MODULE_SET_CHANGED"] as const) {
    expect(retryClass(code)).toStrictEqual(["NEVER", 0]);
  }
});

test("transient infra errors back off (parity: transient_infra_errors_back_off)", () => {
  for (const code of [
    "RELAYER_TIMEOUT",
    "SIGNER_UNAVAILABLE",
    "NODE_UNAVAILABLE",
    "GAS_SPONSOR_UNAVAILABLE",
  ] as const) {
    expect(retryClass(code)).toStrictEqual(["BACKOFF", 5]);
  }
});

test("market movement requotes (parity: market_movement_requotes)", () => {
  for (const code of ["SLIPPAGE_EXCEEDED", "SIMULATION_REVERT"] as const) {
    expect(retryClass(code)).toStrictEqual(["REQUOTE", 3]);
  }
});

test("window and nonce rules (parity: window_and_nonce_rules)", () => {
  expect(retryClass("POLICY_USAGE_LIMIT")).toStrictEqual(["NEXT_WINDOW", 1]);
  expect(retryClass("INSUFFICIENT_BALANCE")).toStrictEqual(["NEXT_WINDOW", 1]);
  expect(retryClass("NONCE_CONFLICT")).toStrictEqual(["IMMEDIATE", 3]);
});

// FR-11.8: every code has a plain-language message (or is deliberately
// silent) — no raw revert string or hex ever reaches a user.
test("user messages exist and NONCE_CONFLICT is silent (parity: user_messages_exist_and_nonce_conflict_is_silent)", () => {
  expect(userMessage("NONCE_CONFLICT")).toBeNull();
  for (const code of ERROR_CODES) {
    const msg = userMessage(code);
    if (msg !== null) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.includes("0x"), `no hex in user messages: ${msg}`).toBe(false);
    }
  }
});

// TS runtime backstop for what Record<ErrorCode, …> already proves at
// compile time: every code classifies.
test("every code has a retry rule and a message entry", () => {
  for (const code of ERROR_CODES) {
    const [cls, attempts] = retryClass(code);
    expect(["NEVER", "IMMEDIATE", "BACKOFF", "NEXT_WINDOW", "REQUOTE"]).toContain(cls);
    expect(attempts).toBeGreaterThanOrEqual(0);
    expect(userMessage(code) === null || typeof userMessage(code) === "string").toBe(true);
  }
});
