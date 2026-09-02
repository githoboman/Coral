/**
 * Policy types and parse-time validation (T-003, PRD §8).
 *
 * "Parse, don't validate": a `ValidatedPolicy` can only be obtained through
 * `parsePolicy()`, and everything downstream — session install, compiler,
 * API, UI — accepts only `ValidatedPolicy`, so an unvalidated policy past
 * the boundary is unrepresentable. Parity port of
 * `crates/corral-core/src/policy.rs`; the wire format is identical to the
 * Rust serde output (snake_case fields, tagged rule objects, decimal-string
 * amounts), so nothing that already speaks it needs to change.
 */

import { z } from "zod";

import { TokenAmountSchema, U256_MAX, formatTokenAmount } from "./amount.js";

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * 20-byte hex address, normalized to lowercase at the boundary so identity
 * comparisons can never be split by checksum casing.
 */
export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte hex address")
  .transform((s) => s.toLowerCase());
export type Address = z.infer<typeof AddressSchema>;

/** 4-byte function selector, lowercase-normalized. */
export const SelectorSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{8}$/, "expected a 0x-prefixed 4-byte selector")
  .transform((s) => s.toLowerCase());
export type Selector = z.infer<typeof SelectorSchema>;

// ── Schema (wire-compatible with the Rust serde format) ─────────────────────

export const AssetRefSchema = z.strictObject({
  /** Display symbol. Never used for identity — symbols are attacker-chosen. */
  symbol: z.string().min(1),
  /** ERC-20 contract address; `null` means the chain's native asset. */
  address: AddressSchema.nullable(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

/** Identity is the address, never the symbol. */
export function sameAsset(a: AssetRef, b: AssetRef): boolean {
  return a.address === b.address;
}

/** Cumulative per-asset spend cap over the session's life (FR-2.2). */
export const BudgetConstraintSchema = z.strictObject({
  asset: AssetRefSchema,
  max_total: TokenAmountSchema,
});
export type BudgetConstraint = z.infer<typeof BudgetConstraintSchema>;

/** The closed action DSL (FR-2.8). Plans may contain nothing else. */
export const ActionKindSchema = z.enum(["SWAP", "TRANSFER", "APPROVE", "WRAP", "UNWRAP"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/** A value an IN_SET rule compares against. */
export const RuleValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("address"), value: AddressSchema }),
  /** Small scalar (e.g. a Uniswap fee tier). Token amounts use LTE/GTE. */
  z.strictObject({ kind: z.literal("uint"), value: z.number().int().nonnegative() }),
]);
export type RuleValue = z.infer<typeof RuleValueSchema>;

const paramIndex = z.number().int().min(0).max(255);

/**
 * Constraint on one calldata parameter of a whitelisted call (FR-2.5).
 * Names mirror the on-chain UniversalActionPolicy comparators.
 */
export const ParamRuleSchema = z.discriminatedUnion("rule", [
  /**
   * Parameter must equal the account address. This is the anti-exfiltration
   * rule: budget caps bound theft, the recipient pin prevents it.
   */
  z.strictObject({ rule: z.literal("EQ_ACCOUNT"), param_index: paramIndex }),
  z.strictObject({ rule: z.literal("IN_SET"), param_index: paramIndex, allowed: z.array(RuleValueSchema).min(1) }),
  z.strictObject({ rule: z.literal("LTE"), param_index: paramIndex, max: TokenAmountSchema }),
  z.strictObject({ rule: z.literal("GTE"), param_index: paramIndex, min: TokenAmountSchema }),
]);
export type ParamRule = z.infer<typeof ParamRuleSchema>;

/** Allowlisted (contract, selector) pair with parameter constraints (FR-2.4). */
export const TargetConstraintSchema = z.strictObject({
  address: AddressSchema,
  selector: SelectorSchema,
  action: ActionKindSchema,
  param_rules: z.array(ParamRuleSchema),
});
export type TargetConstraint = z.infer<typeof TargetConstraintSchema>;

/** A policy exactly as it arrives from the wire — untrusted (PRD §8). */
export const RawPolicySchema = z.strictObject({
  version: z.number().int().min(0).max(255),
  chain_id: z.number().int().positive(),
  asset_scope: z.array(AssetRefSchema),
  budgets: z.array(BudgetConstraintSchema),
  max_native_value: TokenAmountSchema,
  target_scope: z.array(TargetConstraintSchema),
  action_scope: z.array(ActionKindSchema),
  valid_after: z.number().int().nonnegative(),
  valid_until: z.number().int().nonnegative(),
  max_executions: z.number().int().nonnegative(),
  max_executions_per_24h: z.number().int().nonnegative(),
  min_output_bps: z.number().int().min(0).max(65535),
});
export type RawPolicy = z.infer<typeof RawPolicySchema>;

// ── Validation ──────────────────────────────────────────────────────────────

export type PolicyErrorCode =
  | "BAD_TIME_WINDOW"
  | "USAGE_CAPS_INCONSISTENT"
  | "ASSET_WITHOUT_BUDGET"
  | "MISSING_RECIPIENT_PIN"
  | "UNBOUNDED_APPROVAL"
  | "SLIPPAGE_OUT_OF_RANGE";

export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "PolicyError";
  }
}

