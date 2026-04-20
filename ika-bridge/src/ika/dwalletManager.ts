// ============================================================
// ika/dwalletManager.ts
//
// Creates and manages the bridge's Shared dWallets.
//
// Two dWallets are created:
//   1. dWallet_EVM  — secp256k1, signs Ethereum transactions
//   2. dWallet_SOL  — ed25519,   signs Solana transactions
//
// Shared dWallet vs Zero-Trust:
//   The user share is stored publicly on-chain, so the Ika network
//   can sign on behalf of the bridge without the server needing to
//   decrypt anything. This is the correct model for an automated
//   relayer that signs without human interaction.
//
// Run setup-dwallets.ts ONCE, then save the resulting bridge-state.json.
// ============================================================

import fs from "fs";
import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  publicKeyFromDWalletOutput,
  Curve,
  prepareDKGAsync,
  createRandomSessionIdentifier,
} from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";

import { BridgeState, DWalletInfo } from "../types";
import { config } from "../config";
import { getIkaClient, getSuiClient } from "./client";
import {
  executeTransaction,
  loadSuiKeypair,
  getAddress,
} from "../utils/executeTransaction";
import { logger } from "../utils/logger";

// ---- IKA coin type on testnet ----
// This is the IKA token used to pay for Ika protocol fees.
// Verify this matches the current testnet deployment if you get coin errors.
const IKA_COIN_TYPE =
  "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA";

// ---- Load/Save bridge state ----

export function loadBridgeState(): BridgeState | null {
  const stateFile = config.ika.stateFile;
  if (!fs.existsSync(stateFile)) {
    logger.warn(`Bridge state file not found: ${stateFile}`);
    logger.warn("Run `pnpm setup` first.");
    return null;
  }
  const raw = fs.readFileSync(stateFile, "utf-8");
  const state = JSON.parse(raw) as BridgeState;
  logger.info("Loaded bridge state", {
    evmDWalletId: state.evmDWallet.dWalletId,
    evmAddress: state.evmDWallet.targetChainAddress,
    solanaDWalletId: state.solanaDWallet.dWalletId,
    solanaAddress: state.solanaDWallet.targetChainAddress,
  });
  return state;
}

export function saveBridgeState(state: BridgeState): void {
  const stateFile = config.ika.stateFile;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  logger.success(`Bridge state saved to ${stateFile}`);
}

// ---- Coin helpers ----

/**
 * Fetch the first available IKA coin for the signer address.
 * Throws a helpful error if none are found.
 */
async function getIkaCoin(
  suiClient: SuiClient,
  signerAddress: string,
  label: string,
): Promise<string> {
  const { data } = await suiClient.getCoins({
    owner: signerAddress,
    coinType: IKA_COIN_TYPE,
  });
  if (!data.length) {
    throw new Error(
      `[${label}] No IKA tokens found in wallet ${signerAddress}.\n` +
        `Get testnet IKA from the Ika faucet before running setup.`,
    );
  }
  return data[0].coinObjectId;
}

// ---- Core dWallet creation (Shared) ----

/**
 * Create a Shared dWallet for the given curve.
 *
 * Key difference from Zero-Trust:
 *   - Uses requestDWalletDKGWithPublicUserShare instead of requestDWalletDKG
 *   - No acceptEncryptedUserShare step needed — dWallet becomes Active immediately
 *   - The user secret key share is stored publicly on-chain
 *   - Signing never requires decrypting a user share
 */
