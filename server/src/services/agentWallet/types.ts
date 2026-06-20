import type { EncryptedData } from "../encryptionService.js";

/**
 * Persisted record of an agent wallet. The secret key is stored only in its
 * encrypted form — the plaintext never touches disk or logs. One agent wallet
 * is derived per (owner, policy) binding.
 */
export interface AgentWalletRecord {
  /** Sui address of the agent wallet (derived from its Ed25519 public key). */
  agentAddress: string;
  /** Owner (user) address that controls this agent via the on-chain policy. */
  ownerAddress: string;
  /** On-chain AgentPolicy object id this wallet acts under. Null until bound. */
  policyId: string | null;
  /** On-chain AgentCapability object id held by this wallet. Null until issued. */
  capabilityId: string | null;
  /** AES-256-GCM encrypted Bech32 Sui private key (suiprivkey1...). */
  encryptedSecretKey: EncryptedData;
  createdAt: string;
}

/** Result of generating a fresh agent wallet, returned to the caller in memory. */
export interface GeneratedAgentWallet {
  agentAddress: string;
  encryptedSecretKey: EncryptedData;
}

/** Action types mirrored from the Move policy/events modules. */
export enum AgentActionType {
  Swap = 0,
  LimitOrder = 1,
  Cancel = 2,
  ClaimFill = 3,
}

/** Status codes mirrored from the Move events module. */
export enum AgentActionStatus {
  Executed = 0,
  Failed = 1,
  Cancelled = 2,
}
