/**
 * T-008 (test-first, CLAUDE.md §7): ValidatedPolicy → SmartSessions Session.
 * The expectation model produced here is what post-install verification
 * compares the chain against, so every mapping rule is pinned by a test.
 */
import { describe, expect, it } from "vitest";
import { parsePolicy } from "@corral/core";
import { decodeAbiParameters, toFunctionSelector } from "viem";
import { BASE_SEPOLIA } from "../../addresses.js";
import { ComposeError, composeSession, UAP_ACTION_CONFIG_ABI } from "../compose.js";
import { actionId } from "../ids.js";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const ACCOUNT = "0xf2A97cd5439C01D5CE8bE75e0f7a8Dc8294C7343" as const;
const AGENT = "0x1111111111111111111111111111111111111111" as const;
const SALT = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function wire(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, chain_id: 84532,
    asset_scope: [{ symbol: "USDC", address: USDC }],
    budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "500000000" }],
    max_native_value: "0",
    target_scope: [
      { address: USDC, selector: "0x095ea7b3", action: "APPROVE", param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
        { rule: "LTE", param_index: 1, max: "125000000" } ] },
      { address: ROUTER, selector: "0x04e45aaf", action: "SWAP", param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
        { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
        { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 3000 }] },
        { rule: "EQ_ACCOUNT", param_index: 3 },
        { rule: "LTE", param_index: 4, max: "125000000" } ] },
    ],
    action_scope: ["APPROVE", "SWAP"],
    valid_after: 1_754_000_000, valid_until: 1_756_600_000,
    max_executions: 8, max_executions_per_24h: 2, min_output_bps: 9800,
    ...overrides,
  };
}
const compose = (w = wire()) => composeSession({ policy: parsePolicy(w), account: ACCOUNT, agentSigner: AGENT, addresses: BASE_SEPOLIA, salt: SALT });
const lc = (s: string) => s.toLowerCase();
const JOURNAL_SEL = toFunctionSelector("log(bytes32,bytes32,bytes32,uint32)");

describe("composeSession — structure", () => {
  it("session validator is the pinned OwnableValidator with the agent as sole owner", () => {
    const { session, expectation } = compose();
    expect(lc(session.sessionValidator)).toBe(lc(BASE_SEPOLIA.ownableValidator.address));
    const [threshold, owners] = decodeAbiParameters([{ type: "uint256" }, { type: "address[]" }], session.sessionValidatorInitData);
    expect(threshold).toBe(1n);
    expect(owners.map(lc)).toStrictEqual([lc(AGENT)]);
    expect(expectation.sessionValidatorInitData).toBe(session.sessionValidatorInitData);
  });

  it("userOp policies with a zero native cap: usage limit + time frame (ValueLimitPolicy V2 rejects limit 0; UAP valueLimitPerUse=0 enforces it)", () => {
    const { expectation } = compose();
    const kinds = expectation.userOpPolicies.map((p) => p.kind).sort();
    expect(kinds).toStrictEqual(["TIME_FRAME", "USAGE_LIMIT"]);
    const tf = expectation.userOpPolicies.find((p) => p.kind === "TIME_FRAME")!;
    expect(tf.packedTimeFrame).toBe((1_756_600_000n << 48n) | 1_754_000_000n);
    expect(expectation.userOpPolicies.find((p) => p.kind === "USAGE_LIMIT")!.limit).toBe(8n);
    // and every action caps native value per use at 0
    for (const a of expectation.actions) {
      const uap = a.policies.find((p) => p.kind === "UNIVERSAL_ACTION")!;
      const [cfg] = decodeAbiParameters(UAP_ACTION_CONFIG_ABI, uap.initData);
      expect(cfg.valueLimitPerUse).toBe(0n);
    }
  });

  it("a non-zero native cap installs ValueLimitPolicy with that cumulative limit", () => {
    const { expectation } = compose(wire({ max_native_value: "1000000000000000" }));
    const vl = expectation.userOpPolicies.find((p) => p.kind === "VALUE_LIMIT")!;
    expect(vl.limit).toBe(1_000_000_000_000_000n);
    expect(lc(vl.address)).toBe(lc(BASE_SEPOLIA.valueLimitPolicy.address));
    expect(expectation.userOpPolicies.map((p) => p.kind).sort()).toStrictEqual(["TIME_FRAME", "USAGE_LIMIT", "VALUE_LIMIT"]);
  });

  it("every target becomes an action, plus the journal action is always appended last", () => {
    const { session, expectation } = compose();
    expect(session.actions).toHaveLength(3);
    const last = session.actions[2]!;
    expect(lc(last.actionTarget)).toBe(lc(BASE_SEPOLIA.corralJournal.address));
    expect(last.actionTargetSelector).toBe(JOURNAL_SEL);
    expect(expectation.actions[2]!.actionId).toBe(actionId(BASE_SEPOLIA.corralJournal.address, JOURNAL_SEL));
  });

  it("permissionId is deterministic and salt-sensitive", () => {
    const a = compose().permissionId, b = compose().permissionId;
    expect(a).toBe(b);
    const c = composeSession({ policy: parsePolicy(wire()), account: ACCOUNT, agentSigner: AGENT, addresses: BASE_SEPOLIA, salt: "0x3333333333333333333333333333333333333333333333333333333333333333" }).permissionId;
    expect(c).not.toBe(a);
  });
});

