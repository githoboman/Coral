/**
 * T-008 (test-first): post-install read-back verification (CLAUDE.md §2.2).
 * A fake chain reader exercises every mismatch class offline; the
 * integration script runs the same verifier against Base Sepolia.
 */
import { describe, expect, it } from "vitest";
import { parsePolicy } from "@corral/core";
import { decodeAbiParameters, type Address, type Hex } from "viem";
import { BASE_SEPOLIA } from "../../addresses.js";
import { composeSession, UAP_ACTION_CONFIG_ABI } from "../compose.js";
import { actionConfigId, userOpConfigId } from "../ids.js";
import { verifyInstalledSession, type ChainReader } from "../verify.js";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const ACCOUNT = "0xf2A97cd5439C01D5CE8bE75e0f7a8Dc8294C7343" as const;
const AGENT = "0x1111111111111111111111111111111111111111" as const;
const SALT = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

const composed = composeSession({
  policy: parsePolicy({
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
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: "0x000000000022d473030f116ddee9f6b43ac78ba3" }] },
          { rule: "LTE", param_index: 1, max: "125000000" },
        ],
      },
    ],
    action_scope: ["APPROVE"],
    valid_after: 1_754_000_000,
    valid_until: 1_756_600_000,
    max_executions: 8,
    max_executions_per_24h: 2,
    min_output_bps: 9800,
  }),
  account: ACCOUNT,
  agentSigner: AGENT,
  addresses: BASE_SEPOLIA,
  salt: SALT,
});
const E = composed.expectation;
const SS = BASE_SEPOLIA.smartSessions.address;
const K = (fn: string, args: readonly unknown[]): string => `${fn}(${args.map((a) => String(a).toLowerCase()).join(",")})`;

/** A faithful fake chain: answers every getter exactly as a correct install would. */
function faithfulReader(overrides: Record<string, unknown> = {}): ChainReader {
  const table = new Map<string, unknown>();
  const set = (fn: string, args: readonly unknown[], v: unknown): void => {
    table.set(K(fn, args), v);
  };

  set("isPermissionEnabled", [E.permissionId, ACCOUNT], true);
  set("getSessionValidatorAndConfig", [ACCOUNT, E.permissionId], [E.sessionValidator, E.sessionValidatorInitData]);
  set("getUserOpPolicies", [ACCOUNT, E.permissionId], E.userOpPolicies.map((p) => p.address));
  set("getEnabledActions", [ACCOUNT, E.permissionId], E.actions.map((a) => a.actionId));
  const uo = userOpConfigId(ACCOUNT, E.permissionId);
  for (const p of E.userOpPolicies) {
    if (p.kind === "VALUE_LIMIT") set("getValueLimit", [uo, SS, ACCOUNT], p.limit);
    if (p.kind === "USAGE_LIMIT") set("getUsageLimit", [uo, SS, ACCOUNT], p.limit);
    if (p.kind === "TIME_FRAME") set("getTimeFrameConfig", [uo, SS, ACCOUNT], p.packedTimeFrame);
  }
  for (const a of E.actions) {
    set("getActionPolicies", [ACCOUNT, E.permissionId, a.actionId], a.policies.map((p) => p.address));
    const cid = actionConfigId(ACCOUNT, E.permissionId, a.actionId);
    for (const p of a.policies) {
      if (p.kind === "UNIVERSAL_ACTION") {
        const [cfg] = decodeAbiParameters(UAP_ACTION_CONFIG_ABI, p.initData);
        set("actionConfigs", [cid, SS, ACCOUNT], [cfg.valueLimitPerUse, cfg.paramRules]);
      }
      if (p.kind === "SPENDING_LIMITS") set("getPolicyData", [cid, SS, p.token, ACCOUNT], [p.limit, 0n, 0n]);
    }
  }
  for (const [k, v] of Object.entries(overrides)) table.set(k, v);

  return {
    readContract(args: { functionName: string; args?: readonly unknown[] }): Promise<unknown> {
      const k = K(args.functionName, args.args ?? []);
      if (!table.has(k)) return Promise.reject(new Error(`fake reader: unexpected read ${k}`));
      return Promise.resolve(table.get(k));
    },
  };
}