async function createSharedDWalletForChain(
  ikaClient: IkaClient,
  suiClient: SuiClient,
  curve: typeof Curve.SECP256K1 | typeof Curve.ED25519,
  chainLabel: string,
): Promise<DWalletInfo> {
  logger.info(`Creating Shared dWallet for ${chainLabel}...`, { curve });

  const keypair = loadSuiKeypair(config.ika.suiPrivateKey);
  const signerAddress = getAddress(keypair);

  // Step 1: Create UserShareEncryptionKeys.
  // Even for Shared dWallets, UserShareEncryptionKeys is required for the DKG
  // protocol itself. The seed is namespaced per chain so EVM and Solana keys
  // are independent.
  logger.debug(`[${chainLabel}] Generating user share encryption keys...`);
  const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    new TextEncoder().encode(config.ika.bridgeSeed + ":" + chainLabel),
    curve,
  );

  // Step 2: Register encryption key (required before DKG).
  // This is idempotent — safe to retry if setup is interrupted.
  logger.debug(`[${chainLabel}] Registering encryption key...`);
  try {
    const regTx = new Transaction();
    const regIkaTx = new IkaTransaction({
      ikaClient,
      transaction: regTx,
      userShareEncryptionKeys,
    });
    await regIkaTx.registerEncryptionKey({ curve });
    await executeTransaction(suiClient, regTx, keypair);
    logger.debug(`[${chainLabel}] Encryption key registered.`);
  } catch (e: any) {
    // Already registered is fine — continue
    if (
      e?.message?.includes("dynamic_field") ||
      e?.message?.includes("MoveAbort")
    ) {
      logger.debug(
        `[${chainLabel}] Encryption key already registered, continuing.`,
      );
    } else {
      throw e;
    }
  }

  // Step 3: Prepare DKG input.
  logger.debug(`[${chainLabel}] Preparing DKG input...`);
  const sessionIdentifierBytes = createRandomSessionIdentifier();

  const dkgRequestInput = await prepareDKGAsync(
    ikaClient,
    curve,
    userShareEncryptionKeys,
    sessionIdentifierBytes,
    signerAddress,
  );

  // Step 4: Get the current network encryption key.
  const dWalletEncryptionKey = await ikaClient.getLatestNetworkEncryptionKey();

  // Step 5: Fetch IKA coin for protocol fee.
  const ikaCoinObjectId = await getIkaCoin(
    suiClient,
    signerAddress,
    chainLabel,
  );

  // Step 6: Build and submit the Shared DKG transaction.
  // requestDWalletDKGWithPublicUserShare makes the user share public on-chain,
  // enabling the network to sign without server participation.
  logger.info(
    `[${chainLabel}] Submitting Shared DKG request to Ika network...`,
  );

  const dkgTx = new Transaction();
  const dkgIkaTx = new IkaTransaction({
    ikaClient,
    transaction: dkgTx,
    userShareEncryptionKeys,
  });

  const sessionIdentifier = dkgIkaTx.registerSessionIdentifier(
    sessionIdentifierBytes,
  );
  const ikaCoin = dkgTx.object(ikaCoinObjectId);

  const [dWalletCapResult] =
    await dkgIkaTx.requestDWalletDKGWithPublicUserShare({
      // These three fields come from dkgRequestInput
      publicKeyShareAndProof: dkgRequestInput.userDKGMessage,
      publicUserSecretKeyShare: dkgRequestInput.userSecretKeyShare, // public, not encrypted
      userPublicOutput: dkgRequestInput.userPublicOutput,
      curve,
      dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
      sessionIdentifier,
      ikaCoin,
      suiCoin: dkgTx.gas,
    });

  dkgTx.transferObjects([dWalletCapResult], signerAddress);

  const dkgResult = await executeTransaction(suiClient, dkgTx, keypair);

  // Step 7: Extract the DWalletCap object ID from the transaction output.
  const dWalletCapObj = dkgResult.objectChanges?.find(
    (c) => c.type === "created" && c.objectType?.includes("DWalletCap"),
  );
  if (!dWalletCapObj || dWalletCapObj.type !== "created") {
    throw new Error(
      `[${chainLabel}] Could not find DWalletCap in transaction output.\n` +
        `Object changes: ${JSON.stringify(dkgResult.objectChanges, null, 2)}`,
    );
  }
  const resolvedCapId = dWalletCapObj.objectId;

  // Step 8: Extract the dWallet ID from the cap object.
  const capObject = await suiClient.getObject({
    id: resolvedCapId,
    options: { showContent: true },
  });
  const capContent = capObject.data?.content as any;
  const dWalletId = capContent?.fields?.dwallet_id;
  if (!dWalletId) {
    throw new Error(
      `[${chainLabel}] Could not extract dwallet_id from DWalletCap.\n` +
        `Cap content: ${JSON.stringify(capContent, null, 2)}`,
    );
  }

  // Step 9: Wait for the dWallet to become Active.
  // Shared dWallets go directly to Active — no AwaitingKeyHolderSignature step.
  logger.info(`[${chainLabel}] Waiting for dWallet to become Active...`);
  const activeDWallet = await ikaClient.getDWalletInParticularState(
    dWalletId,
    "Active",
    { timeout: 120_000, interval: 2_000 },
  );

  // Verify the dWallet has a public user share (confirming it's Shared, not Zero-Trust)
  if (!activeDWallet.public_user_secret_key_share) {
    throw new Error(
      `[${chainLabel}] dWallet does not have a public user share — ` +
        `it was not created as a Shared dWallet.`,
    );
  }

  // Step 10: Derive the target chain address from the dWallet's public key.
  const activeState = (activeDWallet.state as any).Active;
  if (!activeState?.public_output) {
    throw new Error(
      `[${chainLabel}] Could not find public_output in Active dWallet state`,
    );
  }

  const publicKeyBytes = await publicKeyFromDWalletOutput(
    curve,
    activeState.public_output,
  );
  const targetChainAddress = deriveChainAddress(
    curve,
    Array.from(publicKeyBytes),
  );

  logger.success(`[${chainLabel}] Shared dWallet created! 🎉`, {
    dWalletId: activeDWallet.id.id,
    dWalletCapId: resolvedCapId,
    targetChainAddress,
  });

  return {
    dWalletId: activeDWallet.id.id,
    dWalletCapId: resolvedCapId,
    // Shared dWallets have no encrypted share — this field is unused at signing time
    // but kept in the type for compatibility. Set to empty string.
    encryptedUserSecretKeyShareId: "",
    targetChainAddress,
    curve: curve === Curve.SECP256K1 ? "SECP256K1" : "ED25519",
  };
}