describe("composeSession — parameter rules → UniversalActionPolicy", () => {
  function rulesOf(idx: number) {
    const { expectation } = compose();
    const uap = expectation.actions[idx]!.policies.find((p) => p.kind === "UNIVERSAL_ACTION")!;
    const [cfg] = decodeAbiParameters(UAP_ACTION_CONFIG_ABI, uap.initData);
    return cfg;
  }
  it("EQ_ACCOUNT → EQUAL against the account address at word offset param_index*32 (the recipient pin, §2.6)", () => {
    const cfg = rulesOf(1);
    const pin = cfg.paramRules.rules[3]!;
    expect(pin.condition).toBe(0); // EQUAL
    expect(pin.offset).toBe(3n * 32n);
    expect(pin.ref).toBe(`0x${"0".repeat(24)}${ACCOUNT.slice(2).toLowerCase()}`);
    expect(cfg.valueLimitPerUse).toBe(0n);
  });
  it("LTE → LESS_THAN_OR_EQUAL; single-value IN_SET → EQUAL; length counts only real rules", () => {
    const cfg = rulesOf(0);
    expect(cfg.paramRules.length).toBe(2n);
    expect(cfg.paramRules.rules[0]!.condition).toBe(0);
    expect(cfg.paramRules.rules[0]!.ref).toBe(`0x${"0".repeat(24)}${PERMIT2.slice(2)}`);
    expect(cfg.paramRules.rules[1]!.condition).toBe(4); // LESS_THAN_OR_EQUAL
    expect(cfg.paramRules.rules[1]!.ref).toBe(`0x${(125_000_000n).toString(16).padStart(64, "0")}`);
    expect(cfg.paramRules.rules[2]!.condition).toBe(0);
    expect(cfg.paramRules.rules[2]!.ref).toBe(`0x${"0".repeat(64)}`); // padding rule
  });
  it("multi-valued IN_SET is not expressible on-chain and is a hard error at composition (FR-5.3)", () => {
    const w = wire();
    (w.target_scope[1] as { param_rules: unknown[] }).param_rules[2] = { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 500 }, { kind: "uint", value: 3000 }] };
    expect(() => compose(w)).toThrow(ComposeError);
  });
});

describe("composeSession — spending limits", () => {
  it("an APPROVE target on a budgeted asset carries SpendingLimitsPolicy with the cumulative budget", () => {
    const { expectation } = compose();
    const approve = expectation.actions[0]!;
    const sl = approve.policies.find((p) => p.kind === "SPENDING_LIMITS")!;
    expect(sl.token).toBe(USDC);
    expect(sl.limit).toBe(500_000_000n);
    expect(lc(sl.address)).toBe(lc(BASE_SEPOLIA.spendingLimitsPolicy.address));
  });
  it("the swap target (not a token) gets no SpendingLimitsPolicy", () => {
    const { expectation } = compose();
    expect(expectation.actions[1]!.policies.map((p) => p.kind)).toStrictEqual(["UNIVERSAL_ACTION"]);
  });
});

describe("composeSession — guards", () => {
  it("refuses a policy for a different chain than the pinned address table", () => {
    expect(() => compose(wire({ chain_id: 8453 }))).toThrow(ComposeError);
  });
});
