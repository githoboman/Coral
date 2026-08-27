// FR-11.1 acceptance — the plain-language "worst case" block is rendered by
// the same package that validates the policy. That is the requirement, not an
// implementation preference: it is what guarantees the sentence shown to the
// user is derived from the configuration that will actually be enforced
// on-chain, and cannot drift from it.
//
// The tests that matter here are the ones asserting the summary cannot
// *understate* the policy: an unpinned recipient, an uncapped destination, or
// an asset the summary forgot to mention are all worse than an ugly sentence.

import { describe, expect, test } from "vitest";
import {
  formatUnits,
  parsePolicy,
  policySummary,
  tokenAmount,
  type ValidatedPolicy,
} from "../src/index.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const SAVINGS = "0x1111111111111111111111111111111111111111";

const DECIMALS = { [USDC]: 6, [WETH]: 18, native: 18 };
const LABELS = { [ROUTER]: "Uniswap v3", [PERMIT2]: "Permit2", [USDC]: "USDC" };

/** The worked example from spec §4.3: weekly DCA, 500 USDC over 30 days. */
function validWire(): Record<string, unknown> {
  return {
    version: 1,
    chain_id: 84532,
    asset_scope: [{ symbol: "USDC", address: USDC }],
    budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "500000000" }],
    max_native_value: "0",
    target_scope: [
      {
        address: USDC,
        selector: "0x095ea7b3",
        action: "APPROVE",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
          { rule: "LTE", param_index: 1, max: "125000000" },
        ],
      },
      {
        address: ROUTER,
        selector: "0x04e45aaf",
        action: "SWAP",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
          { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
          { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 500 }, { kind: "uint", value: 3000 }] },
          { rule: "EQ_ACCOUNT", param_index: 3 },
          { rule: "LTE", param_index: 4, max: "125000000" },
        ],
      },
    ],
    action_scope: ["APPROVE", "SWAP"],
    valid_after: 1_754_000_000, // 2025-08-01T00:53:20Z
    valid_until: 1_756_600_000, // 2025-08-31T00:26:40Z
    max_executions: 8,
    max_executions_per_24h: 2,
    min_output_bps: 9800,
  };
}

function worked(): ValidatedPolicy {
  return parsePolicy(validWire());
}

// ── formatUnits: display without float math ─────────────────────────────────

describe("formatUnits — decimal display derived by integer math only", () => {
  test("6-decimal token", () => {
    expect(formatUnits(tokenAmount(500_000_000n), 6)).toBe("500");
    expect(formatUnits(tokenAmount(1n), 6)).toBe("0.000001");
    expect(formatUnits(tokenAmount(1_500_000n), 6)).toBe("1.5");
  });

  test("18-decimal token keeps every digit — no precision loss at 1e21", () => {
    // 1234.000000000000000001 ETH: a float would silently drop the last digit.
    expect(formatUnits(tokenAmount(1_234_000_000_000_000_000_001n), 18)).toBe("1234.000000000000000001");
  });

  test("trailing zeros trimmed, never the integer part", () => {
    expect(formatUnits(tokenAmount(1_230_000n), 6)).toBe("1.23");
    expect(formatUnits(tokenAmount(1_000_000n), 6)).toBe("1");
    expect(formatUnits(tokenAmount(0n), 18)).toBe("0");
  });

  test("zero decimals is the identity", () => {
    expect(formatUnits(tokenAmount(42n), 0)).toBe("42");
  });

  test("rejects a nonsense decimals value rather than guessing", () => {
    expect(() => formatUnits(tokenAmount(1n), -1)).toThrow(RangeError);
    expect(() => formatUnits(tokenAmount(1n), 1.5)).toThrow(RangeError);
    expect(() => formatUnits(tokenAmount(1n), 78)).toThrow(RangeError);
  });
});

// ── The worst-case block ────────────────────────────────────────────────────

