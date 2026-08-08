import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture moveCall targets in order to assert the guard wraps the action correctly.
const calls: string[] = [];

vi.mock("@mysten/sui/transactions", () => {
  class MockTransaction {
    moveCall = vi.fn((c: { target: string }) => {
      calls.push(c.target);
    });
    object = vi.fn((id: string) => ({ id }));
    pure = {
      u8: vi.fn((v: number) => v),
      u64: vi.fn((v: bigint) => v),
      string: vi.fn((v: string) => v),
      address: vi.fn((v: string) => v),
      vector: vi.fn(),
    };
  }
  return { Transaction: MockTransaction };
});

vi.mock("../config.js", () => ({
  getAgentPolicyConfig: () => ({ packageId: "0xpkg", deepbookPackageId: "0xdeep" }),
  CLOCK_OBJECT_ID: "0x6",
}));

import { getAgentPtbBuilder } from "../ptbBuilder.js";
import { AgentActionType } from "../types.js";

const ctxBase = {
  policyId: "0xpolicy",
  capabilityId: "0xcap",
  protocol: "0xdeep",
  tokenIn: "0x2::sui::SUI",
  tokenOut: "0xusdc::usdc::USDC",
};

beforeEach(() => {
  calls.length = 0;
});

describe("AgentPtbBuilder", () => {
  it("wraps a swap as validate -> body -> record_spend -> log_action, in order", () => {
    let bodyRan = false;
    getAgentPtbBuilder().build(
      { ...ctxBase, actionType: AgentActionType.Swap, amount: 100n },
      () => {
        bodyRan = true;
        calls.push("BODY"); // marker between record/validate
      },
    );

    expect(bodyRan).toBe(true);
    expect(calls).toEqual([
      "0xpkg::policy::validate_action",
      "BODY",
      "0xpkg::policy::record_spend",
      "0xpkg::policy::log_action",
    ]);
  });

  it("skips record_spend when recordAmount is zero", () => {
    getAgentPtbBuilder().build(
      { ...ctxBase, actionType: AgentActionType.Swap, amount: 100n },
      () => calls.push("BODY"),
      0n, // recordAmount
    );
    expect(calls).toEqual([
      "0xpkg::policy::validate_action",
      "BODY",
      "0xpkg::policy::log_action",
    ]);
    expect(calls).not.toContain("0xpkg::policy::record_spend");
  });

  it("uses validate_action_after when a time gate is set", () => {
    getAgentPtbBuilder().build(
      { ...ctxBase, actionType: AgentActionType.Swap, amount: 100n, executeAfter: 5000n },
      () => calls.push("BODY"),
    );
    expect(calls).toEqual([
      "0xpkg::policy::validate_action_after",
      "BODY",
      "0xpkg::policy::record_spend",
      "0xpkg::policy::log_action",
    ]);
    expect(calls).not.toContain("0xpkg::policy::validate_action");
  });

  it("buildCancel validates and logs but records no spend", () => {
    getAgentPtbBuilder().buildCancel({ ...ctxBase }, () => calls.push("CANCEL_BODY"));
    expect(calls).toEqual([
      "0xpkg::policy::validate_action",
      "CANCEL_BODY",
      "0xpkg::policy::log_action",
    ]);
  });
});
