import { describe, it, expect, vi, beforeEach } from "vitest";

// Control what the policy checker reports as on-chain spend.
const mockReadPolicy = vi.fn();
vi.mock("../policyChecker.js", () => ({
  getPolicyChecker: () => ({ readPolicy: mockReadPolicy }),
}));

import { BudgetTracker } from "../budgetTracker.js";

const POLICY = "0xpolicy";

function onChain(cap: bigint, spent: bigint) {
  mockReadPolicy.mockResolvedValue({ budgetCap: cap, budgetSpent: spent });
}

beforeEach(() => {
  mockReadPolicy.mockReset();
});

describe("BudgetTracker", () => {
  it("available = cap - on-chain spent - local allocations", async () => {
    onChain(500n, 100n);
    const t = new BudgetTracker();
    expect(await t.available(POLICY)).toBe(400n);

    await t.tryAllocate(POLICY, "a1", 150n);
    expect(t.allocated(POLICY)).toBe(150n);
    expect(await t.available(POLICY)).toBe(250n);
  });

  it("tryAllocate refuses an allocation that exceeds available", async () => {
    onChain(500n, 400n); // 100 free
    const t = new BudgetTracker();
    expect(await t.tryAllocate(POLICY, "a1", 150n)).toBe(false);
    expect(t.allocated(POLICY)).toBe(0n);
  });

  it("models the double-spend race: second pending alloc is refused", async () => {
    // cap 500, on-chain spent 400 -> 100 free. First 80 allocates, leaving 20.
    // A second 80 must be refused (mirrors the on-chain record_spend abort).
    onChain(500n, 400n);
    const t = new BudgetTracker();
    expect(await t.tryAllocate(POLICY, "tx1", 80n)).toBe(true);
    expect(await t.tryAllocate(POLICY, "tx2", 80n)).toBe(false);
    expect(t.allocated(POLICY)).toBe(80n);
  });

  it("release frees the allocation so funds become available again", async () => {
    onChain(500n, 0n);
    const t = new BudgetTracker();
    await t.tryAllocate(POLICY, "a1", 300n);
    expect(await t.available(POLICY)).toBe(200n);
    t.release(POLICY, "a1");
    expect(await t.available(POLICY)).toBe(500n);
  });

  it("clamps available to zero when on-chain spend already exceeds cap", async () => {
    onChain(500n, 600n);
    const t = new BudgetTracker();
    expect(await t.available(POLICY)).toBe(0n);
  });

  it("clear() drops all allocations for a policy", async () => {
    onChain(500n, 0n);
    const t = new BudgetTracker();
    await t.tryAllocate(POLICY, "a1", 100n);
    await t.tryAllocate(POLICY, "a2", 100n);
    t.clear(POLICY);
    expect(t.allocated(POLICY)).toBe(0n);
  });
});
