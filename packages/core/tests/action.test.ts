// T-004 acceptance — parity port of crates/corral-core/tests/action.rs:
// the Action DSL is closed and Plan is strict — an extra JSON field anywhere
// fails parsing (FR-4.2), and there is no raw-calldata/delegatecall variant.

import { describe, expect, test } from "vitest";
import { ActionSchema, actionKind, parsePlan, planToWire } from "../src/index.js";

const USDC = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const WETH = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" };
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

function sampleWire(): Record<string, unknown> {
  return {
    chain_id: 84532,
    session_id: "0x1111111111111111111111111111111111111111111111111111111111111111",
    strategy_id: "0x2222222222222222222222222222222222222222222222222222222222222222",
    seq: 3,
    actions: [
      { action: "APPROVE", asset: USDC, spender: PERMIT2, amount: "125000000" },
      {
        action: "SWAP",
        asset_in: USDC,
        asset_out: WETH,
        amount_in: "125000000",
        min_amount_out: "30000000000000000",
      },
    ],
  };
}

test("plan round-trips (parity: plan_round_trips)", () => {
  const p = parsePlan(sampleWire());
  expect(parsePlan(planToWire(p))).toStrictEqual(p);
});

test("plan rejects unknown fields (parity: plan_rejects_unknown_fields)", () => {
  const w = sampleWire();
  w["execute_immediately"] = true;
  expect(() => parsePlan(w)).toThrow();
});

test("action rejects unknown fields (parity: action_rejects_unknown_fields)", () => {
  const w = sampleWire();
  ((w["actions"] as Record<string, unknown>[])[1]!)["callback_address"] = "0x00";
  expect(() => parsePlan(w)).toThrow();
});

test("action rejects unknown kind (parity: action_rejects_unknown_kind)", () => {
  // The DSL is closed: no DELEGATECALL, no CUSTOM, no raw calldata.
  const bad = {
    action: "DELEGATECALL",
    target: "0x2626664c2603336e57b271c5c0b26f421741e481",
    data: "0xdeadbeef",
  };
  expect(ActionSchema.safeParse(bad).success).toBe(false);
});

test("there is no raw-calldata variant (parity: there_is_no_raw_calldata_variant)", () => {
  const p = parsePlan(sampleWire());
  expect(p.actions.map((a) => a.action)).toStrictEqual(["APPROVE", "SWAP"]);
});

describe("action → kind mapping is total (parity: action_kind_mapping_is_total)", () => {
  test("every variant maps to its ActionKind", () => {
    const amount = "1";
    const wrap = ActionSchema.parse({ action: "WRAP", amount });
    const unwrap = ActionSchema.parse({ action: "UNWRAP", amount });
    const transfer = ActionSchema.parse({
      action: "TRANSFER",
      asset: USDC,
      to: "0x1111111111111111111111111111111111111111",
      amount,
    });
    expect(actionKind(wrap)).toBe("WRAP");
    expect(actionKind(unwrap)).toBe("UNWRAP");
    expect(actionKind(transfer)).toBe("TRANSFER");
    const p = parsePlan(sampleWire());
    expect(actionKind(p.actions[0]!)).toBe("APPROVE");
    expect(actionKind(p.actions[1]!)).toBe("SWAP");
  });
});

test("null strategy_id is accepted, absent is not (wire parity with Rust Option)", () => {
  const w = sampleWire();
  w["strategy_id"] = null;
  expect(() => parsePlan(w)).not.toThrow();
  delete w["strategy_id"];
  expect(() => parsePlan(w)).toThrow();
});
