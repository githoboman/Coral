import { getSuiClient } from "./config.js";
import { AgentActionType } from "./types.js";

/**
 * Off-chain mirror of the on-chain AgentPolicy. Field names track the Move struct.
 * Decoded from the shared object's Move fields via getObject(showContent).
 */
export interface OnChainPolicy {
  policyId: string;
  owner: string;
  agentAddress: string;
  budgetCap: bigint;
  budgetSpent: bigint;
  allowedProtocols: string[];
  allowedAssets: string[];
  allowedActions: number[];
  expiryTimestamp: bigint;
  isActive: boolean;
  gasReserve: bigint;
  createdAt: bigint;
}

export interface PreflightInput {
  actionType: AgentActionType;
  /** Spend amount in the budget's base units. */
  amount: bigint;
  /** Canonical protocol id string (must match an allowed_protocols entry). */
  protocol: string;
  /** Canonical asset type string (must match an allowed_assets entry). */
  asset: string;
}

export type PreflightResult =
  | { ok: true; policy: OnChainPolicy }
  | { ok: false; reason: string; policy?: OnChainPolicy };

/**
 * Reads the on-chain policy and runs the same constraint checks validate_action
 * enforces — but here as a fast, gas-free pre-flight. This is an OPTIMIZATION:
 * obviously-invalid intents are rejected before a PTB is built. The Move contract
 * remains the authoritative guarantee; the two must stay in lockstep.
 */
export class PolicyChecker {
  /** Fetch and decode the shared AgentPolicy object. Returns null if not found. */
  async readPolicy(policyId: string): Promise<OnChainPolicy | null> {
    const res = await getSuiClient().getObject({
      id: policyId,
      options: { showContent: true },
    });

    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const f = (content as any).fields;

    return {
      policyId,
      owner: f.owner,
      agentAddress: f.agent_address,
      budgetCap: BigInt(f.budget_cap),
      budgetSpent: BigInt(f.budget_spent),
      // ascii::String fields decode as { fields: { bytes: number[] } } or as a
      // plain string depending on RPC version; normalize both.
      allowedProtocols: (f.allowed_protocols ?? []).map(decodeAscii),
      allowedAssets: (f.allowed_assets ?? []).map(decodeAscii),
      allowedActions: (f.allowed_actions ?? []).map((n: any) => Number(n)),
      expiryTimestamp: BigInt(f.expiry_timestamp),
      isActive: Boolean(f.is_active),
      gasReserve: BigInt(f.gas_reserve),
      createdAt: BigInt(f.created_at),
    };
  }

  /**
   * Run the full pre-flight. nowMs lets callers inject a clock for testing;
   * defaults to wall time, which is close enough to on-chain Clock for a soft check.
   */
  async preflight(
    policyId: string,
    input: PreflightInput,
    nowMs: number = Date.now(),
  ): Promise<PreflightResult> {
    const policy = await this.readPolicy(policyId);
    if (!policy) return { ok: false, reason: "Policy object not found on-chain" };

    // Order matters: an expired policy is also inactive, but "expired" is the more
    // actionable message (create a new one), so check expiry first.
    if (BigInt(nowMs) >= policy.expiryTimestamp) {
      return {
        ok: false,
        reason: "This policy has expired. Create a new policy to keep trading.",
        policy,
      };
    }
    if (!policy.isActive) {
      // Inactive but not expired = either paused (resumable) or revoked (gone).
      return {
        ok: false,
        reason:
          "This policy is inactive — it was paused or revoked. Resume it, or create a new policy to trade.",
        policy,
      };
    }
    if (!policy.allowedActions.includes(input.actionType)) {
      return { ok: false, reason: `Action ${AgentActionType[input.actionType]} not permitted by policy`, policy };
    }
    if (!policy.allowedProtocols.includes(input.protocol)) {
      return { ok: false, reason: `Protocol ${input.protocol} not whitelisted`, policy };
    }
    const movesValue =
      input.actionType === AgentActionType.Swap ||
      input.actionType === AgentActionType.LimitOrder;
    if (movesValue && !policy.allowedAssets.includes(input.asset)) {
      return { ok: false, reason: `Asset ${input.asset} not whitelisted`, policy };
    }
    if (policy.budgetSpent + input.amount > policy.budgetCap) {
      const remaining = policy.budgetCap - policy.budgetSpent;
      return {
        ok: false,
        reason: `Budget exceeded: needs ${input.amount}, only ${remaining} remaining of ${policy.budgetCap}`,
        policy,
      };
    }

    return { ok: true, policy };
  }
}

/** Decode an on-chain ascii::String field to a JS string across RPC shapes. */
function decodeAscii(v: any): string {
  if (typeof v === "string") return v;
  const bytes = v?.fields?.bytes ?? v?.bytes;
  if (Array.isArray(bytes)) return Buffer.from(bytes).toString("ascii");
  return String(v);
}

let instance: PolicyChecker | null = null;
export function getPolicyChecker(): PolicyChecker {
  if (!instance) instance = new PolicyChecker();
  return instance;
}
