/**
 * FR-9.2, FR-9.3, FR-9.5, FR-9.6 — the remaining strategies, their lifecycle,
 * and the creation-time compatibility check.
 *
 * The assertions worth reading are the negative ones. A strategy must never be
 * able to produce a plan that spends more than the policy allows, and the
 * price trigger must never be able to influence anything except *whether* a
 * permitted trade happens.
 */
import { describe, expect, it } from "vitest";

import type { PlanContext } from "../deterministic.js";
import { PlanUnsafe } from "../deterministic.js";
import {
  assertTransition,
  canTransition,
  checkStrategyCompatibility,
  ConditionalPriceConfigSchema,
  DcaPercentConfigSchema,
  IllegalTransition,
  NothingToDo,
  planConditionalPrice,
  planDcaPercent,
  STRATEGY_STATES,
  type StrategyState,
} from "../strategies.js";

const USDC = "0x833589FCD6EDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function ctx(amountOut = 1_000_000_000_000_000_000n): PlanContext {
  return {
    chainId: 84532,
    permissionId: `0x${"e5".repeat(32)}`,
    strategyIdB32: `0x${"11".repeat(32)}`,
    seq: 1,
    spender: PERMIT2,
    quote: { amountOut, minAmountOut: (amountOut * 9800n) / 10_000n, venue: "uniswap-v3" },
  };
}

const percentConfig = DcaPercentConfigSchema.parse({
  kind: "DCA_PERCENT",
  venue: "uniswap-v3",
  fee: 3000,
  assetIn: { symbol: "USDC", address: USDC },
  assetOut: { symbol: "WETH", address: WETH },
  shareBps: 1000, // 10%
  minAmountIn: "1000000",
});

const conditionalConfig = ConditionalPriceConfigSchema.parse({
  kind: "CONDITIONAL_PRICE",
  venue: "uniswap-v3",
  fee: 3000,
  assetIn: { symbol: "USDC", address: USDC },
  assetOut: { symbol: "WETH", address: WETH },
  amountIn: "100000000",
  direction: "ABOVE",
  thresholdOut: "500000000000000000",
});

// ── DCA_PERCENT (FR-9.2) ────────────────────────────────────────────────────

describe("DCA_PERCENT", () => {
  it("spends the configured share of the balance", () => {
    const plan = planDcaPercent(percentConfig, ctx(), 10_000_000_000n, 1_000_000_000n);
    const swap = plan.actions.find((a) => a.action === "SWAP");
    expect(swap?.action === "SWAP" && swap.amount_in).toBe(100_000_000n); // 10% of 1e9
  });

  it("truncates downward — the safe direction for a spend", () => {
    // 999 * 1000 / 10000 = 99.9 → 99, never 100.
    const cfg = DcaPercentConfigSchema.parse({ ...percentConfig, minAmountIn: "1" });
    const plan = planDcaPercent(cfg, ctx(), 10_000n, 999n);
    const swap = plan.actions.find((a) => a.action === "SWAP");
    expect(swap?.action === "SWAP" && swap.amount_in).toBe(99n);
  });

  it("skips when what remains cannot fund a run at the configured share", () => {
    // End of budget: 10% of a large balance far exceeds the 25% of what is
    // left that may safely go out in one run. This is a strategy reaching the
    // end of its life, so it SKIPS — raising PLAN_UNSAFE_BOUNDS here would be
    // terminal and would dead-letter a perfectly well-behaved strategy.
    const cfg = DcaPercentConfigSchema.parse({ ...percentConfig, minAmountIn: "1" });
    expect(() => planDcaPercent(cfg, ctx(), 500n, 10_000_000_000n)).toThrow(NothingToDo);
  });

  it("still runs while the remaining budget comfortably covers the share", () => {
    const cfg = DcaPercentConfigSchema.parse({ ...percentConfig, minAmountIn: "1" });
    const plan = planDcaPercent(cfg, ctx(), 10_000_000_000n, 1_000_000_000n);
    const swap = plan.actions.find((a) => a.action === "SWAP");
    expect(swap?.action === "SWAP" && swap.amount_in).toBe(100_000_000n);
  });

  it("skips rather than dusting when the computed amount is below the floor", () => {
    expect(() => planDcaPercent(percentConfig, ctx(), 10_000_000_000n, 100n)).toThrow(NothingToDo);
  });

  it("skips on a zero balance instead of planning a no-op trade", () => {
    expect(() => planDcaPercent(percentConfig, ctx(), 10_000_000_000n, 0n)).toThrow(NothingToDo);
  });

  it("cannot be configured above the FR-4.7 sanity share at all", () => {
    // The schema cap plus the remaining-budget ceiling together make an
    // unsafe percent plan unrepresentable rather than merely rejected.
    expect(() => DcaPercentConfigSchema.parse({ ...percentConfig, shareBps: 2501 })).toThrow();
    expect(() => DcaPercentConfigSchema.parse({ ...percentConfig, shareBps: 9000 })).toThrow();
    expect(() => DcaPercentConfigSchema.parse({ ...percentConfig, shareBps: 0 })).toThrow();
  });

  it("emits an exact approval, never an unbounded one", () => {
    const plan = planDcaPercent(percentConfig, ctx(), 10_000_000_000n, 1_000_000_000n);
    const approve = plan.actions.find((a) => a.action === "APPROVE");
    const swap = plan.actions.find((a) => a.action === "SWAP");
    expect(approve?.action === "APPROVE" && approve.amount).toBe(swap?.action === "SWAP" ? swap.amount_in : null);
  });
});

