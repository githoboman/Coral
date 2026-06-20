-- Agent wallet persistence for the Autonomous Agent Wallet.
-- One row per (owner, policy) agent wallet. The secret key is stored ONLY as the
-- AES-256-GCM EncryptedData object produced by EncryptionService — never plaintext.
-- Run this against the Supabase Postgres before relying on cross-restart persistence;
-- without it, AgentWalletStore degrades to an in-memory map.

create table if not exists agent_wallets (
  agent_address        text primary key,
  owner_address        text not null,
  policy_id            text,
  capability_id        text,
  encrypted_secret_key jsonb not null,
  created_at           timestamptz not null default now()
);

create index if not exists agent_wallets_owner_idx on agent_wallets (owner_address);

-- The encrypted_secret_key column holds the EncryptedData shape:
--   { "iv": "...", "salt": "...", "tag": "...", "encrypted": "..." }
-- It must never be exposed via any public-facing query or API.
