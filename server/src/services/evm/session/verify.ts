/**
 * Post-install read-back verification (T-008, CLAUDE.md §2.2, SEC-15).
 *
 * After a session install confirms, read the session back from chain —
 * validator, userOp policies, actions, action policies, and every policy's
 * stored configuration — and compare it with the `SessionExpectation` the
 * composer derived from the policy the user signed. Only a zero-mismatch
 * result may mark a session ACTIVE. A mismatch pauses and pages; it is
 * never reconciled automatically.
 *
 * Reads go through a minimal `ChainReader` so the comparison logic is unit
 * tested offline against a fake chain; a viem PublicClient satisfies it.
 * A getter that reverts (e.g. a policy's PolicyNotInitialized) is itself
 * evidence the chain state is not what was signed: it is recorded as a
 * mismatch, never thrown — an aborted verification could be mistaken for
 * "not yet checked" and retried into a false ACTIVE.
 */
import { decodeAbiParameters, type Address, type Hex } from "viem";

import type { ChainAddresses } from "../addresses.js";
import { smartSessionsAbi } from "../abi/smartSessions.js";
import { spendingLimitsPolicyAbi } from "../abi/spendingLimitsPolicy.js";
import { timeFramePolicyAbi } from "../abi/timeFramePolicy.js";
import { universalActionPolicyAbi } from "../abi/universalActionPolicy.js";
import { usageLimitPolicyAbi } from "../abi/usageLimitPolicy.js";
import { valueLimitPolicyAbi } from "../abi/valueLimitPolicy.js";
import { UAP_ACTION_CONFIG_ABI, type SessionExpectation } from "./compose.js";
import { actionConfigId, userOpConfigId } from "./ids.js";

export interface ChainReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

export interface Mismatch {
  readonly what: string;
  readonly expected: string;
  readonly actual: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly mismatches: readonly Mismatch[];
}

interface StoredRule {
  condition: number;
  offset: bigint;
  isLimited: boolean;
  ref: Hex;
  usage: { limit: bigint };
}

const REVERTED: unique symbol = Symbol("reverted");
type Read<T> = T | typeof REVERTED;

const lc = (s: string): string => s.toLowerCase();
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(lc).sort();
  const sb = [...b].map(lc).sort();
  return sa.every((v, i) => v === sb[i]);
}
function show(v: unknown): string {
  if (typeof v === "bigint") return v.toString(10);
  if (Array.isArray(v)) return `[${v.map(show).join(",")}]`;
  return String(v);
}

