/**
 * Preflight gate (FR-4.4, FR-2.11, CLAUDE.md §2.11): before anything is
 * signed, read the session's remaining on-chain allowances and simulate the
 * batch as the account. Any failure aborts with a typed `ErrorCode` — never
 * a raw revert string (FR-11.8) — and the retry class of that code decides
 * what happens next (policy rejections: never).
 *
 * The on-chain policies remain the enforcement; preflight exists so the
 * pipeline does not sign ops that will fail, and so users get legible reasons.
 */
import type { ErrorCode } from "@corral/core";
import type { Address, Hex, PublicClient } from "viem";

import { corralRateLimitPolicyAbi } from "../abi/corralRateLimitPolicy.js";
import { smartSessionsAbi } from "../abi/smartSessions.js";
import { spendingLimitsPolicyAbi } from "../abi/spendingLimitsPolicy.js";
import { timeFramePolicyAbi } from "../abi/timeFramePolicy.js";
import { usageLimitPolicyAbi } from "../abi/usageLimitPolicy.js";
import type { ChainAddresses } from "../addresses.js";
import { actionConfigId, actionId, userOpConfigId } from "../session/ids.js";

export interface PreflightInput {
  readonly client: PublicClient;
  readonly addresses: ChainAddresses;
  readonly account: Address;
  readonly permissionId: Hex;
  /** Token whose cumulative budget this execution consumes, and how much. */
  readonly spend: { token: Address; approveSelector: Hex; amount: bigint };
  /** The compiled batch calldata (execute(...)) to simulate as the account. */
  readonly callData: Hex;
  readonly now?: number;
}

export interface PreflightSnapshot {
  readonly budget: { limit: bigint; spent: bigint; remaining: bigint };
  readonly usage: { limit: bigint; used: bigint };
  readonly rateLimit: { limit: number; window: number; usedInWindow: number } | null;
  readonly timeFrame: { validAfter: number; validUntil: number };
}

export type PreflightResult = { ok: true; snapshot: PreflightSnapshot } | { ok: false; code: ErrorCode; detail: string; snapshot: PreflightSnapshot | null };

export async function preflight(p: PreflightInput): Promise<PreflightResult> {
  const { client, addresses, account, permissionId } = p;
  const ss = addresses.smartSessions.address;
  const now = p.now ?? Math.floor(Date.now() / 1000);

  const enabled = await client.readContract({ address: ss, abi: smartSessionsAbi, functionName: "isPermissionEnabled", args: [permissionId, account] });
  if (!enabled) return { ok: false, code: "SESSION_REVOKED", detail: "session is not enabled on this account", snapshot: null };

  const uoId = userOpConfigId(account, permissionId);
  const [usageLimit, usageUsed, tf] = await Promise.all([
    client.readContract({ address: addresses.usageLimitPolicy.address, abi: usageLimitPolicyAbi, functionName: "getUsageLimit", args: [uoId, ss, account] }),
    client.readContract({ address: addresses.usageLimitPolicy.address, abi: usageLimitPolicyAbi, functionName: "getUsed", args: [uoId, ss, account] }),
    client.readContract({ address: addresses.timeFramePolicy.address, abi: timeFramePolicyAbi, functionName: "getTimeFrameConfig", args: [uoId, ss, account] }),
  ]);
  const validUntil = Number(tf >> 48n);
  const validAfter = Number(tf & ((1n << 48n) - 1n));

  let rateLimit: PreflightSnapshot["rateLimit"] = null;
  try {
    const [limit, window] = await client.readContract({ address: addresses.corralRateLimitPolicy.address, abi: corralRateLimitPolicyAbi, functionName: "getRateLimitConfig", args: [uoId, ss, account] });
    if (limit !== 0) {
      const used = await client.readContract({ address: addresses.corralRateLimitPolicy.address, abi: corralRateLimitPolicyAbi, functionName: "getUsedInWindow", args: [uoId, ss, account, now] });
      rateLimit = { limit, window, usedInWindow: used };
    }
  } catch {
    rateLimit = null; // policy not part of this session
  }

  const aId = actionId(p.spend.token, p.spend.approveSelector);
  const cid = actionConfigId(account, permissionId, aId);
  const [limit, spent, approved] = await client.readContract({ address: addresses.spendingLimitsPolicy.address, abi: spendingLimitsPolicyAbi, functionName: "getPolicyData", args: [cid, ss, p.spend.token, account] });
  const consumed = spent > approved ? spent : approved;
  const snapshot: PreflightSnapshot = {
    budget: { limit, spent: consumed, remaining: limit > consumed ? limit - consumed : 0n },
    usage: { limit: usageLimit, used: usageUsed },
    rateLimit,
    timeFrame: { validAfter, validUntil },
  };

  // Cheap local checks first (FR-4.6: typed reasons, retry class decides).
  if (now < validAfter || (validUntil !== 0 && now >= validUntil)) return { ok: false, code: "POLICY_EXPIRED", detail: `now ${now} outside [${validAfter}, ${validUntil})`, snapshot };
  if (usageUsed >= usageLimit) return { ok: false, code: "POLICY_USAGE_LIMIT", detail: `lifetime executions ${usageUsed}/${usageLimit}`, snapshot };
  if (rateLimit && rateLimit.usedInWindow >= rateLimit.limit) return { ok: false, code: "POLICY_USAGE_LIMIT", detail: `rate limit ${rateLimit.usedInWindow}/${rateLimit.limit} in ${rateLimit.window}s`, snapshot };
  if (p.spend.amount > snapshot.budget.remaining) return { ok: false, code: "POLICY_BUDGET_EXCEEDED", detail: `needs ${p.spend.amount}, remaining ${snapshot.budget.remaining}`, snapshot };

  // Execution-phase simulation as the account itself (Safe7579 accepts
  // self-calls): catches slippage/liquidity/balance failures before signing.
  try {
    await client.call({ account, to: account, data: p.callData });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code: ErrorCode = /Too little received|STF|SPL|slippage/i.test(msg) ? "SLIPPAGE_EXCEEDED" : /transfer amount exceeds balance|insufficient/i.test(msg) ? "INSUFFICIENT_BALANCE" : "SIMULATION_REVERT";
    return { ok: false, code, detail: msg.split("\n")[0] ?? msg, snapshot };
  }
  return { ok: true, snapshot };
}
