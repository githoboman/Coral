import { getSuiClient, getAgentPolicyConfig } from "./config.js";

/**
 * On-chain binding discovery. The agent store is in-memory (no DB), so a server
 * restart forgets which policy/capability an owner is bound to — breaking revoke,
 * swaps, and status. Rather than require a database, we rebuild the binding from
 * chain: the AgentCapability is an owned object held by the agent address and it
 * stores the policy_id in its Move fields. Finding that capability reconstructs
 * the full binding (policyId + capabilityId) after any restart.
 */
export interface DiscoveredBinding {
  policyId: string;
  capabilityId: string;
}

/**
 * Find the agent's AgentCapability on-chain and read its policy_id. Returns null
 * if the agent holds no capability (never delegated, or already revoked).
 */
export async function discoverBinding(agentAddress: string): Promise<DiscoveredBinding | null> {
  let packageId: string;
  try {
    ({ packageId } = getAgentPolicyConfig());
  } catch {
    return null; // package not configured — nothing to discover
  }

  const capType = `${packageId}::capability::AgentCapability`;
  const client = getSuiClient();

  try {
    // Owned objects of the AgentCapability type held by the agent address.
    let cursor: string | null | undefined = undefined;
    for (let page = 0; page < 5; page++) {
      const res = await client.getOwnedObjects({
        owner: agentAddress,
        filter: { StructType: capType },
        options: { showContent: true, showType: true },
        cursor: cursor ?? undefined,
      });

      for (const obj of res.data ?? []) {
        const id = obj.data?.objectId;
        const content: any = obj.data?.content;
        const policyId = content?.fields?.policy_id;
        if (id && policyId) {
          return { capabilityId: id, policyId: String(policyId) };
        }
      }

      if (!res.hasNextPage) break;
      cursor = res.nextCursor;
    }
  } catch (e: any) {
    console.warn(`[discovery] capability lookup failed for ${agentAddress.slice(0, 10)}…: ${e?.message ?? e}`);
  }

  return null;
}
