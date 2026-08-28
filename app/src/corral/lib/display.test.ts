/**
 * FR-6.4 / FR-6.5 / FR-11.8 — the display layer.
 *
 * Nothing here reimplements a rule; these tests check that the arranging is
 * honest. The freshness helpers matter more than they look: a stale number
 * presented as current is worse than no number, because the user acts on it.
 */
import { describe, expect, it } from "vitest";

import { amount, explain, freshness, isStale, percentUsed, present, summarise, wei } from "./display";

describe("amounts", () => {
  it("scales a known token", () => {
    expect(amount("125000000", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC")).toBe("125 USDC");
  });

  it("says 'smallest units' rather than guessing a scale it does not know", () => {
    // Guessing 18 for a 6-decimal token understates a cap by a trillion.
    expect(amount("125000000", "0xffff000000000000000000000000000000000000", "MYST")).toContain("smallest units");
  });

  it("renders a missing amount as a dash, not as zero", () => {
    // Zero is a claim; "we don't know" is not.
    expect(amount(null, null)).toBe("—");
  });

  it("keeps every digit at 18 decimals", () => {
    expect(wei("1234000000000000000001")).toBe("1234.000000000000000001 ETH");
  });
});

describe("budget percentage", () => {
  it("is integer basis-point math, never a float", () => {
    expect(percentUsed("500", "1000")).toBe(50);
    expect(percentUsed("999", "1000")).toBe(99);
  });

  it("clamps at 100 rather than reporting an overspend that cannot happen", () => {
    expect(percentUsed("2000", "1000")).toBe(100);
  });

  it("does not divide by a zero limit", () => {
    expect(percentUsed("5", "0")).toBe(0);
  });

  it("survives 18-decimal magnitudes", () => {
    expect(percentUsed("500000000000000000", "1000000000000000000")).toBe(50);
  });
});

describe("freshness (FR-6.4)", () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");

  it("reports seconds, minutes, hours and days", () => {
    expect(freshness("2026-08-27T11:59:48.000Z", now)).toBe("12s ago");
    expect(freshness("2026-08-27T11:30:00.000Z", now)).toBe("30 min ago");
    expect(freshness("2026-08-27T09:00:00.000Z", now)).toBe("3h ago");
    expect(freshness("2026-08-25T12:00:00.000Z", now)).toBe("2d ago");
  });

  it("says 'never read' rather than inventing a time", () => {
    expect(freshness(null, now)).toBe("never read");
  });

  it("treats a never-read figure as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("marks an old reading stale so the UI can say so", () => {
    expect(isStale("2026-08-27T11:50:00.000Z", now)).toBe(true);
    expect(isStale("2026-08-27T11:59:30.000Z", now)).toBe(false);
  });
});

describe("error copy (FR-11.8)", () => {
  it("maps a known code to a sentence", () => {
    const message = explain("POLICY_BUDGET_EXCEEDED");
    expect(message).not.toContain("POLICY_BUDGET_EXCEEDED");
    expect(message.length).toBeGreaterThan(10);
  });

  it("falls back rather than printing an unknown code", () => {
    expect(explain("WHAT_IS_THIS")).not.toContain("WHAT_IS_THIS");
  });

  it("has copy for a missing code too", () => {
    expect(explain(null)).toBe("Something went wrong.");
  });
});

describe("status presentation (FR-11.6)", () => {
  it("gives a rejection its own tone and reassuring words", () => {
    const p = present("REJECTED", "POLICY_BUDGET_EXCEEDED");
    expect(p.tone).toBe("refused");
    expect(p.explanation).toMatch(/limits worked/i);
  });

  it("keeps failures and aborts in the failure tone", () => {
    expect(present("FAILED", null).tone).toBe("failure");
    expect(present("ABORTED", null).tone).toBe("failure");
  });

  it("does not claim an outcome for an in-flight run", () => {
    expect(present("SUBMITTED", null).tone).toBe("pending");
  });

  it("degrades safely on a status it does not model", () => {
    expect(present("TELEPORTED", null).label).toBe("Unknown");
  });
});

describe("summarise", () => {
  it("passes the known decimals through, so caps render in real units", () => {
    const s = summarise({
      version: 1,
      chain_id: 84532,
      asset_scope: [{ symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }],
      budgets: [
        { asset: { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }, max_total: 500_000_000n },
      ],
      max_native_value: 0n,
      target_scope: [],
      action_scope: ["SWAP"],
      valid_after: 1_754_000_000,
      valid_until: 1_756_600_000,
      max_executions: 8,
      max_executions_per_24h: 2,
      min_output_bps: 9800,
    } as never);
    expect(s.spendCaps[0]?.display).toBe("500 USDC");
    expect(s.spendCaps[0]?.decimalsKnown).toBe(true);
  });
});