describe("verifyInstalledSession", () => {
  it("a faithful install verifies with zero mismatches", async () => {
    const r = await verifyInstalledSession(faithfulReader(), BASE_SEPOLIA, E);
    expect(r.mismatches).toStrictEqual([]);
    expect(r.ok).toBe(true);
  });

  it("permission not enabled → not ok", async () => {
    const r = await verifyInstalledSession(faithfulReader({ [K("isPermissionEnabled", [E.permissionId, ACCOUNT])]: false }), BASE_SEPOLIA, E);
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((m) => m.what)).toContain("permissionEnabled");
  });

  it("a different session validator (e.g. the legacy OwnableValidator) is a mismatch", async () => {
    const r = await verifyInstalledSession(
      faithfulReader({ [K("getSessionValidatorAndConfig", [ACCOUNT, E.permissionId])]: ["0x2483DA3A338895199E5e538530213157e931Bf06", E.sessionValidatorInitData] }),
      BASE_SEPOLIA,
      E,
    );
    expect(r.mismatches.map((m) => m.what)).toContain("sessionValidator");
  });

  it("an extra userOp policy on-chain (policy set widened) is a mismatch", async () => {
    const extra: Address[] = [...E.userOpPolicies.map((p) => p.address), "0x0000000000FEEc8D74e3143fBaBbca515358d869"];
    const r = await verifyInstalledSession(faithfulReader({ [K("getUserOpPolicies", [ACCOUNT, E.permissionId])]: extra }), BASE_SEPOLIA, E);
    expect(r.mismatches.map((m) => m.what)).toContain("userOpPolicies");
  });

  it("usage limit stored higher than signed is a mismatch (the budget-widening case)", async () => {
    const uo = userOpConfigId(ACCOUNT, E.permissionId);
    const r = await verifyInstalledSession(faithfulReader({ [K("getUsageLimit", [uo, SS, ACCOUNT])]: 9n }), BASE_SEPOLIA, E);
    expect(r.mismatches.find((m) => m.what === "USAGE_LIMIT.limit")).toMatchObject({ expected: "8", actual: "9" });
  });

  it("time frame packed differently is a mismatch", async () => {
    const uo = userOpConfigId(ACCOUNT, E.permissionId);
    const r = await verifyInstalledSession(faithfulReader({ [K("getTimeFrameConfig", [uo, SS, ACCOUNT])]: 1n }), BASE_SEPOLIA, E);
    expect(r.mismatches.map((m) => m.what)).toContain("TIME_FRAME.config");
  });

  it("a missing action, or an action with a widened policy set, is a mismatch", async () => {
    const a0 = E.actions[0];
    if (!a0) throw new Error("fixture has no actions");
    const r1 = await verifyInstalledSession(faithfulReader({ [K("getEnabledActions", [ACCOUNT, E.permissionId])]: [a0.actionId] }), BASE_SEPOLIA, E);
    expect(r1.mismatches.map((m) => m.what)).toContain("enabledActions");
    const first = a0.policies[0];
    if (!first) throw new Error("fixture action has no policies");
    const r2 = await verifyInstalledSession(faithfulReader({ [K("getActionPolicies", [ACCOUNT, E.permissionId, a0.actionId])]: [first.address] }), BASE_SEPOLIA, E);
    expect(r2.mismatches.map((m) => m.what)).toContain(`action.${a0.actionId}.policies`);
  });

  it("a parameter rule altered on-chain is a mismatch (UAP config compare)", async () => {
    const a0 = E.actions[0];
    if (!a0) throw new Error("fixture has no actions");
    const uap = a0.policies.find((p) => p.kind === "UNIVERSAL_ACTION");
    if (!uap) throw new Error("fixture has no UAP");
    const cid = actionConfigId(ACCOUNT, E.permissionId, a0.actionId);
    const [cfg] = decodeAbiParameters(UAP_ACTION_CONFIG_ABI, uap.initData);
    const tampered = { ...cfg.paramRules, rules: cfg.paramRules.rules.map((r, i) => (i === 1 ? { ...r, ref: `0x${"f".repeat(64)}` as Hex } : r)) };
    const r = await verifyInstalledSession(faithfulReader({ [K("actionConfigs", [cid, SS, ACCOUNT])]: [cfg.valueLimitPerUse, tampered] }), BASE_SEPOLIA, E);
    expect(r.mismatches.map((m) => m.what)).toContain(`action.${a0.actionId}.UNIVERSAL_ACTION.rule[1]`);
  });

  it("a reverting config getter (PolicyNotInitialized) is a mismatch, never an exception", async () => {
    const a0 = E.actions[0];
    if (!a0) throw new Error("fixture has no actions");
    const cid = actionConfigId(ACCOUNT, E.permissionId, a0.actionId);
    const reader = faithfulReader();
    const inner = reader.readContract.bind(reader);
    reader.readContract = (args) =>
      args.functionName === "getPolicyData" && String(args.args?.[0]).toLowerCase() === cid.toLowerCase()
        ? Promise.reject(new Error("PolicyNotInitialized(...)"))
        : inner(args);
    const r = await verifyInstalledSession(reader, BASE_SEPOLIA, E);
    expect(r.ok).toBe(false);
    expect(r.mismatches.some((m) => m.what.startsWith("getPolicyData@") && m.actual.includes("PolicyNotInitialized"))).toBe(true);
  });

  it("spending limit stored higher than the budget is a mismatch", async () => {
    const a0 = E.actions[0];
    if (!a0) throw new Error("fixture has no actions");
    const cid = actionConfigId(ACCOUNT, E.permissionId, a0.actionId);
    const r = await verifyInstalledSession(faithfulReader({ [K("getPolicyData", [cid, SS, USDC, ACCOUNT])]: [500_000_001n, 0n, 0n] }), BASE_SEPOLIA, E);
    expect(r.mismatches.map((m) => m.what)).toContain(`action.${a0.actionId}.SPENDING_LIMITS.limit`);
  });
});