// ── CONDITIONAL_PRICE (FR-9.3) ──────────────────────────────────────────────

describe("CONDITIONAL_PRICE", () => {
  it("fires when the quoted output is at or above the threshold", () => {
    const plan = planConditionalPrice(conditionalConfig, ctx(600_000_000_000_000_000n), 10_000_000_000n);
    expect(plan.actions).toHaveLength(2);
  });

  it("fires exactly at the threshold, not only past it", () => {
    const plan = planConditionalPrice(conditionalConfig, ctx(500_000_000_000_000_000n), 10_000_000_000n);
    expect(plan.actions).toHaveLength(2);
  });

  it("skips when the condition does not hold", () => {
    expect(() => planConditionalPrice(conditionalConfig, ctx(400_000_000_000_000_000n), 10_000_000_000n)).toThrow(
      NothingToDo,
    );
  });

  it("supports the BELOW direction", () => {
    const below = ConditionalPriceConfigSchema.parse({ ...conditionalConfig, direction: "BELOW" });
    expect(() => planConditionalPrice(below, ctx(600_000_000_000_000_000n), 10_000_000_000n)).toThrow(NothingToDo);
    expect(planConditionalPrice(below, ctx(400_000_000_000_000_000n), 10_000_000_000n).actions).toHaveLength(2);
  });

  it("a satisfied trigger still cannot exceed the budget", () => {
    // The whole security argument for an off-chain trigger: a lying price
    // feed buys a permitted trade at an unintended moment, nothing more.
    expect(() => planConditionalPrice(conditionalConfig, ctx(9_000_000_000_000_000_000n), 1_000n)).toThrow(PlanUnsafe);
  });

  it("the trigger never changes the amount or the destination", () => {
    const high = planConditionalPrice(conditionalConfig, ctx(9_000_000_000_000_000_000n), 10_000_000_000n);
    const atThreshold = planConditionalPrice(conditionalConfig, ctx(500_000_000_000_000_000n), 10_000_000_000n);
    const amountOf = (p: typeof high): bigint | null => {
      const s = p.actions.find((a) => a.action === "SWAP");
      return s?.action === "SWAP" ? s.amount_in : null;
    };
    expect(amountOf(high)).toBe(amountOf(atThreshold));
    expect(amountOf(high)).toBe(100_000_000n);
  });

  it("refuses a quote with a zero output floor", () => {
    const zeroFloor: PlanContext = { ...ctx(600_000_000_000_000_000n), quote: { amountOut: 600_000_000_000_000_000n, minAmountOut: 0n, venue: "uniswap-v3" } };
    expect(() => planConditionalPrice(conditionalConfig, zeroFloor, 10_000_000_000n)).toThrow(PlanUnsafe);
  });
});