/**
 * Derive the on-chain address from a dWallet public key.
 *   EVM   (secp256k1): Ethereum address derivation via ethers.js
 *   Solana (ed25519):  base58 of the 32-byte public key
 */
function deriveChainAddress(
  curve: typeof Curve.SECP256K1 | typeof Curve.ED25519,
  publicKeyBytes: number[],
): string {
  const pubKeyBuffer = Buffer.from(publicKeyBytes);

  if (curve === Curve.SECP256K1) {
    // ethers.computeAddress handles compressed → uncompressed → keccak → last 20 bytes
    return ethers.computeAddress("0x" + pubKeyBuffer.toString("hex"));
  } else {
    return new PublicKey(pubKeyBuffer).toBase58();
  }
}

// ---- Main setup function ----

export async function setupDWallets(): Promise<BridgeState> {
  logger.info("🏗️  Setting up Shared bridge dWallets...");
  logger.info("This will create two Shared dWallets via Ika DKG:");
  logger.info("  1. EVM dWallet  (secp256k1) — signs Ethereum transactions");
  logger.info("  2. Solana dWallet (ed25519) — signs Solana transactions");
  logger.info("");
  logger.info("Shared dWallets allow the bridge relayer to sign automatically");
  logger.info("without needing to decrypt a user share on every transaction.");
  logger.info("");

  const ikaClient = await getIkaClient();
  const suiClient = getSuiClient();

  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("STEP 1/2: Creating EVM Shared dWallet");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const evmDWallet = await createSharedDWalletForChain(
    ikaClient,
    suiClient,
    Curve.SECP256K1,
    "EVM",
  );
  logger.info("");
  logger.info("Waiting 30s for sessions_manager to clear EVM DKG session...");
  await new Promise((r) => setTimeout(r, 30_000));

  logger.info("");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("STEP 2/2: Creating Solana Shared dWallet");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const solanaDWallet = await createSharedDWalletForChain(
    ikaClient,
    suiClient,
    Curve.ED25519,
    "Solana",
  );

  const state: BridgeState = {
    evmDWallet,
    solanaDWallet,
    updatedAt: new Date().toISOString(),
  };

  saveBridgeState(state);

  logger.info("");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.success("🎉 Shared bridge dWallets created successfully!");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("");
  logger.info("NEXT STEPS:");
  logger.info(`  1. Fund EVM bridge vault with ETH:`);
  logger.info(`     Send ETH to: ${evmDWallet.targetChainAddress}`);
  logger.info(`  2. Fund Solana bridge vault with SOL:`);
  logger.info(`     Send SOL to: ${solanaDWallet.targetChainAddress}`);
  logger.info(`  3. Fund SUI bridge pool with SUI:`);
  logger.info(`     Run: pnpm fund`);
  logger.info(`  4. Start the relayer:`);
  logger.info(`     pnpm relayer`);
  logger.info("");

  return state;
}
