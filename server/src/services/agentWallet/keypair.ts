import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { getEncryptionService } from "../encryptionService.js";
import type { EncryptedData } from "../encryptionService.js";
import type { GeneratedAgentWallet } from "./types.js";

/**
 * Custody for the server-managed agent keypair. For the hackathon (testnet only)
 * the agent signs with a backend-held Ed25519 key; the on-chain AgentPolicy is the
 * real constraint layer, so a compromised key still cannot exceed budget/scope.
 * Mainnet path (zkLogin/MPC) is intentionally out of scope here.
 *
 * The plaintext secret key exists only transiently inside signer() and generate().
 * At rest it is always the AES-256-GCM EncryptedData produced by EncryptionService.
 */
export class AgentKeypairService {
  /**
   * Generate a brand-new agent wallet. Returns the address plus the encrypted
   * secret key for the caller to persist. The plaintext is discarded here.
   */
  generate(): GeneratedAgentWallet {
    const keypair = Ed25519Keypair.generate();
    const agentAddress = keypair.toSuiAddress();

    // exportKeypair() yields the Bech32 `suiprivkey1...` form — the canonical
    // string the SDK round-trips through decodeSuiPrivateKey on the way back in.
    const bech32SecretKey = keypair.getSecretKey();
    const encryptedSecretKey = getEncryptionService().encrypt(bech32SecretKey);

    return { agentAddress, encryptedSecretKey };
  }

  /**
   * Import an existing agent wallet from its Bech32 `suiprivkey1...` secret key
   * (e.g. an agent provisioned out-of-band on testnet). Encrypts the key for
   * storage the same way generate() does, so the rest of the engine is agnostic
   * to whether the key was generated or imported.
   */
  fromBech32(bech32SecretKey: string): GeneratedAgentWallet {
    const { secretKey } = decodeSuiPrivateKey(bech32SecretKey.trim());
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const encryptedSecretKey = getEncryptionService().encrypt(keypair.getSecretKey());
    return { agentAddress: keypair.toSuiAddress(), encryptedSecretKey };
  }

  /**
   * Reconstruct the signing keypair from its encrypted form. Used by the executor
   * immediately before signing a PTB; the decrypted material is not retained.
   */
  signer(encryptedSecretKey: EncryptedData): Ed25519Keypair {
    const bech32SecretKey = getEncryptionService().decrypt(encryptedSecretKey);
    const { secretKey } = decodeSuiPrivateKey(bech32SecretKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }

  /** Derive the Sui address for an encrypted key without exposing the secret. */
  addressOf(encryptedSecretKey: EncryptedData): string {
    return this.signer(encryptedSecretKey).toSuiAddress();
  }
}

let instance: AgentKeypairService | null = null;

export function getAgentKeypairService(): AgentKeypairService {
  if (!instance) instance = new AgentKeypairService();
  return instance;
}
