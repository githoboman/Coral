import { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { logger } from "./logger";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 *
 * @param suiClient
 * @param transaction
 * @param keypair
 * @param showOutput
 * @returns
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
        showEvents: true,
        showEffects: true,
        showObjectChanges: true,
        showInput: true,
      },
    });

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
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch (err) {
    throw new Error(
      "Invalid SUI_PRIVATE_KEY format. Must be suiprivkey1..., 0x hex, or base64",
    );
  }
}

export function getAddress(keypair: Ed25519Keypair): string {
  return keypair.toSuiAddress();
}
