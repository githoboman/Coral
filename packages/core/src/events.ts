/**
 * The canonical event schema (FR-7.1, C-104).
 *
 * One definition, shared by the indexer that produces these, the API that
 * serves them, and the UI that renders them. The requirement that it live
 * here is not tidiness: an activity feed is the only place most users will
 * ever check what their agent actually did, and a feed whose shape is
 * redefined at each hop is a feed that can disagree with itself.
 *
 * Everything monetary is a decimal string in base units — the same wire form
 * as `TokenAmount` — so no consumer is ever handed a float to round.
 */

import { z } from "zod";

import { TokenAmountSchema } from "./amount.js";
import { B256Schema } from "./action.js";
import { AddressSchema, AssetRefSchema } from "./policy.js";

/**
 * What happened, in the user's terms rather than the chain's.
 *
 * Deliberately a closed set: a feed entry the UI has no copy for is a raw
 * revert string waiting to reach a user (FR-11.8).
 */
export const EVENT_KINDS = [
  "SESSION_INSTALLED",
  "SESSION_VERIFIED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "SESSION_PAUSED",
  "EXECUTION_PLANNED",
  "EXECUTION_SUBMITTED",
  "EXECUTION_SUCCEEDED",
  "EXECUTION_FAILED",
  "EXECUTION_REJECTED",
  "EXECUTION_SKIPPED",
  "BUDGET_THRESHOLD",
  "ANOMALY_DETECTED",
] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

/**
 * The trade detail of a completed swap (FR-7.3).
 *
 * `slippageBps` is signed: negative means the trade came out *better* than
 * quoted, which happens and should not be rendered as a loss.
 */
export const SwapDetailSchema = z.strictObject({
  assetIn: AssetRefSchema,
  assetOut: AssetRefSchema,
  amountIn: TokenAmountSchema,
  /** What the quote promised at plan time. */
  quotedOut: TokenAmountSchema,
  /** What the chain actually delivered. */
  realisedOut: TokenAmountSchema,
  /** The floor that was enforced on-chain. */
  minAmountOut: TokenAmountSchema,
  /** (quoted − realised) / quoted, in basis points. Negative = better than quoted. */
  slippageBps: z.number().int().min(-10_000).max(10_000),
  venue: z.string().min(1),
});
export type SwapDetail = z.infer<typeof SwapDetailSchema>;

/**
 * Gas, always reported apart from the user's asset budget (FR-6.5).
 *
 * Keeping this in its own object rather than as loose fields is the point:
 * there is no shape of this type in which a gas cost can be added to a spend
 * total by accident.
 */
export const GasDetailSchema = z.strictObject({
  gasUsed: TokenAmountSchema,
  effectiveGasPriceWei: TokenAmountSchema,
  /** gasUsed × effectiveGasPrice, in wei. Never denominated in the budget asset. */
  costWei: TokenAmountSchema,
  /** Who paid: the account itself, or Corral's relayer via sponsorship. */
  paidBy: z.enum(["ACCOUNT", "SPONSOR"]),
});
export type GasDetail = z.infer<typeof GasDetailSchema>;

export const CorralEventSchema = z.strictObject({
  kind: EventKindSchema,
  /** Unix seconds. Block time where the event is on-chain, our clock otherwise. */
  at: z.number().int().nonnegative(),
  chainId: z.number().int().positive(),
  account: AddressSchema,
  /** SmartSessions permissionId — the on-chain identity, not a database id. */
  permissionId: B256Schema.nullable(),
  /** Our execution row, when the event belongs to one. */
  executionId: z.string().min(1).nullable(),
  strategyId: z.string().min(1).nullable(),
  seq: z.number().int().min(0).nullable(),
  intentHash: B256Schema.nullable(),
  txHash: B256Schema.nullable(),
  blockNumber: z.number().int().nonnegative().nullable(),
  swap: SwapDetailSchema.nullable(),
  gas: GasDetailSchema.nullable(),
  /**
   * `@corral/core` error code for a failure. Never a revert string: the UI
   * maps this through `userMessage()` (FR-11.8).
   */
  errorCode: z.string().min(1).nullable(),
  /** Free-form context for operators. Not rendered to users verbatim. */
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type CorralEvent = z.infer<typeof CorralEventSchema>;

export function parseCorralEvent(input: unknown): CorralEvent {
  return CorralEventSchema.parse(input);
}

/**
 * Slippage of a realised trade against its quote, in basis points.
 *
 * Integer math throughout, and signed so an improvement is not silently
 * reported as a loss. Returns 0 when there was nothing to compare against —
 * a zero quote is a missing measurement, not a perfect fill.
 *
 * Returns a `bigint` even though the result is bounded to ±10000 and the
 * event schema carries it as a JSON number. Core bans `Number()` outright
 * (CLAUDE.md §2.10) and the rule is worth more than the convenience: the
 * single narrowing happens once, at the boundary that builds the event, where
 * the clamp below has already made it safe.
 */
export function slippageBps(quotedOut: bigint, realisedOut: bigint): bigint {
  if (quotedOut <= 0n) return 0n;
  const diff = (quotedOut - realisedOut) * 10_000n;
  // Truncates toward zero, which understates the magnitude by at most 1bp in
  // either direction — never flips the sign.
  const bps = diff / quotedOut;
  if (bps > 10_000n) return 10_000n;
  if (bps < -10_000n) return -10_000n;
  return bps;
}

/** Gas cost in wei. Separate from every asset figure, by construction. */
export function gasCostWei(gasUsed: bigint, effectiveGasPriceWei: bigint): bigint {
  return gasUsed * effectiveGasPriceWei;
}

/** Wire form: bigints become decimal strings, safe for `JSON.stringify`. */
export function eventToWire(e: CorralEvent): Record<string, unknown> {
  return {
    ...e,
    swap: e.swap
      ? {
          ...e.swap,
          amountIn: e.swap.amountIn.toString(10),
          quotedOut: e.swap.quotedOut.toString(10),
          realisedOut: e.swap.realisedOut.toString(10),
          minAmountOut: e.swap.minAmountOut.toString(10),
        }
      : null,
    gas: e.gas
      ? {
          ...e.gas,
          gasUsed: e.gas.gasUsed.toString(10),
          effectiveGasPriceWei: e.gas.effectiveGasPriceWei.toString(10),
          costWei: e.gas.costWei.toString(10),
        }
      : null,
  };
}
