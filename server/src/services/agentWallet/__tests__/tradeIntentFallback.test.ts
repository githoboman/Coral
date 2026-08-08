import { describe, it, expect } from "vitest";
import { parseIntentFallback } from "../tradeIntentFallback.js";

describe("parseIntentFallback", () => {
  it("parses a fixed market swap", () => {
    const i = parseIntentFallback("swap 100 SUI to USDC");
    expect(i.action).toBe("market_swap");
    expect(i.tokenIn).toBe("SUI");
    expect(i.tokenOut).toBe("USDC");
    expect(i.amount).toBe(100);
  });

  it("parses a percentage swap", () => {
    const i = parseIntentFallback("swap 30% of my SUI to USDC");
    expect(i.action).toBe("percentage_swap");
    expect(i.tokenIn).toBe("SUI");
    expect(i.tokenOut).toBe("USDC");
    expect(i.percentage).toBe(30);
  });

  it("parses a conditional (below) swap", () => {
    const i = parseIntentFallback("buy USDC if SUI drops below 0.25");
    expect(i.action).toBe("conditional_swap");
    expect(i.condition).toBe("below");
    expect(i.price).toBe(0.25);
    // The 0.25 is the price, not a trade amount — don't leak it into amount.
    expect(i.amount).toBeUndefined();
  });

  it("does not mistake a percentage for an amount", () => {
    const i = parseIntentFallback("swap 30% of my SUI to USDC");
    expect(i.percentage).toBe(30);
    expect(i.amount).toBeUndefined();
  });

  it("parses a conditional (above) swap", () => {
    const i = parseIntentFallback("sell when SUI rises above 1.5");
    expect(i.action).toBe("conditional_swap");
    expect(i.condition).toBe("above");
    expect(i.price).toBe(1.5);
  });

  it("parses a limit order with explicit keyword", () => {
    const i = parseIntentFallback("place a limit order to buy 10 SUI at 0.20");
    expect(i.action).toBe("limit_order");
    expect(i.price).toBe(0.2);
    expect(i.amount).toBe(10);
  });

  it("parses a scheduled swap with a time", () => {
    const i = parseIntentFallback("swap 50 SUI at 15:00 UTC");
    expect(i.action).toBe("scheduled_swap");
    expect(i.amount).toBe(50);
    expect(i.schedule?.toLowerCase()).toContain("15:00");
  });

  it("parses a relative scheduled swap", () => {
    const i = parseIntentFallback("swap 5 SUI in 10 minutes");
    expect(i.action).toBe("scheduled_swap");
    expect(i.schedule).toMatch(/in 10/i);
  });

  it("recognizes cancel", () => {
    expect(parseIntentFallback("cancel my orders").action).toBe("cancel");
  });

  it("defaults the pair to SUI/USDC when only one token is named", () => {
    const i = parseIntentFallback("swap 20 SUI");
    expect(i.tokenIn).toBe("SUI");
    expect(i.tokenOut).toBe("USDC");
  });

  it("returns unknown for non-trade text", () => {
    const i = parseIntentFallback("what's the weather today?");
    expect(i.action).toBe("unknown");
    expect(i.summary).toBeTruthy();
  });

  it("never invents an amount the user didn't give", () => {
    const i = parseIntentFallback("swap my SUI to USDC");
    // No number → not a market swap; should not fabricate an amount.
    expect(i.amount).toBeUndefined();
    expect(i.action).not.toBe("market_swap");
  });
});
