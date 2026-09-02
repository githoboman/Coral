/**
 * Budget reconciliation (FR-6.1, FR-6.2, FR-6.3).
 *
 * On-chain policy state is the single source of truth for remaining budget.
 * This refreshes the local mirror from chain after every execution and on a
 * schedule, and — the part that matters — **pauses the session** when the two
 * disagree rather than proceeding. A mirror that has drifted is a symptom;
 * guessing which side is right is exactly the wrong response.
 */
import { toFunctionSelector, type Address, type Hex, type PublicClient } from "viem";

import { smartSessionsAbi } from "../../evm/abi/smartSessions.js";
import { spendingLimitsPolicyAbi } from "../../evm/abi/spendingLimitsPolicy.js";
import { usageLimitPolicyAbi } from "../../evm/abi/usageLimitPolicy.js";
import type { ChainAddresses } from "../../evm/addresses.js";
import { actionConfigId, actionId, userOpConfigId } from "../../evm/session/ids.js";
import { query } from "../db/pool.js";
import { setStatus, type SessionRow } from "../sessions/repository.js";

const APPROVE_SELECTOR = toFunctionSelector("approve(address,uint256)");

export interface MirrorEntry {
  readonly asset: string;
  readonly limit: bigint;
  readonly spent: bigint;
  readonly remaining: bigint;
}

export interface ReconcileResult {
  readonly entries: readonly MirrorEntry[];
  readonly usage: { readonly limit: number; readonly used: number };
  /** Set when chain and mirror disagree; the session has been paused. */
  readonly drift: string | null;
  /** Set when the session is no longer enabled on chain (revoked elsewhere). */
  readonly revokedOnChain: boolean;
}

interface PolicyShape {
  readonly budgets?: readonly { readonly asset: { readonly address: string | null }; readonly max_total: string }[];
}

export async function refreshBudgetMirror(client: PublicClient, addresses: ChainAddresses, session: SessionRow): Promise<ReconcileResult> {
  const account = session.account as Address;
  const permissionId = session.permission_id as Hex;
  const ss = addresses.smartSessions.address;

  const enabled = await client.readContract({ address: ss, abi: smartSessionsAbi, functionName: "isPermissionEnabled", args: [permissionId, account] });
  if (!enabled) {
    await setStatus(session.id, "REVOKED");
    await recordAnomaly(session.id, "SESSION_REVOKED_ONCHAIN", { permissionId });
    return { entries: [], usage: { limit: 0, used: 0 }, drift: null, revokedOnChain: true };
  }

  const uoId = userOpConfigId(account, permissionId);
  const [usageLimit, usageUsed] = await Promise.all([
    client.readContract({ address: addresses.usageLimitPolicy.address, abi: usageLimitPolicyAbi, functionName: "getUsageLimit", args: [uoId, ss, account] }),
    client.readContract({ address: addresses.usageLimitPolicy.address, abi: usageLimitPolicyAbi, functionName: "getUsed", args: [uoId, ss, account] }),
  ]);

  const policy = session.policy as PolicyShape;
  const entries: MirrorEntry[] = [];
  let drift: string | null = null;

  for (const budget of policy.budgets ?? []) {
    const token = budget.asset.address;
    if (!token) continue; // native budgets are the value limit, not a spending limit
    const cid = actionConfigId(account, permissionId, actionId(token as Address, APPROVE_SELECTOR));
    const [chainLimit, alreadySpent, approvedAmount] = await client.readContract({
      address: addresses.spendingLimitsPolicy.address,
      abi: spendingLimitsPolicyAbi,
      functionName: "getPolicyData",
      args: [cid, ss, token as Address, account],
    });
    // The policy module counts an approval as committed spend, so the
    // conservative figure is the larger of the two.
    const spent = alreadySpent > approvedAmount ? alreadySpent : approvedAmount;

    // The signed policy and the chain must agree on the ceiling. If they do
    // not, the session is enforcing something the user did not sign — that is
    // an install-verification failure surfacing late, and it pauses hard.
    const signedLimit = BigInt(budget.max_total);
    if (chainLimit !== signedLimit) {
      drift = `spending limit for ${token}: signed ${signedLimit}, chain ${chainLimit}`;
      await setStatus(session.id, "PAUSED_MISMATCH");
      await recordAnomaly(session.id, "MIRROR_DRIFT", { token, signedLimit: signedLimit.toString(), chainLimit: chainLimit.toString() });
      continue;
    }

    // The mirror must never be *behind* the chain in a way that would let us
    // plan a spend the chain has already consumed.
    const previous = await query<{ spent_amount: string }>(`SELECT spent_amount FROM corral_budget_mirror WHERE session_id = $1 AND asset = $2`, [session.id, token]);
    const prevSpent = previous[0] ? BigInt(previous[0].spent_amount) : 0n;
    if (prevSpent > spent) {
      drift = `mirror for ${token} claims ${prevSpent} spent, chain says ${spent}`;
      await setStatus(session.id, "PAUSED_DRIFT");
      await recordAnomaly(session.id, "MIRROR_DRIFT", { token, mirrorSpent: prevSpent.toString(), chainSpent: spent.toString() });
    }

    await query(
      `INSERT INTO corral_budget_mirror (session_id, asset, limit_amount, spent_amount, usage_used, usage_limit, read_at)
       VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6, now())
       ON CONFLICT (session_id, asset) DO UPDATE
         SET limit_amount = EXCLUDED.limit_amount, spent_amount = EXCLUDED.spent_amount,
             usage_used = EXCLUDED.usage_used, usage_limit = EXCLUDED.usage_limit, read_at = now()`,
      [session.id, token, chainLimit.toString(), spent.toString(), Number(usageUsed), Number(usageLimit)],
    );
    entries.push({ asset: token, limit: chainLimit, spent, remaining: chainLimit > spent ? chainLimit - spent : 0n });
  }

  return { entries, usage: { limit: Number(usageLimit), used: Number(usageUsed) }, drift, revokedOnChain: false };
}

export async function recordAnomaly(sessionId: string | null, kind: string, detail: Record<string, unknown>): Promise<void> {
  await query(`INSERT INTO corral_anomalies (session_id, kind, detail) VALUES ($1, $2, $3::jsonb)`, [sessionId, kind, JSON.stringify(detail)]);
}
