// ============================================================
// chains/solana.ts
//
// Solana chain adapter for the bridge.
//
// KEY FIX: Use durable transaction nonces instead of recent blockhashes.
//
// WHY: The Ika MPC signing round takes ~60–90 seconds. Solana blockhashes
// expire after ~150 slots (~60–90s). By the time the signature comes back,
// the blockhash is stale → "Blockhash not found" error.
//
// Durable nonces solve this: the transaction uses a nonce account value
// as its "blockhash". The nonce stays valid until it is advanced, which
// only happens as part of the transaction itself. This makes the transaction
// valid indefinitely — perfect for slow signers.
//
// SETUP: Call `createSolanaNonceAccount` once during bridge setup and store
// the resulting nonce account address in `DWalletInfo.nonceAccountAddress`.
// ============================================================

import {
  Connection,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  NonceAccount,
  Keypair,
  Transaction as LegacyTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config, calculateBridgeOutput } from "../config";
import { BridgeRequest, SolanaDepositEvent } from "../types";
import { signSolanaTransaction } from "../ika/signer";
import { DWalletInfo } from "../types";
import { logger } from "../utils/logger";

// ---- Solana Memo Program ----
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// ---- Connection ----

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(config.solana.rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: config.solana.wsUrl,
    });
  }
  return _connection;
}

// ---- Durable Nonce Helpers ----

/**
 * Create a durable nonce account owned by the bridge dWallet.
 *
 * This is called ONCE during bridge setup. The nonce account is funded from
 * a temporary funder keypair, but its authority is set to the bridge's dWallet
 * pubkey. Only the dWallet can advance (consume) the nonce, which it does as
 * part of every signed transaction.
 *
 * @param funderKeypair - A funded Solana keypair to pay for nonce account creation
 * @param nonceAuthority - The bridge dWallet's public key (will own the nonce)
 * @returns The nonce account public key (save this to bridge-state.json)
 */
