// T-003 acceptance — parity port of crates/corral-core/tests/policy.rs:
// each of the six parse-time invariants (PRD §8) has a failing case, and a
// validated policy is only obtainable through parsePolicy().

import { describe, expect, test } from "vitest";
import {
  PolicyError,
  parsePolicy,
  policyToWire,
  tokenAmount,
  U256_MAX,
} from "../src/index.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

/** The worked example from spec §4.3 in wire form: weekly DCA, 500 USDC / 30 days. */
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
        selector: "0x095ea7b3", // approve(address,uint256)
        action: "APPROVE",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
          { rule: "LTE", param_index: 1, max: "125000000" },
        ],
      },
      {
        address: ROUTER,
        selector: "0x04e45aaf", // exactInputSingle
        action: "SWAP",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
          { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
          { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 500 }, { kind: "uint", value: 3000 }] },
          { rule: "EQ_ACCOUNT", param_index: 3 }, // recipient
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
  };
}

function expectPolicyError(input: unknown, code: PolicyError["code"], detail?: string) {
  try {
    parsePolicy(input);
    expect.fail(`expected PolicyError ${code}, but parsing succeeded`);
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyError);
    const pe = e as PolicyError;
    expect(pe.code).toBe(code);
    if (detail !== undefined) expect(pe.detail).toBe(detail);
  }
}

test("the worked example validates (parity: the_worked_example_validates)", () => {
  const vp = parsePolicy(validWire());
  expect(vp.max_executions).toBe(8);
  expect(vp.budgets[0]?.max_total).toBe(tokenAmount(500_000_000n));
});

describe("invariant 4 — FR-2.6 time window (parity: rejects_bad_time_window)", () => {
  test("valid_until == valid_after rejected", () => {
    const w = validWire();
    w["valid_until"] = w["valid_after"];
    expectPolicyError(w, "BAD_TIME_WINDOW");
  });
  test("valid_until < valid_after rejected", () => {
    const w = validWire();
    w["valid_until"] = (w["valid_after"] as number) - 1;
    expectPolicyError(w, "BAD_TIME_WINDOW");
  });
});

describe("invariant 5 — FR-2.7 usage caps (parity: rejects_inconsistent_usage_caps)", () => {
  test("24h cap above total cap rejected", () => {
    const w = validWire();
    w["max_executions_per_24h"] = (w["max_executions"] as number) + 1;
    expectPolicyError(w, "USAGE_CAPS_INCONSISTENT");
  });
});

describe("invariant 6 — FR-9.3 slippage range (parity: rejects_slippage_out_of_range)", () => {
  test("outside 5000..=10000 rejected, inside accepted", () => {
    for (const bad of [0, 4999, 10001, 65535]) {
      const w = validWire();
      w["min_output_bps"] = bad;
      expectPolicyError(w, "SLIPPAGE_OUT_OF_RANGE", String(bad));
    }
    for (const ok of [5000, 9800, 10000]) {
      const w = validWire();
      w["min_output_bps"] = ok;
      expect(() => parsePolicy(w)).not.toThrow();
    }
  });
});

describe("invariant 1 — FR-2.1/2.2 asset scope ⊆ budgets (parity: rejects_asset_without_budget)", () => {
  test("in-scope asset without a budget rejected", () => {
    const w = validWire();
    (w["asset_scope"] as unknown[]).push({ symbol: "WETH", address: WETH });
    expectPolicyError(w, "ASSET_WITHOUT_BUDGET", "WETH");
  });

  test("budget matching is by address, never by symbol (parity: budget_matching_is_by_address_not_symbol)", () => {
    const w = validWire();
    w["asset_scope"] = [{ symbol: "USDC", address: WETH }]; // spoofed symbol
    expectPolicyError(w, "ASSET_WITHOUT_BUDGET", "USDC");
  });
});

describe("invariant 2 — FR-2.5 recipient pin (parity: rejects_swap_target_without_recipient_pin)", () => {
  test("swap target without EQ_ACCOUNT rejected", () => {
    const w = validWire();
    const swap = (w["target_scope"] as Record<string, unknown>[])[1]!;
    swap["param_rules"] = (swap["param_rules"] as Record<string, unknown>[]).filter(
      (r) => r["rule"] !== "EQ_ACCOUNT",
    );
    expectPolicyError(w, "MISSING_RECIPIENT_PIN", ROUTER);
  });
});

describe("invariant 3 — FR-2.12 no unbounded approvals", () => {
  test("approve target without an amount cap rejected (parity: rejects_approval_without_amount_cap)", () => {
    const w = validWire();
    const approve = (w["target_scope"] as Record<string, unknown>[])[0]!;
    approve["param_rules"] = (approve["param_rules"] as Record<string, unknown>[]).filter(
      (r) => r["rule"] !== "LTE",
    );
    expectPolicyError(w, "UNBOUNDED_APPROVAL", PERMIT2);
  });

  test("a cap of U256_MAX is not a cap (parity: rejects_approval_capped_at_u256_max)", () => {
    const w = validWire();
    const approve = (w["target_scope"] as Record<string, unknown>[])[0]!;
    for (const r of approve["param_rules"] as Record<string, unknown>[]) {
      if (r["rule"] === "LTE") r["max"] = U256_MAX.toString();
    }
    expectPolicyError(w, "UNBOUNDED_APPROVAL", PERMIT2);
  });
});

describe("boundary discipline", () => {
  test("unknown fields fail parsing (parity: raw_policy_rejects_unknown_fields)", () => {
    const w = validWire();
    w["helpful_extra"] = true;
    expect(() => parsePolicy(w)).toThrow();
  });

  test("unknown fields fail anywhere, not just at the top level", () => {
    const w = validWire();
    ((w["target_scope"] as Record<string, unknown>[])[0]!)["note"] = "hi";
    expect(() => parsePolicy(w)).toThrow();
  });

  test("validated policy is frozen and round-trips through wire form (parity: validated_policy_serializes_and_exposes_raw)", () => {
    const vp = parsePolicy(validWire());
    expect(Object.isFrozen(vp)).toBe(true);
    expect(Object.isFrozen(vp.budgets[0])).toBe(true);
    // policyToWire is the serialization path (bigints become decimal strings);
    // parsing the wire form again yields an equal policy.
    const again = parsePolicy(policyToWire(vp));
    expect(again).toStrictEqual(vp);
  });

  test("addresses are normalized, so checksum-case cannot split identity", () => {
    const w = validWire();
    (w["asset_scope"] as Record<string, unknown>[])[0]!["address"] =
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // checksummed USDC
    expect(() => parsePolicy(w)).not.toThrow(); // still matches its budget entry
  });
});
