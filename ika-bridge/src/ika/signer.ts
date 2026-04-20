// Bridge signing engine using Shared dWallets.

import {
  IkaTransaction,
  UserShareEncryptionKeys,
  Curve,
  SignatureAlgorithm,
  Hash,
  type SharedDWallet,
} from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import type { TransactionObjectArgument } from "@mysten/sui/transactions";

import { DWalletInfo } from "../types";
import { config } from "../config";
import { getIkaClient, getSuiClient } from "./client";
import {
  executeTransaction,
  loadSuiKeypair,
  getAddress,
} from "../utils/executeTransaction";
import { logger } from "../utils/logger";

const IKA_COIN_TYPE =
  "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA";

export interface SignEvmTxParams {
  rawTxBytes: Uint8Array;
  dWalletInfo: DWalletInfo;
}

export interface SignSolanaTxParams {
  txMessageBytes: Uint8Array;
  dWalletInfo: DWalletInfo;
}

export interface SignResult {
  signature: Uint8Array;
}

// Actual on-chain fees (IKA MIST) sourced from coordinator pricing_and_fee_manager.
// protocol=5 (PRESIGN), protocol=6 (SIGN).
// Solana/EdDSA: presign=120M, sign=40M.
// EVM/ECDSA:    presign=250M, sign=100M.
// Using EVM ceiling so one constant covers both chains safely.
const PRESIGN_FEE_IKA = 300_000_000n; // > 250M EVM presign
const SIGN_FEE_IKA = 120_000_000n; // > 100M EVM sign
const MIN_IKA_FOR_ONE_SIGNING = PRESIGN_FEE_IKA + SIGN_FEE_IKA; // 420M total

/**
 * Fetch all IKA coins, merge any extras into the primary coin within the given
 * transaction (so Move sees the combined balance at dry-run), and return a
 * transaction argument pointing to the primary coin.
 *
 * Root cause of "sessions_manager::initiate_user_session, 1":
 *   abort code 1 = EInsufficientIKAPayment.
 *   After each successful signing the coin is split by the protocol fee, leaving
 *   the next attempt with a single coin whose balance is below the presign fee.
 *   Merging all coins before each tx ensures the Move check always passes.
 */
async function prepareIkaCoin(
  suiClient: ReturnType<typeof getSuiClient>,
  tx: Transaction,
  owner: string,
  minRequired: bigint,
): Promise<TransactionObjectArgument> {
  const { data } = await suiClient.getCoins({ owner, coinType: IKA_COIN_TYPE });

  if (!data.length) {
    throw new Error(
      `Signer wallet has no IKA coins at ${owner}.\n` +
        `Get testnet IKA from the Ika faucet before signing.`,
    );
  }

  const total = data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total < minRequired) {
    throw new Error(
      `Insufficient IKA for protocol fees.\n` +
        `Total IKA available: ${total}\n` +
        `Required: ${minRequired}\n` +
        `Owner: ${owner}\n` +
        `Get more IKA from the testnet faucet then retry.`,
    );
  }

  // Highest-balance first so primary coin starts with the largest share.
  const sorted = [...data].sort((a, b) =>
    Number(BigInt(b.balance) - BigInt(a.balance)),
  );

  const primaryArg = tx.object(sorted[0].coinObjectId);

  // Merge all remaining coins into the primary within this tx.
  // The Move dry-run sees the full combined balance.
  if (sorted.length > 1) {
    const extras = sorted.slice(1).map((c) => tx.object(c.coinObjectId));
    tx.mergeCoins(primaryArg, extras);
    logger.debug("Merging IKA coins for protocol fee", {
      count: sorted.length,
      total: total.toString(),
    });
  }

  return primaryArg;
}

type BridgeSignatureAlgorithm =
  | typeof SignatureAlgorithm.ECDSASecp256k1
  | typeof SignatureAlgorithm.EdDSA;