declare const ValidatedBrand: unique symbol;

/**
 * A policy that has passed every parse-time invariant. Only `parsePolicy`
 * produces this type; it is deep-frozen at runtime (policies are immutable —
 * FR-2.9 — so editing means revoke + create new).
 */
export type ValidatedPolicy = Readonly<RawPolicy> & { readonly [ValidatedBrand]: true };

function isSwapTarget(t: TargetConstraint): boolean {
  return t.action === "SWAP";
}

function hasRecipientPin(t: TargetConstraint): boolean {
  return t.param_rules.some((r) => r.rule === "EQ_ACCOUNT");
}

/**
 * For an approve target: the spender address if the approval amount is not
 * capped below `U256_MAX` (a cap of `U256_MAX` is not a cap — FR-2.12),
 * `null` otherwise.
 */
function unboundedApprovalSpender(t: TargetConstraint): Address | null {
  if (t.action !== "APPROVE") return null;
  const capped = t.param_rules.some((r) => r.rule === "LTE" && r.max < U256_MAX);
  if (capped) return null;
  for (const r of t.param_rules) {
    if (r.rule === "IN_SET") {
      for (const v of r.allowed) {
        if (v.kind === "address") return v.value;
      }
    }
  }
  return t.address;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Schema parse (strict, everywhere) + the six parse-time invariants
 * (PRD §8). Throws `ZodError` on shape violations and `PolicyError` on
 * invariant violations. The only constructor of `ValidatedPolicy`.
 */
export function parsePolicy(input: unknown): ValidatedPolicy {
  const p = RawPolicySchema.parse(input);

  if (p.valid_until <= p.valid_after) {
    throw new PolicyError("BAD_TIME_WINDOW", "validUntil must be after validAfter");
  }
  if (p.max_executions_per_24h > p.max_executions) {
    throw new PolicyError("USAGE_CAPS_INCONSISTENT", "24h execution cap exceeds total cap");
  }
  if (p.min_output_bps < 5000 || p.min_output_bps > 10000) {
    throw new PolicyError("SLIPPAGE_OUT_OF_RANGE", String(p.min_output_bps));
  }

  // Every in-scope asset must carry a budget. An asset in scope without a
  // budget is an unbounded spend — the exact bug this product exists to
  // prevent.
  for (const a of p.asset_scope) {
    if (!p.budgets.some((b) => sameAsset(b.asset, a))) {
      throw new PolicyError("ASSET_WITHOUT_BUDGET", a.symbol);
    }
  }

  // Every swap target must pin the recipient to the account, or the agent
  // can swap the user's funds and send the output anywhere. Budget caps
  // bound theft; they do not prevent it (spec §4.3).
  for (const t of p.target_scope) {
    if (isSwapTarget(t) && !hasRecipientPin(t)) {
      throw new PolicyError("MISSING_RECIPIENT_PIN", t.address);
    }
    const spender = unboundedApprovalSpender(t);
    if (spender !== null) {
      throw new PolicyError("UNBOUNDED_APPROVAL", spender);
    }
  }

  return deepFreeze(p) as ValidatedPolicy;
}

// ── Serialization ───────────────────────────────────────────────────────────

function ruleToWire(r: ParamRule): Record<string, unknown> {
  switch (r.rule) {
    case "EQ_ACCOUNT":
      return { rule: r.rule, param_index: r.param_index };
    case "IN_SET":
      return { rule: r.rule, param_index: r.param_index, allowed: r.allowed };
    case "LTE":
      return { rule: r.rule, param_index: r.param_index, max: formatTokenAmount(r.max) };
    case "GTE":
      return { rule: r.rule, param_index: r.param_index, min: formatTokenAmount(r.min) };
  }
}

/**
 * The inverse of parsing: wire form with every `TokenAmount` as a decimal
 * string, safe for `JSON.stringify` (bigints never reach it). Round-trip
 * law: `parsePolicy(policyToWire(vp))` equals `vp` — tested.
 */
export function policyToWire(p: ValidatedPolicy): Record<string, unknown> {
  return {
    version: p.version,
    chain_id: p.chain_id,
    asset_scope: p.asset_scope,
    budgets: p.budgets.map((b) => ({ asset: b.asset, max_total: formatTokenAmount(b.max_total) })),
    max_native_value: formatTokenAmount(p.max_native_value),
    target_scope: p.target_scope.map((t) => ({
      address: t.address,
      selector: t.selector,
      action: t.action,
      param_rules: t.param_rules.map(ruleToWire),
    })),
    action_scope: p.action_scope,
    valid_after: p.valid_after,
    valid_until: p.valid_until,
    max_executions: p.max_executions,
    max_executions_per_24h: p.max_executions_per_24h,
    min_output_bps: p.min_output_bps,
  };
}
