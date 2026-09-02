/**
 * The remaining strategy kinds (C-603, C-604) and the strategy lifecycle
 * (C-605, FR-9.5, FR-9.6).
 *
 * Every strategy compiles to a Plan of the same primitive Actions, and none
 * has a privileged execution path (FR-9.4). That is deliberate and it is what
 * keeps the surface small: a new strategy is a new way of choosing an
 * *amount*, never a new way of reaching the chain.
 *
 * The two additions:
 *
 *  - `DCA_PERCENT` spends a share of the current balance instead of a fixed
 *    amount. The balance is an input, not a decision — it is read once and
 *    passed in, so the planner stays a pure function.
 *
 *  - `CONDITIONAL_PRICE` fires only when a price condition holds. The trigger
 *    is evaluated off-chain, which sounds alarming until you notice what it
 *    cannot do: an attacker who lies about the price still cannot exceed the
 *    budget, reach a new destination, or beat `amountOutMinimum`, because the
 *    condition is not what constrains the trade — the policy is. The trigger
 *    decides *whether*, never *what* (FR-9.3).
 */
import { parsePlan, type AssetRef, type Plan } from "@corral/core";
import { z } from "zod";

import { DcaFixedConfigSchema, MAX_SHARE_OF_REMAINING_BPS, PlanUnsafe, type PlanContext } from "./deterministic.js";

// ── Configuration ───────────────────────────────────────────────────────────

const AssetSchema = z.strictObject({ symbol: z.string(), address: z.string() });

/** FR-9.2 — swap a percentage of the account's balance each interval. */
export const DcaPercentConfigSchema = z.strictObject({
  kind: z.literal("DCA_PERCENT"),
  venue: z.literal("uniswap-v3"),
  fee: z.union([z.literal(500), z.literal(3000), z.literal(10000)]),
  assetIn: AssetSchema,
  assetOut: AssetSchema,
  /**
   * Share of the balance, in basis points. Capped at the FR-4.7 sanity share
   * rather than at some rounder number, so a percent strategy can never be
   * *born* able to produce an unsafe plan — a typo cannot mean "everything".
   */
  shareBps: z.number().int().min(1).max(2500),
  /** Floor below which a run is skipped rather than dusted away in gas. */
  minAmountIn: z.string().regex(/^[0-9]+$/),
});
export type DcaPercentConfig = z.infer<typeof DcaPercentConfigSchema>;

/** FR-9.3 — fire a fixed-size swap only while a price condition holds. */
export const ConditionalPriceConfigSchema = z.strictObject({
  kind: z.literal("CONDITIONAL_PRICE"),
  venue: z.literal("uniswap-v3"),
  fee: z.union([z.literal(500), z.literal(3000), z.literal(10000)]),
  assetIn: AssetSchema,
  assetOut: AssetSchema,
  amountIn: z.string().regex(/^[0-9]+$/),
  /**
   * Fire when the quoted output for `amountIn` is at or above (`ABOVE`) or at
   * or below (`BELOW`) this threshold, in base units of `assetOut`.
   *
   * Expressed as an output quantity rather than a "price" on purpose: it is
   * the same quantity the on-chain `amountOutMinimum` rule constrains, so the
   * trigger and the enforcement speak one language.
   */
  direction: z.enum(["ABOVE", "BELOW"]),
  thresholdOut: z.string().regex(/^[0-9]+$/),
});
export type ConditionalPriceConfig = z.infer<typeof ConditionalPriceConfigSchema>;

export const StrategyConfigSchema = z.discriminatedUnion("kind", [
  DcaFixedConfigSchema,
  DcaPercentConfigSchema,
  ConditionalPriceConfigSchema,
]);
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;
export type StrategyKind = StrategyConfig["kind"];

// ── Shared bound ────────────────────────────────────────────────────────────

function assertWithinBounds(amountIn: bigint, remainingBudget: bigint): void {
  if (amountIn <= 0n) throw new PlanUnsafe("amountIn must be positive");
  if (amountIn > remainingBudget) {
    throw new PlanUnsafe(`amountIn ${amountIn.toString(10)} exceeds remaining budget ${remainingBudget.toString(10)}`);
  }
  // Integer basis points, no division into the comparison.
  if (remainingBudget > 0n && amountIn * 10_000n > remainingBudget * MAX_SHARE_OF_REMAINING_BPS) {
    throw new PlanUnsafe(
      `amountIn is more than ${(MAX_SHARE_OF_REMAINING_BPS / 100n).toString(10)}% of the remaining budget`,
    );
  }
}

