/**
 * The deterministic planner (spec §8, FR-9.4).
 *
 * ALL autonomous execution goes through here. It is a pure function of
 * (strategy config, chain state, quote) — no model, no network, no clock
 * beyond what is passed in. That is what makes prompt injection unable to
 * cause an unattended execution (CLAUDE.md §2.7): nothing unattended ever
 * consults a model.
 *
 * The LLM authoring path proposes *configuration* for a human to review and
 * sign; it never reaches this file.
 */
import { parsePlan, type AssetRef, type Plan } from "@corral/core";
import { z } from "zod";

import type { Quote } from "../../evm/adapters/protocolAdapter.js";

/** Strategy configuration as stored in `corral_strategies.config`. */
export const DcaFixedConfigSchema = z.strictObject({
  kind: z.literal("DCA_FIXED"),
  venue: z.literal("uniswap-v3"),
  fee: z.union([z.literal(500), z.literal(3000), z.literal(10000)]),
  assetIn: z.strictObject({ symbol: z.string(), address: z.string() }),
  assetOut: z.strictObject({ symbol: z.string(), address: z.string() }),
  /** Base units per execution, decimal string (never a number — §2.10). */
  amountIn: z.string().regex(/^[0-9]+$/),
});
export type DcaFixedConfig = z.infer<typeof DcaFixedConfigSchema>;

export interface PlanContext {
  readonly chainId: number;
  /** The on-chain SmartSessions permissionId (bytes32) — NOT the database uuid. */
  readonly permissionId: string;
  /** bytes32 form of the strategy, journaled with the execution; null for one-offs. */
  readonly strategyIdB32: string | null;
  readonly seq: number;
  readonly spender: string;
  readonly quote: Quote;
}

/**
 * Sanity bounds (FR-4.7): a plan that would consume more than this share of
 * the remaining budget in one action is an anomaly, not a trade.
 */
export const MAX_SHARE_OF_REMAINING_BPS = 2500n; // 25%

export class PlanUnsafe extends Error {
  readonly code = "PLAN_UNSAFE_BOUNDS" as const;
}

/**
 * DCA: buy a fixed amount of `assetOut` with `assetIn` every interval.
 * Produces `[APPROVE exact amount, SWAP]`; the journal call is appended by
 * the compiler, never modelled here.
 */
export function planDcaFixed(config: DcaFixedConfig, ctx: PlanContext, remainingBudget: bigint): Plan {
  const amountIn = BigInt(config.amountIn);
  if (amountIn <= 0n) throw new PlanUnsafe("amountIn must be positive");
  if (amountIn > remainingBudget) throw new PlanUnsafe(`amountIn ${amountIn} exceeds remaining budget ${remainingBudget}`);
  if (remainingBudget > 0n && (amountIn * 10_000n) / remainingBudget > MAX_SHARE_OF_REMAINING_BPS) {
    throw new PlanUnsafe(`amountIn is ${(amountIn * 10_000n) / remainingBudget / 100n}% of the remaining budget (max ${MAX_SHARE_OF_REMAINING_BPS / 100n}%)`);
  }
  if (ctx.quote.minAmountOut <= 0n) throw new PlanUnsafe("quote produced a zero output floor");

  const asAsset = (a: { symbol: string; address: string }): AssetRef => ({ symbol: a.symbol, address: a.address.toLowerCase() });

  // Parsed, not constructed: the Plan crosses the same strict boundary as
  // anything arriving from the wire.
  return parsePlan({
    chain_id: ctx.chainId,
    session_id: ctx.permissionId,
    strategy_id: ctx.strategyIdB32,
    seq: ctx.seq,
    actions: [
      { action: "APPROVE", asset: asAsset(config.assetIn), spender: ctx.spender.toLowerCase(), amount: amountIn.toString(10) },
      {
        action: "SWAP",
        asset_in: asAsset(config.assetIn),
        asset_out: asAsset(config.assetOut),
        amount_in: amountIn.toString(10),
        min_amount_out: ctx.quote.minAmountOut.toString(10),
      },
    ],
  });
}
