// FR-7.1 / FR-7.3 / FR-6.5 — the canonical event schema.
//
// The feed is the only place most users will ever check what their agent
// actually did. So: no float anywhere, slippage that can report an
// improvement as an improvement, and gas that cannot be mistaken for a spend
// against the budget.

import { describe, expect, test } from "vitest";
import {
  CorralEventSchema,
  EVENT_KINDS,
  eventToWire,
  gasCostWei,
  parseCorralEvent,
  slippageBps,
  tokenAmount,
} from "../src/index.js";

const ACCOUNT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const WETH = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" };

function baseEvent(): Record<string, unknown> {
  return {
    kind: "EXECUTION_SUCCEEDED",
    at: 1_756_600_000,
    chainId: 84532,
    account: ACCOUNT,
    permissionId: `0x${"e5".repeat(32)}`,
    executionId: "exec-1",
    strategyId: "strat-1",
    seq: 3,
    intentHash: `0x${"11".repeat(32)}`,
    txHash: `0x${"22".repeat(32)}`,
    blockNumber: 45_834_924,
    swap: {
      assetIn: USDC,
      assetOut: WETH,
      amountIn: "125000000",
      quotedOut: "1000000000000000000",
      realisedOut: "998000000000000000",
      minAmountOut: "980000000000000000",
      slippageBps: 20,
      venue: "uniswap-v3",
    },
    gas: {
      gasUsed: "180000",
      effectiveGasPriceWei: "1500000",
      costWei: "270000000000",
      paidBy: "SPONSOR",
    },
    errorCode: null,
    detail: {},
  };
}

describe("event schema", () => {
  test("parses a complete swap event", () => {
    const e = parseCorralEvent(baseEvent());
    expect(e.kind).toBe("EXECUTION_SUCCEEDED");
    expect(e.swap?.amountIn).toBe(tokenAmount(125_000_000n));
    expect(e.gas?.costWei).toBe(tokenAmount(270_000_000_000n));
  });

  test("rejects an unmodelled event kind", () => {
    // A kind the UI has no copy for is a raw revert string waiting to reach
    // a user.
    expect(() => parseCorralEvent({ ...baseEvent(), kind: "SOMETHING_NEW" })).toThrow();
  });

  test("rejects an extra field rather than passing it through", () => {
    expect(() => parseCorralEvent({ ...baseEvent(), surprise: 1 })).toThrow();
  });

  test("refuses a bare JSON number for any amount", () => {
    const e = baseEvent();
    (e["swap"] as Record<string, unknown>)["amountIn"] = 125000000;
    expect(() => parseCorralEvent(e)).toThrow();
  });

  test("every declared kind actually parses", () => {
    for (const kind of EVENT_KINDS) {
      expect(() => parseCorralEvent({ ...baseEvent(), kind, swap: null, gas: null })).not.toThrow();
    }
  });

  test("an event with no trade and no gas is still valid", () => {
    // Rejections and skips never reach the chain, so they have neither.
    const e = parseCorralEvent({ ...baseEvent(), kind: "EXECUTION_REJECTED", swap: null, gas: null, errorCode: "POLICY_BUDGET_EXCEEDED" });
    expect(e.swap).toBeNull();
    expect(e.errorCode).toBe("POLICY_BUDGET_EXCEEDED");
  });

  test("round-trips through the wire form", () => {
    const e = parseCorralEvent(baseEvent());
    const wire = eventToWire(e);
    expect(() => JSON.stringify(wire)).not.toThrow();
    expect(parseCorralEvent(JSON.parse(JSON.stringify(wire)))).toEqual(e);
  });
});

describe("slippage", () => {
  test("reports a worse-than-quoted fill as positive basis points", () => {
    expect(slippageBps(1_000_000_000_000_000_000n, 998_000_000_000_000_000n)).toBe(20n);
  });

  test("reports a better-than-quoted fill as negative — not as a loss", () => {
    // Positive-only slippage would render an improvement as damage.
    expect(slippageBps(1_000_000_000_000_000_000n, 1_002_000_000_000_000_000n)).toBe(-20n);
  });

  test("an exact fill is zero", () => {
    expect(slippageBps(500n, 500n)).toBe(0n);
  });

  test("a missing quote is zero, not a perfect fill claim", () => {
    expect(slippageBps(0n, 999n)).toBe(0n);
  });

  test("clamps rather than overflowing on absurd inputs", () => {
    // The clamp is what makes the single Number() narrowing at the event
    // boundary safe.
    expect(slippageBps(1n, 0n)).toBe(10_000n);
    expect(slippageBps(1n, 1_000_000n)).toBe(-10_000n);
  });

  test("survives 18-decimal magnitudes exactly", () => {
    // A float would lose the distinction between these two entirely.
    const quoted = 1_234_567_890_123_456_789n;
    expect(slippageBps(quoted, quoted - 1n)).toBe(0n);
    expect(slippageBps(quoted, (quoted * 9n) / 10n)).toBe(1000n);
  });
});

describe("gas", () => {
  test("cost is the exact wei product", () => {
    expect(gasCostWei(180_000n, 1_500_000n)).toBe(270_000_000_000n);
  });

  test("does not overflow at realistic mainnet magnitudes", () => {
    expect(gasCostWei(30_000_000n, 500_000_000_000n)).toBe(15_000_000_000_000_000_000n);
  });

  test("gas lives in its own object, so it cannot be summed into a spend", () => {
    // There is no shape of CorralEvent in which a gas figure sits alongside
    // the asset amounts as a peer.
    const shape = CorralEventSchema.shape;
    expect(Object.keys(shape)).toContain("gas");
    expect(Object.keys(shape)).not.toContain("gasUsed");
    expect(Object.keys(shape)).not.toContain("costWei");
  });

  test("records who paid, because sponsorship changes what the number means", () => {
    const e = parseCorralEvent(baseEvent());
    expect(e.gas?.paidBy).toBe("SPONSOR");
    expect(() => parseCorralEvent({ ...baseEvent(), gas: { ...(baseEvent()["gas"] as object), paidBy: "SOMEONE" } })).toThrow();
  });
});