const asAsset = (a: { symbol: string; address: string }): AssetRef => ({
  symbol: a.symbol,
  address: a.address.toLowerCase(),
});

function swapPlan(
  config: { assetIn: { symbol: string; address: string }; assetOut: { symbol: string; address: string } },
  ctx: PlanContext,
  amountIn: bigint,
): Plan {
  if (ctx.quote.minAmountOut <= 0n) throw new PlanUnsafe("quote produced a zero output floor");
  return parsePlan({
    chain_id: ctx.chainId,
    session_id: ctx.permissionId,
    strategy_id: ctx.strategyIdB32,
    seq: ctx.seq,
    actions: [
      {
        action: "APPROVE",
        asset: asAsset(config.assetIn),
        spender: ctx.spender.toLowerCase(),
        amount: amountIn.toString(10),
      },
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

// ── DCA_PERCENT ─────────────────────────────────────────────────────────────

/** Raised when a strategy legitimately has nothing to do this slot. */
export class NothingToDo extends Error {
  readonly code = "STRATEGY_SKIPPED" as const;
}

/**
 * Spend `shareBps` of the current balance, or skip.
 *
 * `balance` is supplied by the caller from a chain read: the planner stays
 * pure, and the same config with the same balance always yields the same plan.
 */
export function planDcaPercent(
  config: DcaPercentConfig,
  ctx: PlanContext,
  remainingBudget: bigint,
  balance: bigint,
): Plan {
  if (balance <= 0n) throw new NothingToDo("balance is zero");
  // Integer math: multiply first, then divide. The truncation is downward,
  // which is the safe direction for a spend.
  const amountIn = (balance * BigInt(config.shareBps)) / 10_000n;

  // Near the end of a budget the configured share can exceed what may safely
  // be spent in one run. That is a strategy reaching the end of its life, not
  // a suspicious plan — so it SKIPS rather than raising PLAN_UNSAFE_BOUNDS,
  // which is terminal and would dead-letter the strategy.
  //
  // The earlier version capped the amount to the whole remaining budget. That
  // was dead code: any amount large enough to be capped is by definition more
  // than 25% of what remains, so the cap could only ever lead to a rejection.
  const safeCeiling = (remainingBudget * MAX_SHARE_OF_REMAINING_BPS) / 10_000n;
  if (amountIn > safeCeiling) {
    throw new NothingToDo(
      `a run at ${String(config.shareBps)}bps of balance would spend ${amountIn.toString(10)}, ` +
        `more than the ${safeCeiling.toString(10)} that may safely be spent from the remaining budget`,
    );
  }
  if (amountIn < BigInt(config.minAmountIn)) {
    throw new NothingToDo(
      `computed amount ${amountIn.toString(10)} is below the configured floor ${config.minAmountIn}`,
    );
  }
  // Belt and braces: with the schema cap and the ceiling check above this is
  // unreachable, which is the point — an unsafe percent plan is not merely
  // rejected, it is unrepresentable.
  assertWithinBounds(amountIn, remainingBudget);
  return swapPlan(config, ctx, amountIn);
}

// ── CONDITIONAL_PRICE ───────────────────────────────────────────────────────

/**
 * Fire only while the condition holds.
 *
 * The trigger is evaluated here, off-chain, from the same quote the trade
 * will use. What bounds the trade is not this comparison but the policy: a
 * false trigger still cannot exceed the budget, reach a new destination, or
 * defeat the on-chain `amountOutMinimum`. The worst a lying price feed buys
 * is a trade the user permitted, at a moment they did not intend.
 */
export function planConditionalPrice(
  config: ConditionalPriceConfig,
  ctx: PlanContext,
  remainingBudget: bigint,
): Plan {
  const threshold = BigInt(config.thresholdOut);
  const quoted = ctx.quote.amountOut;
  const holds = config.direction === "ABOVE" ? quoted >= threshold : quoted <= threshold;
  if (!holds) {
    throw new NothingToDo(
      `condition not met: quoted ${quoted.toString(10)} is not ${config.direction} ${threshold.toString(10)}`,
    );
  }
  const amountIn = BigInt(config.amountIn);
  assertWithinBounds(amountIn, remainingBudget);
  return swapPlan(config, ctx, amountIn);
}

// ── Lifecycle (FR-9.5) ──────────────────────────────────────────────────────

export const STRATEGY_STATES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "EXPIRED", "REVOKED"] as const;
export type StrategyState = (typeof STRATEGY_STATES)[number];

/**
 * The legal transitions, enforced in code rather than trusted to callers.
 * Terminal states have no way out — a completed strategy that could be
 * reactivated would silently reopen a budget the user considers spent.
 */
const TRANSITIONS: Readonly<Record<StrategyState, readonly StrategyState[]>> = {
  DRAFT: ["ACTIVE", "REVOKED"],
  ACTIVE: ["PAUSED", "COMPLETED", "EXPIRED", "REVOKED"],
  PAUSED: ["ACTIVE", "COMPLETED", "EXPIRED", "REVOKED"],
  COMPLETED: [],
  EXPIRED: [],
  REVOKED: [],
};

export class IllegalTransition extends Error {
  constructor(
    readonly from: StrategyState,
    readonly to: StrategyState,
  ) {
    super(`illegal strategy transition ${from} → ${to}`);
    this.name = "IllegalTransition";
  }
}

export function canTransition(from: StrategyState, to: StrategyState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: StrategyState, to: StrategyState): void {
  if (!canTransition(from, to)) throw new IllegalTransition(from, to);
}

// ── Compatibility (FR-9.6, C-605) ───────────────────────────────────────────

export interface Incompatibility {
  readonly reason: string;
  readonly detail: Record<string, unknown>;
}

interface PolicyShape {
  readonly asset_scope?: { symbol: string; address: string | null }[];
  readonly target_scope?: {
    address: string;
    action: string;
    param_rules?: ({ rule: string; max?: string } | Record<string, unknown>)[];
  }[];
  readonly action_scope?: string[];
  readonly budgets?: { asset: { address: string | null }; max_total: string }[];
  readonly valid_until?: number;
}

/**
 * Can this strategy ever run under this session's policy?
 *
 * Checked at creation, with a specific reason, because the alternative is a
 * strategy that looks fine, sits in the queue, and fails at execution time
 * with a policy rejection the user never asked for. "Your agent cannot trade
 * WETH because the session only covers USDC" belongs on the creation screen,
 * not in the activity feed a week later.
 */
export function checkStrategyCompatibility(config: StrategyConfig, policy: unknown): Incompatibility[] {
  const p = policy as PolicyShape;
  const problems: Incompatibility[] = [];

  const scope = (p.asset_scope ?? []).map((a) => (a.address ?? "native").toLowerCase());
  const inAddr = config.assetIn.address.toLowerCase();
  if (scope.length > 0 && !scope.includes(inAddr)) {
    problems.push({
      reason: `the session does not allow spending ${config.assetIn.symbol}`,
      detail: { asset: inAddr, allowed: scope },
    });
  }

  const actions = p.action_scope ?? [];
  for (const needed of ["APPROVE", "SWAP"]) {
    if (actions.length > 0 && !actions.includes(needed)) {
      problems.push({ reason: `the session does not permit ${needed} actions`, detail: { allowed: actions } });
    }
  }

  // A per-execution ceiling the strategy would exceed on its very first run.
  const perExecution = (p.target_scope ?? [])
    .filter((t) => t.address.toLowerCase() === inAddr || t.action === "SWAP")
    .flatMap((t) => t.param_rules ?? [])
    .filter((r): r is { rule: string; max: string } => (r as { rule?: string }).rule === "LTE" && typeof (r as { max?: string }).max === "string")
    .map((r) => BigInt(r.max))
    .reduce<bigint | null>((acc, x) => (acc === null || x > acc ? x : acc), null);

  if (perExecution !== null) {
    const fixed =
      config.kind === "DCA_FIXED" ? BigInt(config.amountIn) : config.kind === "CONDITIONAL_PRICE" ? BigInt(config.amountIn) : null;
    if (fixed !== null && fixed > perExecution) {
      problems.push({
        reason: `each run would spend more than the session's per-execution limit`,
        detail: { perRun: fixed.toString(10), limit: perExecution.toString(10) },
      });
    }
  }

  // A budget that cannot fund even one run.
  const budget = (p.budgets ?? []).find((b) => (b.asset.address ?? "native").toLowerCase() === inAddr);
  if (budget) {
    const total = BigInt(budget.max_total);
    const oneRun = config.kind === "DCA_PERCENT" ? BigInt(config.minAmountIn) : BigInt(config.amountIn);
    if (oneRun > total) {
      problems.push({
        reason: `the session's total budget cannot fund a single run`,
        detail: { perRun: oneRun.toString(10), budget: total.toString(10) },
      });
    }
  }

  return problems;
}