async function signWithSharedDWallet(
  dWalletInfo: DWalletInfo,
  curve: typeof Curve.SECP256K1 | typeof Curve.ED25519,
  signatureAlgorithm: BridgeSignatureAlgorithm,
  hashScheme: typeof Hash.KECCAK256 | typeof Hash.SHA512,
  messageBytes: Uint8Array,
): Promise<Uint8Array> {
  const ikaClient = await getIkaClient();
  const suiClient = getSuiClient();
  const keypair = loadSuiKeypair(config.ika.suiPrivateKey);
  const signerAddress = getAddress(keypair);

  const chainLabel = curve === Curve.SECP256K1 ? "EVM" : "Solana";
  const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    new TextEncoder().encode(config.ika.bridgeSeed + ":" + chainLabel),
    curve,
  );

  // ── LAYER 1: PREFLIGHT CHECK ─────────────────────────────────────────────
  // Check balances before touching anything on-chain so BullMQ retries are safe.
  logger.debug("Running preflight balance checks...", { signerAddress });

  const [suiBalance, ikaCoins] = await Promise.all([
    suiClient.getBalance({ owner: signerAddress, coinType: "0x2::sui::SUI" }),
    suiClient.getCoins({ owner: signerAddress, coinType: IKA_COIN_TYPE }),
  ]);

  const suiAvailable = BigInt(suiBalance.totalBalance);
  const ikaAvailable = ikaCoins.data.reduce(
    (sum, c) => sum + BigInt(c.balance),
    0n,
  );

  // 0.3 SUI covers presign tx + sign tx gas with margin.
  const MIN_SUI_FOR_SIGNING = 300_000_000n;

  if (suiAvailable < MIN_SUI_FOR_SIGNING) {
    throw new Error(
      `PREFLIGHT FAILED: Insufficient SUI for signing.\n` +
        `Available: ${suiAvailable} MIST (${Number(suiAvailable) / 1e9} SUI)\n` +
        `Required:  ${MIN_SUI_FOR_SIGNING} MIST (${Number(MIN_SUI_FOR_SIGNING) / 1e9} SUI)\n` +
        `Fund ${signerAddress} then retry. No session was opened.`,
    );
  }

  if (ikaAvailable < MIN_IKA_FOR_ONE_SIGNING) {
    throw new Error(
      `PREFLIGHT FAILED: Insufficient IKA for protocol fees.\n` +
        `Total IKA available: ${ikaAvailable}\n` +
        `Required (presign + sign): ${MIN_IKA_FOR_ONE_SIGNING}\n` +
        `Fund ${signerAddress} with IKA from the testnet faucet. No session was opened.`,
    );
  }

  logger.debug("Preflight passed", {
    suiAvailable: suiAvailable.toString(),
    ikaAvailable: ikaAvailable.toString(),
  });

  // ── Fetch dWallet ────────────────────────────────────────────────────────
  logger.debug("Fetching Shared dWallet from Ika...");
  const dWallet = (await ikaClient.getDWalletInParticularState(
    dWalletInfo.dWalletId,
    "Active",
    { timeout: 30_000, interval: 1_000 },
  )) as SharedDWallet;

  if (!dWallet.public_user_secret_key_share) {
    throw new Error(
      `dWallet ${dWalletInfo.dWalletId} is not a Shared dWallet. ` +
        `Run pnpm setup to recreate dWallets as Shared.`,
    );
  }

  const dWalletEncryptionKey = await ikaClient.getLatestNetworkEncryptionKey();

  // ── LAYER 2: PRESIGN IDEMPOTENCY CHECK ───────────────────────────────────
  // Recover an already-completed presign if the server crashed between presign
  // and sign (avoids opening a second session after a partial failure).
  let presign: Awaited<
    ReturnType<typeof ikaClient.getPresignInParticularState>
  > | null = null;

  logger.debug("Checking for existing completed presign...", {
    dWalletId: dWalletInfo.dWalletId,
  });

  try {
    presign = await ikaClient.getPresignInParticularState(
      dWalletInfo.dWalletId,
      "Completed",
      { timeout: 5_000, interval: 1_000 },
    );
    logger.warn(
      "Found existing completed presign — recovering from previous incomplete signing attempt",
      { dWalletId: dWalletInfo.dWalletId },
    );
  } catch {
    presign = null;
    logger.debug("No existing presign found — will create a new one");
  }

  // ── Request presign ───────────────────────────────────────────────────────
  if (!presign) {
    logger.debug("Requesting global presign from Ika network...");

    const presignTx = new Transaction();
    const presignIkaTx = new IkaTransaction({
      ikaClient,
      transaction: presignTx,
      userShareEncryptionKeys,
    });

    // Merge all IKA coins into one within this tx so the Move fee check passes
    // even when prior signings have split the coin below the presign threshold.
    const presignIkaCoin = await prepareIkaCoin(
      suiClient,
      presignTx,
      signerAddress,
      PRESIGN_FEE_IKA,
    );

    const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
      curve,
      signatureAlgorithm,
      ikaCoin: presignIkaCoin,
      suiCoin: presignTx.gas,
      dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    });

    presignTx.transferObjects([unverifiedPresignCap], signerAddress);

    const presignTxResult = await executeTransaction(
      suiClient,
      presignTx,
      keypair,
      false,
    );

    const presignEvent = presignTxResult.events?.find((e) =>
      e.type.includes("PresignRequestEvent"),
    );
    if (!presignEvent) {
      throw new Error(
        "PresignRequestEvent not found in presign transaction events.\n" +
          `Events: ${JSON.stringify(presignTxResult.events, null, 2)}`,
      );
    }

    const presignEventData = presignEvent.parsedJson as any;
    const presignId: string =
      presignEventData?.presign_id ?? presignEventData?.event_data?.presign_id;

    if (!presignId) {
      throw new Error(
        `Could not extract presign_id from PresignRequestEvent.\n` +
          `Event data: ${JSON.stringify(presignEventData, null, 2)}`,
      );
    }

    logger.debug("Waiting for presign to complete...", { presignId });
    presign = await ikaClient.getPresignInParticularState(presignId, "Completed", {
      timeout: 90_000,
      interval: 2_000,
    });
  }

  // ── LAYER 3: SIGN WITH RETRY ─────────────────────────────────────────────
  const MAX_SIGN_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_SIGN_RETRIES; attempt++) {
    try {
      logger.debug(`Requesting signature from Ika network (attempt ${attempt})...`);

      const signTx = new Transaction();
      const signIkaTx = new IkaTransaction({
        ikaClient,
        transaction: signTx,
        userShareEncryptionKeys,
      });

      // Merge coins again for the sign tx — the presign already split some IKA off.
      const signIkaCoin = await prepareIkaCoin(
        suiClient,
        signTx,
        signerAddress,
        SIGN_FEE_IKA,
      );

      const messageApproval = signIkaTx.approveMessage({
        message: messageBytes,
        curve,
        dWalletCap: dWallet.dwallet_cap_id,
        signatureAlgorithm,
        hashScheme,
      });

      const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign });

      await signIkaTx.requestSign({
        dWallet,
        messageApproval,
        hashScheme,
        verifiedPresignCap,
        presign,
        message: messageBytes,
        signatureScheme: signatureAlgorithm,
        ikaCoin: signIkaCoin,
        suiCoin: signTx.gas,
      });

      const signTxResult = await executeTransaction(
        suiClient,
        signTx,
        keypair,
        false,
      );

      const signEvent = signTxResult.events?.find((e) =>
        e.type.includes("SignRequestEvent"),
      );
      if (!signEvent) {
        throw new Error(
          "SignRequestEvent not found in sign transaction events.\n" +
            `Events: ${JSON.stringify(signTxResult.events, null, 2)}`,
        );
      }

      const signEventData = signEvent.parsedJson as any;
      const signSessionId: string =
        signEventData?.sign_id ?? signEventData?.event_data?.sign_id;

      if (!signSessionId) {
        throw new Error(
          `Could not extract sign_id from SignRequestEvent.\n` +
            `Event data: ${JSON.stringify(signEventData, null, 2)}`,
        );
      }

      logger.debug("Waiting for Ika network to complete signing...", {
        signSessionId,
      });

      const completedSign = await ikaClient.getSignInParticularState(
        signSessionId,
        curve,
        signatureAlgorithm,
        "Completed",
        { timeout: 90_000, interval: 2_000 },
      );

      const signature = completedSign.state?.Completed?.signature;
      if (!signature) {
        throw new Error(
          `Signature not found in completed sign session ${signSessionId}.\n` +
            `State: ${JSON.stringify(completedSign.state, null, 2)}`,
        );
      }

      logger.success("Signature obtained from Ika MPC network ✓", {
        signatureLength: signature.length,
        signSessionId,
      });

      return new Uint8Array(signature);
    } catch (err: any) {
      const isTimeout =
        err?.message?.toLowerCase().includes("timeout") ||
        err?.message?.includes("not found");

      if (isTimeout && attempt < MAX_SIGN_RETRIES) {
        const waitMs = 30_000 * attempt;
        logger.warn(
          `Sign attempt ${attempt} timed out — waiting ${waitMs / 1000}s before retry`,
          { error: err.message, attempt },
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      throw err;
    }
  }

  throw new Error("All sign retries exhausted");
}

export async function signEvmTransaction(
  params: SignEvmTxParams,
): Promise<SignResult> {
  logger.info("Signing EVM transaction via Shared dWallet...");
  const signature = await signWithSharedDWallet(
    params.dWalletInfo,
    Curve.SECP256K1,
    SignatureAlgorithm.ECDSASecp256k1,
    Hash.KECCAK256,
    params.rawTxBytes,
  );
  return { signature };
}

export async function signSolanaTransaction(
  params: SignSolanaTxParams,
): Promise<SignResult> {
  logger.info("Signing Solana transaction via Shared dWallet...");
  const signature = await signWithSharedDWallet(
    params.dWalletInfo,
    Curve.ED25519,
    SignatureAlgorithm.EdDSA,
    Hash.SHA512,
    params.txMessageBytes,
  );
  return { signature };
}
