import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for every collaborator ───────────────────────────────────────
const mockPreflight = vi.fn();
const mockTryAllocate = vi.fn();
const mockRelease = vi.fn();
const mockBuild = vi.fn(() => ({ kind: "tx" }));
const mockExecute = vi.fn();
const mockActionSucceeded = vi.fn();
const mockActionFailed = vi.fn();
const mockEvaluatePolicy = vi.fn();
const mockArchive = vi.fn();

vi.mock("../policyChecker.js", () => ({
  getPolicyChecker: () => ({ preflight: mockPreflight }),
}));
vi.mock("../budgetTracker.js", () => ({
  getBudgetTracker: () => ({ tryAllocate: mockTryAllocate, release: mockRelease }),
}));
vi.mock("../ptbBuilder.js", () => ({
  getAgentPtbBuilder: () => ({ build: mockBuild }),
}));
vi.mock("../executor.js", () => ({
  getAgentExecutor: () => ({ execute: mockExecute }),
}));
vi.mock("../alerts.js", () => ({
  getAgentAlerts: () => ({
    actionSucceeded: mockActionSucceeded,
    actionFailed: mockActionFailed,
    evaluatePolicy: mockEvaluatePolicy,
  }),
}));
vi.mock("../walrusArchiver.js", () => ({
  getWalrusArchiver: () => ({ archive: mockArchive }),
}));
vi.mock("../deepbookClient.js", () => ({
  AgentDeepBookClient: class {
    placeMarketOrderFragment = vi.fn(() => () => {});
    placeLimitOrderFragment = vi.fn(() => () => {});
  },
}));
vi.mock("../config.js", () => ({
  deepbookProtocolId: () => "0xdeep",
  assetTypeFor: (s: string) => `type::${s}`,
  getSuiClient: () => ({}),
  getNetwork: () => "testnet",
}));

import { getSwapAgent } from "../swapAgent.js";

const wallet = {
  agentAddress: "0xagent",
  ownerAddress: "0xowner",
  policyId: "0xpolicy",
  capabilityId: "0xcap",
  encryptedSecretKey: {} as any,
  createdAt: "now",
};

const deepbook = { agentAddress: "0xagent", balanceManagerId: "0xbm", poolKey: "SUI_USDC" };

function req(overrides: Partial<any> = {}) {
  return {
    wallet,
    deepbook,
    tokenIn: "SUI",
    tokenOut: "USDC",
    amount: 100n,
    market: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPreflight.mockResolvedValue({ ok: true, policy: {} });
  mockTryAllocate.mockResolvedValue(true);
  mockExecute.mockResolvedValue({ success: true, digest: "0xdig", created: ["0xorder"], events: [] });
  mockArchive.mockResolvedValue({ ok: true });
});

describe("SwapAgent.execute", () => {
  it("rejects before allocating if pre-flight fails", async () => {
    mockPreflight.mockResolvedValue({ ok: false, reason: "Budget exceeded" });
    const out = await getSwapAgent().execute(req());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("Budget exceeded");
    expect(mockTryAllocate).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects when budget allocation fails", async () => {
    mockTryAllocate.mockResolvedValue(false);
    const out = await getSwapAgent().execute(req());
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/budget/i);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects a limit order with no price and releases the allocation", async () => {
    const out = await getSwapAgent().execute(req({ market: false, price: undefined }));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/price/i);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("on success: releases market allocation, alerts, and archives", async () => {
    const out = await getSwapAgent().execute(req());
    expect(out.ok).toBe(true);
    expect(out.digest).toBe("0xdig");
    expect(out.orderId).toBe("0xorder");
    // Market swaps settle immediately -> allocation released.
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockActionSucceeded).toHaveBeenCalledTimes(1);
    expect(mockArchive).toHaveBeenCalledWith(
      expect.objectContaining({ status: "executed", digest: "0xdig" }),
    );
    expect(mockEvaluatePolicy).toHaveBeenCalled();
  });

  it("keeps the allocation for an open limit order (released later by order manager)", async () => {
    mockExecute.mockResolvedValue({ success: true, digest: "0xdig", created: ["0xorder"], events: [] });
    const out = await getSwapAgent().execute(req({ market: false, price: 0.25 }));
    expect(out.ok).toBe(true);
    // Limit order stays allocated -> release NOT called on the success path.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("on-chain failure releases allocation, alerts, archives as failed", async () => {
    mockExecute.mockResolvedValue({ success: false, error: "capability not found" });
    const out = await getSwapAgent().execute(req());
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/capability not found/);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockActionFailed).toHaveBeenCalledTimes(1);
    expect(mockArchive).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("rejects when the wallet is not bound to a policy", async () => {
    const out = await getSwapAgent().execute(req({ wallet: { ...wallet, policyId: null } }));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not bound/i);
  });
});