export async function createSolanaNonceAccount(
  funderKeypair: Keypair,
  nonceAuthority: PublicKey,
): Promise<PublicKey> {
  const connection = getSolanaConnection();

  // Generate a new keypair for the nonce account itself
  const nonceKeypair = Keypair.generate();

  const rentExemptBalance =
    await connection.getMinimumBalanceForRentExemption(80); // nonce accounts are 80 bytes

  // Use getLatestBlockhash for this setup tx — it's fast (no MPC round),
  // so the blockhash won't expire before we broadcast.
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  // Build the legacy transaction manually and sign it ourselves.
  // We deliberately avoid sendAndConfirmTransaction() here because in Node 18+
  // web3.js detects globalThis.fetch (undici) and switches to ClientBrowser,
  // which fails with "fetch failed". Using sendRawTransaction bypasses that path.
  const createNonceTx = new LegacyTransaction({
    feePayer: funderKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: funderKeypair.publicKey,
      newAccountPubkey: nonceKeypair.publicKey,
      lamports: rentExemptBalance,
      space: 80,
      programId: SystemProgram.programId,
    }),
    SystemProgram.nonceInitialize({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: nonceAuthority,
    }),
  );

  // Both the funder and the new nonce account keypair must sign
  createNonceTx.sign(funderKeypair, nonceKeypair);

  const rawTx = createNonceTx.serialize();
  const sig = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Confirm using blockhash strategy (fine here — this tx is fast)
  const confirmation = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(
      `Nonce account creation tx failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  logger.success("Solana durable nonce account created", {
    nonceAccount: nonceKeypair.publicKey.toBase58(),
    authority: nonceAuthority.toBase58(),
    fundingTx: sig,
  });

  return nonceKeypair.publicKey;
}

/**
 * Read the current nonce value from a nonce account.
 */
async function getNonceValue(
  connection: Connection,
  nonceAccountPubkey: PublicKey,
): Promise<string> {
  const accountInfo = await connection.getAccountInfo(nonceAccountPubkey);
  if (!accountInfo) {
    throw new Error(
      `Nonce account ${nonceAccountPubkey.toBase58()} not found on chain.\n` +
        `Run createSolanaNonceAccount() during bridge setup to create it.`,
    );
  }

  const nonceAccount = NonceAccount.fromAccountData(accountInfo.data);
  return nonceAccount.nonce;
}

// ---- Send SOL via dWallet (with Durable Nonce) ----

/**
 * Send SOL from the bridge's dWallet to a recipient.
 *
 * Uses a durable nonce so the transaction remains valid during the full
 * MPC signing round (~60–90s). Without this, Solana's rolling blockhash
 * expires before the signature is returned.
 *
 * Transaction structure:
 *   1. AdvanceNonceAccount  ← consumes the nonce, signed by dWallet
 *   2. SystemProgram.transfer ← the actual SOL transfer, signed by dWallet
 *
 * Both instructions are covered by the single ed25519 signature from Ika.
 *
 * @param to - Recipient Solana address (base58)
 * @param amountLamports - Amount in lamports
 * @param dWalletInfo - The Solana dWallet (must have nonceAccountAddress set)
 * @returns Transaction signature (base58)
 */
export async function sendSolViaDWallet(
  to: string,
  amountLamports: bigint,
  dWalletInfo: DWalletInfo,
): Promise<string> {
  const connection = getSolanaConnection();
  const bridgePubkey = new PublicKey(dWalletInfo.targetChainAddress);
  const recipientPubkey = new PublicKey(to);

  logger.info("Sending SOL via dWallet...", {
    from: dWalletInfo.targetChainAddress,
    to,
    solAmount: (Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(6),
  });

  // Validate recipient address
  if (!PublicKey.isOnCurve(recipientPubkey.toBytes())) {
    throw new Error(`Invalid Solana recipient address: ${to}`);
  }

  // Require a nonce account to be configured
  if (!dWalletInfo.nonceAccountAddress) {
    throw new Error(
      `dWalletInfo.nonceAccountAddress is not set.\n` +
        `Run createSolanaNonceAccount() during bridge setup and save the result.\n` +
        `This is required because Ika MPC signing takes longer than a Solana blockhash TTL.`,
    );
  }

  const nonceAccountPubkey = new PublicKey(dWalletInfo.nonceAccountAddress);

  // Check vault balance
  const balance = await connection.getBalance(bridgePubkey);
  const rentExemptMin = await connection.getMinimumBalanceForRentExemption(0);
  if (BigInt(balance) < amountLamports + BigInt(rentExemptMin) + 5000n) {
    throw new Error(
      `Solana bridge vault has insufficient balance!\n` +
        `Available: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
        `Required:  ${(Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL + fees`,
    );
  }

  // ── Read the current nonce value BEFORE signing ──────────────────────────
  // This is the value we embed in the transaction as the "recentBlockhash".
  // It stays valid until THIS transaction (or another) advances the nonce.
  const nonceValue = await getNonceValue(connection, nonceAccountPubkey);
  logger.debug("Using durable nonce for transaction", {
    nonceAccount: dWalletInfo.nonceAccountAddress,
    nonce: nonceValue,
  });

  // ── Build the transaction message ────────────────────────────────────────
  // Rule: AdvanceNonceAccount MUST be the first instruction when using durable nonces.
  const advanceNonceInstruction = SystemProgram.nonceAdvance({
    noncePubkey: nonceAccountPubkey,
    authorizedPubkey: bridgePubkey, // dWallet is the nonce authority
  });

  const transferInstruction = SystemProgram.transfer({
    fromPubkey: bridgePubkey,
    toPubkey: recipientPubkey,
    lamports: amountLamports,
  });

  const message = new TransactionMessage({
    payerKey: bridgePubkey,
    recentBlockhash: nonceValue, // ← nonce value, not a recent blockhash
    instructions: [advanceNonceInstruction, transferInstruction],
  }).compileToV0Message();

  const messageBytes = message.serialize();

  logger.debug("Durable nonce tx details", {
    messageLength: messageBytes.length,
    nonce: nonceValue,
    nonceAccount: dWalletInfo.nonceAccountAddress,
  });

  // ── Sign via Ika MPC (takes ~60–90s — nonce keeps the tx valid) ──────────
  const { signature } = await signSolanaTransaction({
    txMessageBytes: messageBytes,
    dWalletInfo,
  });

  // ── Assemble and broadcast ───────────────────────────────────────────────
  const versionedTx = new VersionedTransaction(message);
  versionedTx.addSignature(bridgePubkey, signature);

  logger.info("Broadcasting SOL transaction to Solana network...");
  const rawTx = versionedTx.serialize();

  const txSignature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  logger.success("SOL transaction broadcast!", {
    signature: txSignature,
    to,
    solAmount: (Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(6),
  });

  // ── Confirm ──────────────────────────────────────────────────────────────
  // For durable nonce transactions, confirmTransaction requires the
  // 'nonceAccountPubkey + nonceValue' form instead of blockhash + lastValidBlockHeight.
  const confirmation = await connection.confirmTransaction(
    {
      nonceAccountPubkey,
      nonceValue,
      minContextSlot: 0,
      signature: txSignature,
    },
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(
      `Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  logger.success("SOL transaction confirmed!", { signature: txSignature });
  return txSignature;
}

// ---- Detect SOL deposits ----

export async function detectSolanaDeposits(
  bridgeAddress: string,
  lastSignature?: string,
): Promise<SolanaDepositEvent[]> {
  const connection = getSolanaConnection();
  const bridgePubkey = new PublicKey(bridgeAddress);
  const deposits: SolanaDepositEvent[] = [];

  logger.debug("Checking for Solana deposits...", {
    bridgeAddress,
    afterSignature: lastSignature,
  });

  const signatures = await connection.getSignaturesForAddress(bridgePubkey, {
    until: lastSignature,
    limit: 50,
  });

  if (signatures.length === 0) {
    logger.debug("No new Solana transactions found");
    return [];
  }

  // ── Fetch transactions individually instead of as a batch ────────────────
  // getParsedTransactions() sends a batch RPC request, which Helius free tier
  // blocks with 403. Individual getParsedTransaction() calls avoid this entirely.
  for (const sig of signatures) {
    let tx;
    try {
      tx = await connection.getParsedTransaction(sig.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (err) {
      logger.warn("Failed to fetch transaction, skipping", {
        signature: sig.signature,
        err,
      });
      continue;
    }

    if (!tx || tx.meta?.err) continue;

    const accountKeys = tx.transaction.message.accountKeys;
    const bridgeIndex = accountKeys.findIndex(
      (k) => k.pubkey.toString() === bridgeAddress,
    );

    if (bridgeIndex === -1) continue;

    // Ignore transactions where the vault is the fee payer — these are the
    // relayer's own outbound transfers (nonce advance + SOL send). The fee
    // payer is always accountKeys[0] in a compiled Solana message.
    const feePayer = accountKeys[0]?.pubkey.toString();
    if (feePayer === bridgeAddress) continue;

    const preBalance = tx.meta?.preBalances[bridgeIndex] ?? 0;
    const postBalance = tx.meta?.postBalances[bridgeIndex] ?? 0;
    const receivedLamports = BigInt(postBalance) - BigInt(preBalance);

    if (receivedLamports <= 0n) continue;

    if (receivedLamports < config.bridge.minAmountSol) {
      logger.warn("SOL deposit below minimum", {
        signature: sig.signature,
        lamports: receivedLamports.toString(),
        minLamports: config.bridge.minAmountSol.toString(), // now visible in logs
      });
      continue;
    }

    if (receivedLamports > config.bridge.maxAmountSol) {
      logger.warn("SOL deposit above maximum — skipping", {
        signature: sig.signature,
        lamports: receivedLamports.toString(),
        maxLamports: config.bridge.maxAmountSol.toString(),
      });
      continue;
    }

    let suiRecipient = "";
    const instructions = tx.transaction.message.instructions;
    for (const instruction of instructions) {
      if (
        "parsed" in instruction &&
        instruction.program === "spl-memo" &&
        typeof instruction.parsed === "string"
      ) {
        const memo = instruction.parsed;
        if (memo.startsWith("sui:0x")) {
          suiRecipient = memo.slice(4);
          break;
        }
      }
    }

    if (!suiRecipient) {
      logger.warn("SOL deposit missing SUI recipient memo", {
        signature: sig.signature,
        lamports: receivedLamports.toString(),
      });
      continue;
    }

    const senderIndex = accountKeys.findIndex((_, idx) => {
      const pre = tx.meta?.preBalances[idx] ?? 0;
      const post = tx.meta?.postBalances[idx] ?? 0;
      return BigInt(pre) > BigInt(post) && idx !== bridgeIndex;
    });

    const from =
      senderIndex !== -1
        ? accountKeys[senderIndex].pubkey.toString()
        : "unknown";

    deposits.push({
      signature: sig.signature,
      from,
      amountLamports: receivedLamports,
      suiRecipient,
      slot: sig.slot,
    });

    logger.bridge(
      "SOL → SUI",
      `${(Number(receivedLamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      from,
      suiRecipient,
    );
  }

  return deposits;
}

// solanaDepositToBridgeRequest — pass GROSS mist, contract takes fee
export function solanaDepositToBridgeRequest(
  event: SolanaDepositEvent,
  suiRate: bigint,
): BridgeRequest {
  // Gross MIST equivalent of the deposited SOL.
  // Fee is NOT deducted here — release_sui() on the contract takes it.
  const grossAmountMist = (event.amountLamports * 1_000_000_000n) / suiRate;

  return {
    id: `sol-${event.signature}`,
    sourceChain: "solana",
    destChain: "sui",
    senderAddress: event.from,
    recipientAddress: event.suiRecipient,
    amountIn: event.amountLamports,
    amountOut: grossAmountMist, // gross — contract takes fee on release
    sourceTxHash: event.signature,
    status: "pending",
    createdAt: Date.now(),
  };
}

export async function getSolBalance(address: string): Promise<bigint> {
  const connection = getSolanaConnection();
  const pubkey = new PublicKey(address);
  const balance = await connection.getBalance(pubkey);
  return BigInt(balance);
}

export function encodeBridgeMemo(suiAddress: string): string {
  return `sui:${suiAddress}`;
}

export function createMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });
}