// ── Lifecycle (FR-9.5) ──────────────────────────────────────────────────────

describe("strategy lifecycle", () => {
  it("permits the documented forward transitions", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("has no way out of a terminal state", () => {
    // A completed strategy that could be reactivated would silently reopen a
    // budget the user considers spent.
    for (const terminal of ["COMPLETED", "EXPIRED", "REVOKED"] as StrategyState[]) {
      for (const to of STRATEGY_STATES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("refuses to skip DRAFT straight to PAUSED", () => {
    expect(() => assertTransition("DRAFT", "PAUSED")).toThrow(IllegalTransition);
  });

  it("names both ends of an illegal transition in the error", () => {
    try {
      assertTransition("COMPLETED", "ACTIVE");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as IllegalTransition).message).toContain("COMPLETED");
      expect((e as IllegalTransition).message).toContain("ACTIVE");
    }
  });

  it("every state is reachable from DRAFT", () => {
    // A state nothing can enter is dead configuration, and dead configuration
    // is where wrong assumptions hide.
    const seen = new Set<StrategyState>(["DRAFT"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const from of [...seen]) {
        for (const to of STRATEGY_STATES) {
          if (canTransition(from, to) && !seen.has(to)) {
            seen.add(to);
            grew = true;
          }
        }
      }
    }
    expect(seen.size).toBe(STRATEGY_STATES.length);
  });
});

// ── Compatibility (FR-9.6) ──────────────────────────────────────────────────

describe("strategy-vs-policy compatibility at creation", () => {
  const policy = {
    asset_scope: [{ symbol: "USDC", address: USDC.toLowerCase() }],
    action_scope: ["APPROVE", "SWAP"],
    budgets: [{ asset: { address: USDC.toLowerCase() }, max_total: "500000000" }],
    target_scope: [
      { address: ROUTER.toLowerCase(), action: "SWAP", param_rules: [{ rule: "LTE", max: "125000000" }] },
    ],
  };

  it("accepts a strategy the policy can actually run", () => {
    expect(checkStrategyCompatibility(conditionalConfig, policy)).toEqual([]);
  });

  it("rejects an asset outside the session's scope, by name", () => {
    const wrongAsset = ConditionalPriceConfigSchema.parse({
      ...conditionalConfig,
      assetIn: { symbol: "DAI", address: `0x${"12".repeat(20)}` },
    });
    const problems = checkStrategyCompatibility(wrongAsset, policy);
    expect(problems[0]?.reason).toContain("DAI");
  });

  it("rejects a per-run amount above the session's per-execution ceiling", () => {
    const tooBig = ConditionalPriceConfigSchema.parse({ ...conditionalConfig, amountIn: "200000000" });
    const problems = checkStrategyCompatibility(tooBig, policy);
    expect(problems.some((p) => p.reason.includes("per-execution limit"))).toBe(true);
  });

  it("rejects a strategy the total budget cannot fund even once", () => {
    const huge = ConditionalPriceConfigSchema.parse({ ...conditionalConfig, amountIn: "900000000" });
    const problems = checkStrategyCompatibility(huge, policy);
    expect(problems.some((p) => p.reason.includes("cannot fund a single run"))).toBe(true);
  });

  it("rejects a policy that does not permit the actions the strategy needs", () => {
    const noSwap = { ...policy, action_scope: ["APPROVE"] };
    const problems = checkStrategyCompatibility(conditionalConfig, noSwap);
    expect(problems.some((p) => p.reason.includes("SWAP"))).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    // A creation screen that fixes one error at a time is a bad screen.
    const bad = ConditionalPriceConfigSchema.parse({
      ...conditionalConfig,
      assetIn: { symbol: "DAI", address: `0x${"12".repeat(20)}` },
      amountIn: "900000000",
    });
    expect(checkStrategyCompatibility(bad, { ...policy, action_scope: ["APPROVE"] }).length).toBeGreaterThan(1);
  });
});
