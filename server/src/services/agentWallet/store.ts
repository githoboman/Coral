import { query } from "../corral/db/pool.js";
import type { AgentWalletRecord } from "./types.js";

/**
 * Persistence for agent wallet records. Backed by the `agent_wallets`
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
      encrypted_secret_key: JSON.stringify(r.encryptedSecretKey),
      created_at: r.createdAt,
    };
  }

  private fromRow(row: any): AgentWalletRecord {
    return {
      agentAddress: row.agent_address,
      ownerAddress: row.owner_address,
      policyId: row.policy_id ?? null,
      capabilityId: row.capability_id ?? null,
      encryptedSecretKey: typeof row.encrypted_secret_key === "string" ? JSON.parse(row.encrypted_secret_key) : row.encrypted_secret_key,
      createdAt: row.created_at,
    };
  }

  async save(record: AgentWalletRecord): Promise<void> {
    this.memory.set(record.agentAddress, record);
    if (this.tableMissing) return;

    try {
      const row = this.toRow(record);
      await query(
        `INSERT INTO agent_wallets (agent_address, owner_address, policy_id, capability_id, encrypted_secret_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_address) DO UPDATE SET
         owner_address = EXCLUDED.owner_address,
         policy_id = EXCLUDED.policy_id,
         capability_id = EXCLUDED.capability_id,
         encrypted_secret_key = EXCLUDED.encrypted_secret_key,
         created_at = EXCLUDED.created_at`,
        [row.agent_address, row.owner_address, row.policy_id, row.capability_id, row.encrypted_secret_key, row.created_at]
      );
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async getByAgentAddress(agentAddress: string): Promise<AgentWalletRecord | null> {
    if (this.tableMissing) return this.memory.get(agentAddress) ?? null;

    try {
      const rows = await query("SELECT * FROM agent_wallets WHERE agent_address = $1 LIMIT 1", [agentAddress]);
      return rows.length > 0 ? this.fromRow(rows[0]) : (this.memory.get(agentAddress) ?? null);
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
      const rows = await query(
        "SELECT * FROM agent_wallets WHERE owner_address = $1 ORDER BY created_at DESC LIMIT 1",
        [ownerAddress]
      );
      if (rows.length > 0) {
        return this.fromRow(rows[0]);
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
