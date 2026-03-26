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

const MIN_IKA_FOR_OPERATION = 10_000_000n;

async function fetchFirstCoin(
  suiClient: ReturnType<typeof getSuiClient>,
  owner: string,
  coinType: string,
  label: string,
): Promise<string> {
  const { data } = await suiClient.getCoins({ owner, coinType });

  if (!data.length) {
    throw new Error(
      `Signer wallet has no ${label} coins at ${owner}.\n` +
        `Fund the wallet before signing.`,
    );
  }

  const sorted = [...data].sort((a, b) =>
    Number(BigInt(b.balance) - BigInt(a.balance)),
  );

  const best = sorted[0];

  if (BigInt(best.balance) < MIN_IKA_FOR_OPERATION) {
    throw new Error(
      `Signer wallet ${label} balance is too low to pay protocol fees.\n` +
        `Best coin balance: ${best.balance}\n` +
        `Required minimum: ${MIN_IKA_FOR_OPERATION}\n` +
        `Owner: ${owner}\n` +
        `Fund the wallet with more ${label} before signing.`,
    );
  }

  logger.debug(`Using ${label} coin for fee`, {
    coinObjectId: best.coinObjectId,
    balance: best.balance,
  });

  return best.coinObjectId;
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
  // Check BOTH SUI gas and IKA fees before touching anything on-chain.
  // If this throws, NO session is opened. BullMQ retries safely.
  // We check for enough to cover BOTH the presign tx AND the sign tx.
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

  // 0.3 SUI covers presign tx + sign tx gas with margin
  const MIN_SUI_FOR_SIGNING = 300_000_000n;
  // Need enough IKA for presign fee AND sign fee
  const MIN_IKA_FOR_SIGNING = MIN_IKA_FOR_OPERATION * 2n;

  if (suiAvailable < MIN_SUI_FOR_SIGNING) {
    throw new Error(
      `PREFLIGHT FAILED: Insufficient SUI for signing.\n` +
        `Available: ${suiAvailable} MIST (${Number(suiAvailable) / 1e9} SUI)\n` +
        `Required:  ${MIN_SUI_FOR_SIGNING} MIST (${Number(MIN_SUI_FOR_SIGNING) / 1e9} SUI)\n` +
        `Fund ${signerAddress} then retry. No session was opened.`,
    );
  }

  if (ikaAvailable < MIN_IKA_FOR_SIGNING) {
    throw new Error(
      `PREFLIGHT FAILED: Insufficient IKA for protocol fees.\n` +
        `Available: ${ikaAvailable}\n` +
        `Required:  ${MIN_IKA_FOR_SIGNING}\n` +
        `Fund ${signerAddress} with IKA then retry. No session was opened.`,
    );
  }

  logger.debug("Preflight passed", {
    suiAvailable: suiAvailable.toString(),
    ikaAvailable: ikaAvailable.toString(),
  });

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

  const dWalletEncryptionKey = await ikaClient.getDWalletNetworkEncryptionKey(
    dWalletInfo.dWalletId,
  );

  let presign: Awaited<
    ReturnType<typeof ikaClient.getPresignInParticularState>
  > | null = null;

  logger.debug("Checking for existing completed presign...", {
    dWalletId: dWalletInfo.dWalletId,
  });

  try {
    presign = await ikaClient.getPresignInParticularState(
      dWalletInfo.dWalletId, // querying by dWalletId, not presignId
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

  if (!presign) {
    logger.debug("Requesting global presign from Ika network...");

    const ikaCoinIdForPresign = await fetchFirstCoin(
      suiClient,
      signerAddress,
      IKA_COIN_TYPE,
      "IKA",
    );

    const presignTx = new Transaction();
    const presignIkaTx = new IkaTransaction({
      ikaClient,
      transaction: presignTx,
      userShareEncryptionKeys,
    });

    const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
      curve,
      signatureAlgorithm,
      ikaCoin: presignTx.object(ikaCoinIdForPresign),
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
    presign = await ikaClient.getPresignInParticularState(
      presignId,
      "Completed",
      {
        timeout: 90_000, // increased from 60s — more margin for epoch transitions
        interval: 2_000,
      },
    );
  }

  const MAX_SIGN_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_SIGN_RETRIES; attempt++) {
    try {
      logger.debug(
        `Requesting signature from Ika network (attempt ${attempt})...`,
      );

      const ikaCoinIdForSign = await fetchFirstCoin(
        suiClient,
        signerAddress,
        IKA_COIN_TYPE,
        "IKA",
      );

      const signTx = new Transaction();
      const signIkaTx = new IkaTransaction({
        ikaClient,
        transaction: signTx,
        userShareEncryptionKeys,
      });

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
        ikaCoin: signTx.object(ikaCoinIdForSign),
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
        { timeout: 90_000, interval: 2_000 }, // increased from 60s
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
      const isSessionConflict =
        err?.message?.includes("sessions_manager") ||
        err?.message?.includes("initiate_user_session");

      const isTimeout =
        err?.message?.toLowerCase().includes("timeout") ||
        err?.message?.includes("not found");

      if ((isSessionConflict || isTimeout) && attempt < MAX_SIGN_RETRIES) {
        const waitMs = 30_000 * attempt;
        logger.warn(
          `Sign attempt ${attempt} failed (session conflict or timeout) — waiting ${waitMs / 1000}s before retry`,
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
