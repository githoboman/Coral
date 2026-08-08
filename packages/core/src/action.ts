/**
 * The closed Action DSL and `Plan` (T-004, FR-2.8, FR-4.1/4.2).
 *
 * A `Plan` is a typed, validated sequence of Actions — never raw calldata.
 * Every schema here is strict: an LLM (or anything else) adding a helpful
 * extra field fails parsing rather than passing something unmodelled into
 * the compiler. Parity port of `crates/corral-core/src/action.rs`,
 * wire-compatible with the Rust serde format.
 */

import { z } from "zod";

import { TokenAmountSchema } from "./amount.js";
import { ActionKindSchema, AddressSchema, AssetRefSchema, type ActionKind } from "./policy.js";

/** 32-byte hex value (session/strategy ids), lowercase-normalized. */
export const B256Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex value")
  .transform((s) => s.toLowerCase());
export type B256 = z.infer<typeof B256Schema>;

/**
 * One primitive from the closed DSL. There is deliberately no variant that
 * carries raw calldata, an arbitrary target, or a delegatecall. The tag
 * names match `ActionKind`'s wire names one-to-one.
 */
export const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("SWAP"),
    asset_in: AssetRefSchema,
    asset_out: AssetRefSchema,
    amount_in: TokenAmountSchema,
    /** Enforced on-chain via the GTE rule on `amountOutMinimum` (FR-5.2). */
    min_amount_out: TokenAmountSchema,
  }),
  z.strictObject({
    action: z.literal("TRANSFER"),
    asset: AssetRefSchema,
    to: AddressSchema,
    amount: TokenAmountSchema,
  }),
  z.strictObject({
    action: z.literal("APPROVE"),
    asset: AssetRefSchema,
    spender: AddressSchema,
    /**
     * Always exact and per-execution — the parse-time unbounded-approval
     * invariant (FR-2.12) makes anything else unencodable anyway.
     */
    amount: TokenAmountSchema,
  }),
  z.strictObject({ action: z.literal("WRAP"), amount: TokenAmountSchema }),
  z.strictObject({ action: z.literal("UNWRAP"), amount: TokenAmountSchema }),
]);
export type Action = z.infer<typeof ActionSchema>;

/** The policy-scope kind of this action (total: the tag IS the kind). */
export function actionKind(a: Action): ActionKind {
  return a.action;
}

/**
 * A typed, ordered execution bundle derived from an Intent (PRD §5).
 *
 * The compiler turns this into calldata deterministically; the journal call
 * is appended there, not modelled here. `strategy_id` is nullable but never
 * absent — wire parity with the Rust `Option<B256>`.
 */
export const PlanSchema = z.strictObject({
  chain_id: z.number().int().positive(),
  session_id: B256Schema,
  strategy_id: B256Schema.nullable(),
  /**
   * Monotonic per-session sequence number; part of the idempotency key and
   * the journal entry (FR-3.4).
   */
  seq: z.number().int().min(0).max(4294967295),
  actions: z.array(ActionSchema),
});
export type Plan = z.infer<typeof PlanSchema>;

/** Strict parse; the only way a wire payload becomes a `Plan`. */
export function parsePlan(input: unknown): Plan {
  return PlanSchema.parse(input);
}

/**
 * Wire form with every `TokenAmount` as a decimal string, safe for
 * `JSON.stringify`. Round-trip law: `parsePlan(planToWire(p))` equals `p`.
 */
export function planToWire(p: Plan): Record<string, unknown> {
  return {
    chain_id: p.chain_id,
    session_id: p.session_id,
    strategy_id: p.strategy_id,
    seq: p.seq,
    actions: p.actions.map((a) => {
      switch (a.action) {
        case "SWAP":
          return {
            action: a.action,
            asset_in: a.asset_in,
            asset_out: a.asset_out,
            amount_in: a.amount_in.toString(10),
            min_amount_out: a.min_amount_out.toString(10),
          };
        case "TRANSFER":
          return { action: a.action, asset: a.asset, to: a.to, amount: a.amount.toString(10) };
        case "APPROVE":
          return { action: a.action, asset: a.asset, spender: a.spender, amount: a.amount.toString(10) };
        case "WRAP":
        case "UNWRAP":
          return { action: a.action, amount: a.amount.toString(10) };
      }
    }),
  };
}
