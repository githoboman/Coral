// ============================================================
// utils/executeTransaction.ts
// Helper to sign and execute a Sui transaction, then wait for it.
// ============================================================

import { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { logger } from "./logger";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 * Signs a Sui Transaction Block with the given keypair and sends it.
 *
 * @param suiClient - The Sui RPC client
 * @param transaction - The transaction to execute
 * @param keypair - The keypair to sign with (your Sui wallet)
 * @param showOutput - Whether to log the transaction result
 * @returns The transaction response (includes events, effects, etc.)
 */
export async function executeTransaction(
  suiClient: SuiClient,
  transaction: Transaction,
  keypair: Ed25519Keypair,
  showOutput = true,
): Promise<SuiTransactionBlockResponse> {
  logger.debug("Signing and executing Sui transaction...");

  try {
    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction,
      options: {
        // We want the events so we can detect bridge lock events
        showEvents: true,
        // We want the effects to check if the tx succeeded
        showEffects: true,
        // We want the object changes (e.g. to find newly created objects)
        showObjectChanges: true,
        // We want input objects for context
        showInput: true,
      },
    });

    // Wait for the transaction to be indexed/finalized
    await suiClient.waitForTransaction({
      digest: result.digest,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== "success") {
      const errorMsg = result.effects?.status?.error || "Unknown error";
      throw new Error(`Transaction failed: ${errorMsg}`);
    }

    if (showOutput) {
      logger.success("Sui transaction executed", {
        digest: result.digest,
        status: result.effects?.status?.status,
        gasUsed: result.effects?.gasUsed,
      });
    }

    return result;
  } catch (err) {
    logger.error("Failed to execute Sui transaction", err);
    throw err;
  }
}

export function loadSuiKeypair(privateKey: string): Ed25519Keypair {
  if (!privateKey) {
    throw new Error("SUI_PRIVATE_KEY is empty or missing in .env");
  }

  try {
    // Official Sui decoder (handles suiprivkey, hex, base64)
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch (err) {
    throw new Error(
      "Invalid SUI_PRIVATE_KEY format. Must be suiprivkey1..., 0x hex, or base64",
    );
  }
}

/**
 * Get the address of a keypair.
 */
export function getAddress(keypair: Ed25519Keypair): string {
  return keypair.toSuiAddress();
}
