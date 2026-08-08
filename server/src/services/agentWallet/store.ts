import { getSupabaseClient } from "../../config/supabase.js";
import type { AgentWalletRecord } from "./types.js";

/**
 * Persistence for agent wallet records. Backed by the Supabase `agent_wallets`
 * table; falls back to an in-process map if the table is absent (so local dev and
 * the demo run without a migration). Keyed by agent address.
 *
 * Expected table (snake_case columns):
 *   agent_address text primary key
 *   owner_address text not null
 *   policy_id text
 *   capability_id text
 *   encrypted_secret_key jsonb not null   -- the EncryptedData object
 *   created_at timestamptz not null default now()
 */
export class AgentWalletStore {
  private memory = new Map<string, AgentWalletRecord>();
  private tableMissing = false;

  private toRow(r: AgentWalletRecord) {
    return {
      agent_address: r.agentAddress,
      owner_address: r.ownerAddress,
      policy_id: r.policyId,
      capability_id: r.capabilityId,
      encrypted_secret_key: r.encryptedSecretKey,
      created_at: r.createdAt,
    };
  }

  private fromRow(row: any): AgentWalletRecord {
    return {
      agentAddress: row.agent_address,
      ownerAddress: row.owner_address,
      policyId: row.policy_id ?? null,
      capabilityId: row.capability_id ?? null,
      encryptedSecretKey: row.encrypted_secret_key,
      createdAt: row.created_at,
    };
  }

  async save(record: AgentWalletRecord): Promise<void> {
    this.memory.set(record.agentAddress, record);
    if (this.tableMissing) return;

    try {
      const { error } = await getSupabaseClient()
        .from("agent_wallets")
        .upsert(this.toRow(record), { onConflict: "agent_address" });
      if (error) this.handleDbError(error);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async getByAgentAddress(agentAddress: string): Promise<AgentWalletRecord | null> {
    if (this.tableMissing) return this.memory.get(agentAddress) ?? null;

    try {
      const { data, error } = await getSupabaseClient()
        .from("agent_wallets")
        .select("*")
        .eq("agent_address", agentAddress)
        .maybeSingle();
      if (error) {
        this.handleDbError(error);
        return this.memory.get(agentAddress) ?? null;
      }
      return data ? this.fromRow(data) : (this.memory.get(agentAddress) ?? null);
    } catch (err) {
      this.handleDbError(err);
      return this.memory.get(agentAddress) ?? null;
    }
  }

  async getByOwner(ownerAddress: string): Promise<AgentWalletRecord | null> {
    if (this.tableMissing) {
      for (const r of this.memory.values()) {
        if (r.ownerAddress === ownerAddress) return r;
      }
      return null;
    }

    try {
      const { data, error } = await getSupabaseClient()
        .from("agent_wallets")
        .select("*")
        .eq("owner_address", ownerAddress)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        this.handleDbError(error);
      } else if (data) {
        return this.fromRow(data);
      }
    } catch (err) {
      this.handleDbError(err);
    }

    for (const r of this.memory.values()) {
      if (r.ownerAddress === ownerAddress) return r;
    }
    return null;
  }

  /**
   * Once the policy + capability exist on-chain, bind them to the wallet record.
   */
  async bindPolicy(
    agentAddress: string,
    policyId: string,
    capabilityId: string,
  ): Promise<void> {
    const existing = await this.getByAgentAddress(agentAddress);
    if (!existing) throw new Error(`Agent wallet ${agentAddress} not found`);
    await this.save({ ...existing, policyId, capabilityId });
  }

  /**
   * Detach the policy/capability from a wallet (after revoke/expiry), so status
   * reports the agent as unbound and the create-policy flow becomes available.
   * Keeps the agent wallet + key; only clears the binding.
   */
  async unbindPolicy(agentAddress: string): Promise<void> {
    const existing = await this.getByAgentAddress(agentAddress);
    if (!existing) return;
    await this.save({ ...existing, policyId: null, capabilityId: null });
  }

  // A missing table (Postgres 42P01) shouldn't crash the demo — degrade to memory.
  private handleDbError(err: any) {
    const msg = (err?.message || "").toLowerCase();
    if (err?.code === "42P01" || msg.includes("does not exist")) {
      if (!this.tableMissing) {
        console.warn(
          "[AgentWalletStore] 'agent_wallets' table missing — using in-memory store. " +
            "Run the migration before relying on persistence across restarts.",
        );
      }
      this.tableMissing = true;
      return;
    }
    console.error("[AgentWalletStore] DB error:", err?.message || err);
  }
}

let instance: AgentWalletStore | null = null;

export function getAgentWalletStore(): AgentWalletStore {
  if (!instance) instance = new AgentWalletStore();
  return instance;
}
