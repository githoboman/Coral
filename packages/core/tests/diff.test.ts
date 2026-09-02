// FR-11.2 — the policy diff shown when a session replaces an older one.
//
// The user's question is never "what changed" in the abstract. It is "am I
// giving this thing MORE power than before?" So the only classification that
// matters is widened / narrowed, and the rule when it is ambiguous is to call
// it widened. Under-reporting a widening is the failure mode; over-reporting a
// narrowing merely prompts a second look.

import { describe, expect, test } from "vitest";
import { parsePolicy, policyDiff } from "../src/index.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const OTHER = "0xbad00bad00bad00bad00bad00bad00bad00bad00";

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
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
          { rule: "EQ_ACCOUNT", param_index: 3 },
          { rule: "LTE", param_index: 4, max: "125000000" },
        ],
      },
    ],
    action_scope: ["APPROVE", "SWAP"],
    valid_after: 1_754_000_000,
    valid_until: 1_756_600_000,
    max_executions: 8,
    max_executions_per_24h: 2,
    min_output_bps: 9800,
    ...over,
  };
}

const base = () => parsePolicy(wire());

describe("policy diff", () => {
  test("an identical policy has no changes", () => {
    const d = policyDiff(base(), base());
    expect(d.widened).toEqual([]);
    expect(d.narrowed).toEqual([]);
    expect(d.hasChanges).toBe(false);
  });

  test("a larger budget is a widening", () => {
    const d = policyDiff(base(), parsePolicy(wire({ budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "900000000" }] })));
    expect(d.widened.some((c) => c.field === "budget" && c.detail.includes("USDC"))).toBe(true);
    expect(d.narrowed).toEqual([]);
  });

  test("a smaller budget is a narrowing", () => {
    const d = policyDiff(base(), parsePolicy(wire({ budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "100000000" }] })));
    expect(d.narrowed.some((c) => c.field === "budget")).toBe(true);
    expect(d.widened).toEqual([]);
  });

  test("a new budgeted asset is a widening", () => {
    const d = policyDiff(
      base(),
      parsePolicy(
        wire({
          asset_scope: [
            { symbol: "USDC", address: USDC },
            { symbol: "WETH", address: WETH },
          ],
          budgets: [
            { asset: { symbol: "USDC", address: USDC }, max_total: "500000000" },
            { asset: { symbol: "WETH", address: WETH }, max_total: "1000000000000000000" },
          ],
        }),
      ),
    );
    expect(d.widened.some((c) => c.field === "asset")).toBe(true);
  });

  test("a removed asset is a narrowing", () => {
    const two = parsePolicy(
      wire({
        asset_scope: [
          { symbol: "USDC", address: USDC },
          { symbol: "WETH", address: WETH },
        ],
        budgets: [
          { asset: { symbol: "USDC", address: USDC }, max_total: "500000000" },
          { asset: { symbol: "WETH", address: WETH }, max_total: "1000000000000000000" },
        ],
      }),
    );
    const d = policyDiff(two, base());
    expect(d.narrowed.some((c) => c.field === "asset")).toBe(true);
  });

  test("a new permitted contract is a widening, and names the address", () => {
    const extra = wire();
    (extra["target_scope"] as unknown[]).push({
      address: OTHER,
      selector: "0xa9059cbb",
      action: "TRANSFER",
      param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: OTHER }] },
        { rule: "LTE", param_index: 1, max: "1" },
      ],
    });
    (extra["action_scope"] as string[]).push("TRANSFER");
    const d = policyDiff(base(), parsePolicy(extra));
    const change = d.widened.find((c) => c.field === "venue");
    expect(change?.detail).toContain(OTHER);
  });

  test("a longer window is a widening; a shorter one is a narrowing", () => {
    expect(policyDiff(base(), parsePolicy(wire({ valid_until: 1_800_000_000 }))).widened.some((c) => c.field === "expiry")).toBe(true);
    expect(policyDiff(base(), parsePolicy(wire({ valid_until: 1_755_000_000 }))).narrowed.some((c) => c.field === "expiry")).toBe(true);
  });

  test("more runs allowed is a widening", () => {
    const d = policyDiff(base(), parsePolicy(wire({ max_executions: 50 })));
    expect(d.widened.some((c) => c.field === "usage")).toBe(true);
  });

  test("a looser slippage floor is a widening", () => {
    // 9800 → 9000 means the agent may accept a worse price. Less protection.
    const d = policyDiff(base(), parsePolicy(wire({ min_output_bps: 9000 })));
    expect(d.widened.some((c) => c.field === "slippage")).toBe(true);
  });

  test("a native allowance where there was none is a widening", () => {
    const d = policyDiff(base(), parsePolicy(wire({ max_native_value: "1000000000000000000" })));
    expect(d.widened.some((c) => c.field === "native")).toBe(true);
  });

  test("losing a recipient pin is reported as a widening, loudly", () => {
    // The single most dangerous change a new policy can make.
    const loose = wire();
    (loose["target_scope"] as { action: string; param_rules: unknown[] }[])[1]!.param_rules = [
      { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
      { rule: "LTE", param_index: 4, max: "125000000" },
    ];
    (loose["target_scope"] as { action: string }[])[1]!.action = "TRANSFER";
    (loose["action_scope"] as string[]).push("TRANSFER");
    const d = policyDiff(base(), parsePolicy(loose));
    expect(d.widened.some((c) => c.severity === "high")).toBe(true);
  });

  test("changes carry human-readable text, not field names", () => {
    const d = policyDiff(base(), parsePolicy(wire({ max_executions: 50 })));
    for (const c of [...d.widened, ...d.narrowed]) {
      expect(c.detail.length).toBeGreaterThan(10);
      expect(c.detail).not.toMatch(/^[a-z_]+$/);
    }
  });

  test("a change that is both wider and narrower reports both, hiding neither", () => {
    const d = policyDiff(base(), parsePolicy(wire({ max_executions: 50, min_output_bps: 9900 })));
    expect(d.widened.length).toBeGreaterThan(0);
    expect(d.narrowed.length).toBeGreaterThan(0);
    expect(d.hasChanges).toBe(true);
  });
});