describe("policySummary — the worst case, in plain language (FR-11.1)", () => {
  test("names every budgeted asset with its total cap", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.spendCaps).toHaveLength(1);
    expect(s.spendCaps[0]).toMatchObject({
      symbol: "USDC",
      address: USDC,
      maxTotal: "500000000",
      display: "500 USDC",
    });
    expect(s.worstCase).toContain("500 USDC");
  });

  test("without decimals it says base units rather than inventing a scale", () => {
    const s = policySummary(worked());
    expect(s.spendCaps[0]?.display).toBe("500000000 USDC (smallest units)");
    expect(s.spendCaps[0]?.decimalsKnown).toBe(false);
  });

  test("reports the per-execution ceiling separately from the lifetime cap", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.spendCaps[0]?.perExecutionDisplay).toBe("125 USDC");
  });

  test("expiry is rendered as an unambiguous UTC date", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.window.endsAt).toBe("31 August 2025");
    expect(s.window.endsAtIso).toBe("2025-08-31T00:26:40.000Z");
    expect(s.window.days).toBe(30);
    expect(s.worstCase).toContain("31 August 2025");
  });

  test("usage limits are stated in both forms the policy enforces", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.usage.maxExecutions).toBe(8);
    expect(s.usage.maxPer24h).toBe(2);
    expect(s.usage.minOutputPct).toBe("98");
  });

  test("every line is a short sentence — the screen is read, not parsed", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.lines.length).toBeGreaterThan(3);
    for (const line of s.lines) {
      expect(line.endsWith(".")).toBe(true);
      // 9th-grade reading level in practice means short sentences.
      expect(line.split(" ").length).toBeLessThanOrEqual(28);
    }
  });

  test("the same policy always summarises identically", () => {
    const a = policySummary(worked(), { decimals: DECIMALS, labels: LABELS });
    const b = policySummary(worked(), { decimals: DECIMALS, labels: LABELS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── Destinations: the anti-exfiltration claim ───────────────────────────────

describe("policySummary — where funds can go", () => {
  test("account-only when every value-moving target pins the recipient", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.destinations.kind).toBe("account-only");
    expect(s.worstCase).toContain("your own account");
  });

  test("an unpinned transfer with an address allowlist lists those addresses", () => {
    const w = validWire();
    (w["target_scope"] as unknown[]).push({
      address: USDC,
      selector: "0xa9059cbb", // transfer(address,uint256)
      action: "TRANSFER",
      param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: SAVINGS }] },
        { rule: "LTE", param_index: 1, max: "125000000" },
      ],
    });
    (w["action_scope"] as string[]).push("TRANSFER");
    const s = policySummary(parsePolicy(w), { decimals: DECIMALS });
    expect(s.destinations).toEqual({ kind: "allowlist", addresses: [SAVINGS] });
    expect(s.worstCase).toContain(SAVINGS);
  });

  test("an unpinned transfer with NO allowlist is reported as unrestricted, loudly", () => {
    // parsePolicy only requires the recipient pin on SWAP targets, so this
    // policy is valid — and dangerous. The summary must not round it down to
    // "your own account"; understating is the failure mode that matters.
    const w = validWire();
    (w["target_scope"] as unknown[]).push({
      address: USDC,
      selector: "0xa9059cbb",
      action: "TRANSFER",
      param_rules: [{ rule: "LTE", param_index: 1, max: "125000000" }],
    });
    (w["action_scope"] as string[]).push("TRANSFER");
    const s = policySummary(parsePolicy(w), { decimals: DECIMALS });
    expect(s.destinations.kind).toBe("unrestricted");
    expect(s.worstCase).toContain("any address");
    expect(s.warnings.some((x) => x.includes("any address"))).toBe(true);
  });

  test("an approval spender is a destination for allowance, and is named", () => {
    const s = policySummary(worked(), { decimals: DECIMALS, labels: LABELS });
    const approve = s.venues.find((v) => v.action === "APPROVE");
    expect(approve?.allowedAddresses).toEqual([PERMIT2]);
  });
});

// ── Venues ──────────────────────────────────────────────────────────────────

describe("policySummary — permitted venues", () => {
  test("labels are used when supplied and the address is always kept", () => {
    const s = policySummary(worked(), { decimals: DECIMALS, labels: LABELS });
    const swap = s.venues.find((v) => v.action === "SWAP");
    expect(swap?.label).toBe("Uniswap v3");
    expect(swap?.address).toBe(ROUTER);
    expect(swap?.recipientPinned).toBe(true);
  });

  test("an unlabelled venue falls back to its address, never to a guess", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    const swap = s.venues.find((v) => v.action === "SWAP");
    expect(swap?.label).toBe(ROUTER);
  });

  test("a label cannot be used to rename an address out of the summary", () => {
    // Attacker-supplied labels are display only; identity stays the address.
    const s = policySummary(worked(), { decimals: DECIMALS, labels: { [ROUTER]: "Your Own Account" } });
    const swap = s.venues.find((v) => v.action === "SWAP");
    expect(swap?.address).toBe(ROUTER);
    expect(s.destinations.kind).toBe("account-only");
  });
});

// ── The summary cannot invent or omit ───────────────────────────────────────

describe("policySummary — derived only from the validated policy", () => {
  test("every stated cap traces back to a budget in the policy", () => {
    const p = worked();
    const s = policySummary(p, { decimals: DECIMALS });
    for (const cap of s.spendCaps) {
      const budget = p.budgets.find((b) => b.asset.address === cap.address);
      expect(budget).toBeDefined();
      expect(cap.maxTotal).toBe(budget?.max_total.toString(10));
    }
    expect(s.spendCaps).toHaveLength(p.budgets.length);
  });

  test("a native-value allowance is stated when the policy grants one", () => {
    const w = validWire();
    w["max_native_value"] = "1000000000000000000";
    (w["asset_scope"] as unknown[]).push({ symbol: "ETH", address: null });
    (w["budgets"] as unknown[]).push({ asset: { symbol: "ETH", address: null }, max_total: "1000000000000000000" });
    const s = policySummary(parsePolicy(w), { decimals: DECIMALS });
    expect(s.usage.maxNativeDisplay).toBe("1 ETH");
    expect(s.spendCaps.some((c) => c.symbol === "ETH")).toBe(true);
  });

  test("a zero native allowance is stated as a guarantee, not omitted", () => {
    const s = policySummary(worked(), { decimals: DECIMALS });
    expect(s.usage.maxNativeDisplay).toBe("0 ETH");
    expect(s.guarantees.some((g) => g.toLowerCase().includes("no eth"))).toBe(true);
  });
});
