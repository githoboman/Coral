import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Sui client so readPolicy returns a controllable on-chain object.
const mockGetObject = vi.fn();
vi.mock("../config.js", async () => {
  return {
    getSuiClient: () => ({ getObject: mockGetObject }),
    getNetwork: () => "testnet",
  };
});

import { getPolicyChecker } from "../policyChecker.js";
import { AgentActionType } from "../types.js";

const PROTOCOL = "0xdeep::book";
const SUI = "0x2::sui::SUI";
const USDC = "0xusdc::usdc::USDC";

// Build a getObject response mimicking a shared AgentPolicy. Fields default to a
// healthy policy; overrides tweak individual constraints.
function policyObject(overrides: Partial<Record<string, any>> = {}) {
  const fields = {
    owner: "0xowner",
    agent_address: "0xagent",
    budget_cap: "500",
    budget_spent: "0",
    allowed_protocols: [PROTOCOL],
    allowed_assets: [SUI, USDC],
    allowed_actions: [0, 1, 2],
    expiry_timestamp: "1000000000000", // far future
    is_active: true,
    gas_reserve: "100",
    created_at: "0",
    ...overrides,
  };
  return { data: { content: { dataType: "moveObject", fields } } };
}

const NOW = 1_000_000; // ms; well before the default expiry

beforeEach(() => {
  mockGetObject.mockReset();
});

describe("PolicyChecker.preflight", () => {
  it("passes a valid in-scope swap within budget", async () => {
    mockGetObject.mockResolvedValue(policyObject());
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects when policy object is missing", async () => {
    mockGetObject.mockResolvedValue({ data: { content: null } });
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 1n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not found/i);
  });

  it("rejects a paused (inactive) policy", async () => {
    mockGetObject.mockResolvedValue(policyObject({ is_active: false }));
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/paused|revoked/i);
  });

  it("rejects an expired policy", async () => {
    mockGetObject.mockResolvedValue(policyObject({ expiry_timestamp: String(NOW - 1) }));
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/i);
  });

  it("rejects a non-whitelisted protocol", async () => {
    mockGetObject.mockResolvedValue(policyObject());
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: "0xbad::amm", asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/protocol/i);
  });

  it("rejects a non-whitelisted asset for value-moving actions", async () => {
    mockGetObject.mockResolvedValue(policyObject());
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.LimitOrder, amount: 100n, protocol: PROTOCOL, asset: "0xscam::t::SCAM" },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/asset/i);
  });

  it("does NOT enforce asset scope on a cancel", async () => {
    // Cancel of an unlisted asset still passes — cancels don't move a pair.
    mockGetObject.mockResolvedValue(policyObject());
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Cancel, amount: 0n, protocol: PROTOCOL, asset: "0xscam::t::SCAM" },
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a disallowed action type", async () => {
    mockGetObject.mockResolvedValue(policyObject({ allowed_actions: [2] })); // cancel only
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not permitted/i);
  });

  it("rejects when spend would exceed remaining budget", async () => {
    mockGetObject.mockResolvedValue(policyObject({ budget_cap: "500", budget_spent: "450" }));
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/budget/i);
  });

  it("allows spend exactly at the cap boundary", async () => {
    mockGetObject.mockResolvedValue(policyObject({ budget_cap: "500", budget_spent: "400" }));
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 100n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it("decodes ascii::String fields delivered as { fields: { bytes } }", async () => {
    // Some RPC versions return ascii strings as byte arrays — checker must decode.
    const asBytes = (s: string) => ({ fields: { bytes: Array.from(Buffer.from(s, "ascii")) } });
    mockGetObject.mockResolvedValue(
      policyObject({ allowed_protocols: [asBytes(PROTOCOL)], allowed_assets: [asBytes(SUI)] }),
    );
    const r = await getPolicyChecker().preflight(
      "0xpolicy",
      { actionType: AgentActionType.Swap, amount: 1n, protocol: PROTOCOL, asset: SUI },
      NOW,
    );
    expect(r.ok).toBe(true);
  });
});