export async function verifyInstalledSession(
  reader: ChainReader,
  addresses: ChainAddresses,
  expected: SessionExpectation,
): Promise<VerifyResult> {
  const mismatches: Mismatch[] = [];
  const miss = (what: string, exp: unknown, act: unknown): void => {
    mismatches.push({ what, expected: show(exp), actual: show(act) });
  };
  const ss = addresses.smartSessions.address;
  const { account, permissionId } = expected;

  async function read<T>(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]): Promise<Read<T>> {
    try {
      return (await reader.readContract({ address, abi, functionName, args })) as T;
    } catch (e) {
      const reason = e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e);
      miss(`${functionName}@${address}`, "readable", `revert: ${reason}`);
      return REVERTED;
    }
  }

  // 1. The permission is enabled at all.
  const enabled = await read<boolean>(ss, smartSessionsAbi, "isPermissionEnabled", [permissionId, account]);
  if (enabled !== REVERTED && enabled !== true) miss("permissionEnabled", true, enabled);

  // 2. Session validator + its init data.
  const vc = await read<[Address, Hex]>(ss, smartSessionsAbi, "getSessionValidatorAndConfig", [account, permissionId]);
  if (vc !== REVERTED) {
    const [validator, validatorData] = vc;
    if (lc(validator) !== lc(expected.sessionValidator)) miss("sessionValidator", expected.sessionValidator, validator);
    if (lc(validatorData) !== lc(expected.sessionValidatorInitData)) {
      miss("sessionValidatorInitData", expected.sessionValidatorInitData, validatorData);
    }
  }

  // 3. userOp policy set — exact set equality (nothing added, nothing missing).
  const uoPolicies = await read<Address[]>(ss, smartSessionsAbi, "getUserOpPolicies", [account, permissionId]);
  const expectedUo = expected.userOpPolicies.map((p) => p.address);
  if (uoPolicies !== REVERTED && !sameSet(uoPolicies, expectedUo)) miss("userOpPolicies", expectedUo, uoPolicies);

  // 4. Each userOp policy's stored config.
  const uoId = userOpConfigId(account, permissionId);
  for (const p of expected.userOpPolicies) {
    switch (p.kind) {
      case "VALUE_LIMIT": {
        const v = await read<bigint>(addresses.valueLimitPolicy.address, valueLimitPolicyAbi, "getValueLimit", [uoId, ss, account]);
        if (v !== REVERTED && v !== p.limit) miss("VALUE_LIMIT.limit", p.limit, v);
        break;
      }
      case "USAGE_LIMIT": {
        const v = await read<bigint>(addresses.usageLimitPolicy.address, usageLimitPolicyAbi, "getUsageLimit", [uoId, ss, account]);
        if (v !== REVERTED && v !== p.limit) miss("USAGE_LIMIT.limit", p.limit, v);
        break;
      }
      case "TIME_FRAME": {
        const v = await read<bigint>(addresses.timeFramePolicy.address, timeFramePolicyAbi, "getTimeFrameConfig", [uoId, ss, account]);
        if (v !== REVERTED && v !== p.packedTimeFrame) miss("TIME_FRAME.config", p.packedTimeFrame, v);
        break;
      }
    }
  }

  // 5. Enabled action set — exact.
  const enabledActions = await read<Hex[]>(ss, smartSessionsAbi, "getEnabledActions", [account, permissionId]);
  const expectedActions = expected.actions.map((a) => a.actionId);
  if (enabledActions !== REVERTED && !sameSet(enabledActions, expectedActions)) miss("enabledActions", expectedActions, enabledActions);

  // 6. Per action: policy set — exact — and each policy's stored config.
  for (const a of expected.actions) {
    const policies = await read<Address[]>(ss, smartSessionsAbi, "getActionPolicies", [account, permissionId, a.actionId]);
    const expectedP = a.policies.map((p) => p.address);
    if (policies !== REVERTED && !sameSet(policies, expectedP)) miss(`action.${a.actionId}.policies`, expectedP, policies);

    const cid = actionConfigId(account, permissionId, a.actionId);
    for (const p of a.policies) {
      if (p.kind === "UNIVERSAL_ACTION") {
        const cfg = await read<[bigint, { length: bigint; rules: readonly StoredRule[] }]>(
          addresses.universalActionPolicy.address,
          universalActionPolicyAbi,
          "actionConfigs",
          [cid, ss, account],
        );
        if (cfg === REVERTED) continue;
        const [valueLimitPerUse, paramRules] = cfg;
        const [exp] = decodeAbiParameters(UAP_ACTION_CONFIG_ABI, p.initData);
        const tag = `action.${a.actionId}.UNIVERSAL_ACTION`;
        if (valueLimitPerUse !== exp.valueLimitPerUse) miss(`${tag}.valueLimitPerUse`, exp.valueLimitPerUse, valueLimitPerUse);
        if (paramRules.length !== exp.paramRules.length) miss(`${tag}.rules.length`, exp.paramRules.length, paramRules.length);
        const n = Number(exp.paramRules.length);
        for (let i = 0; i < n; i++) {
          const e = exp.paramRules.rules[i];
          const g = paramRules.rules[i];
          if (e === undefined) continue;
          const same =
            g !== undefined &&
            Number(g.condition) === Number(e.condition) &&
            BigInt(g.offset) === BigInt(e.offset) &&
            g.isLimited === e.isLimited &&
            lc(g.ref) === lc(e.ref) &&
            BigInt(g.usage.limit) === BigInt(e.usage.limit);
          if (!same) {
            miss(`${tag}.rule[${i}]`, `${e.condition}@${e.offset}:${e.ref}`, g ? `${g.condition}@${g.offset}:${g.ref}` : "absent");
          }
        }
      } else {
        const d = await read<[bigint, bigint, bigint]>(addresses.spendingLimitsPolicy.address, spendingLimitsPolicyAbi, "getPolicyData", [cid, ss, p.token, account]);
        if (d === REVERTED) continue;
        const [limit] = d;
        if (limit !== p.limit) miss(`action.${a.actionId}.SPENDING_LIMITS.limit`, p.limit, limit);
      }
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
