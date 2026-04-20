// ============================================================
// chains/evm.ts
//
// Ethereum/EVM chain adapter for the bridge.
//
// Changes vs original (proactive fixes for untested code paths):
//
// 1. sendEthViaDWallet -- legacy gasPrice tx, which works on Sepolia.
//    v recovery loop correctly tries 27/28 (normalised recovery bits);
//    ethers v6 encodes the final EIP-155 v (chainId*2+35/36) automatically
//    when you pass v:27|28 inside a Transaction with a chainId set.
//    No change needed there, but added an explicit error hint.
//
// 2. detectEvmDeposits -- added a guard: skip if tx.data length is wrong
//    before calling toUtf8String (avoids crash on malformed data).
//    Also skips txs where the vault is the sender (relayer's own outbound
//    transfers) -- mirrors the same guard in chains/solana.ts.
//
// 3. getEvmBlockNumber -- exported so scripts can snapshot the block
//    before locking SUI, enabling delivery tx scanning in bridge-sui-to-eth.
// ============================================================

import { ethers } from "ethers";
import { config } from "../config";
import { BridgeRequest, EvmDepositEvent } from "../types";
import { signEvmTransaction } from "../ika/signer";
import { DWalletInfo } from "../types";
import { logger } from "../utils/logger";

// ---- Provider ----

let _provider: ethers.JsonRpcProvider | null = null;

export function getEvmProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.evm.rpcUrl, {
      chainId: config.evm.chainId,
      name: "ika-bridge-evm",
    });
  }
  return _provider;
}

// ---- Send ETH via dWallet ----

/**
 * Send ETH from the bridge's Shared dWallet to a recipient.
 *
 * Signing notes:
 *   - We pass RAW unsigned serialized tx bytes to Ika (NOT the keccak256 hash).
 *     Ika uses Hash.KECCAK256, so it hashes them internally, producing
 *     keccak256(unsignedTx). Ethereum's ecrecover expects exactly that.
 *     Passing pre-hashed bytes would cause double-hashing and a wrong signer.
 *
 *   - After Ika returns (r, s), we try recovery bit 27 then 28 to find the v
 *     that recovers back to the bridge address. ethers v6 then re-encodes v
 *     as the correct EIP-155 value (chainId*2 + 35 + recovery_bit) when
 *     serialising the signed transaction. This is handled automatically by
 *     Transaction.from({ ...txData, signature: { r, s, v } }) when chainId
 *     is present in txData.
 */
export async function sendEthViaDWallet(
  to: string,
  amountWei: bigint,
  dWalletInfo: DWalletInfo,
): Promise<string> {
  const provider = getEvmProvider();
  const bridgeAddress = dWalletInfo.targetChainAddress;

  logger.info("Sending ETH via Shared dWallet...", {
    from: bridgeAddress,
    to,
    ethAmount: ethers.formatEther(amountWei),
  });

  // Validate recipient
  if (!ethers.isAddress(to)) {
    throw new Error(`Invalid Ethereum recipient address: ${to}`);
  }

  // Build the unsigned transaction
  const nonce = await provider.getTransactionCount(bridgeAddress);
  const feeData = await provider.getFeeData();
  const gasLimit = 21000n;

  // EIP-1559 — more reliable under congestion than legacy gasPrice.
  // maxFeePerGas = baseFee + maxPriorityFeePerGas (tip).
  // We add a 20% buffer on the base fee so the tx doesn't get stuck.
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");

  const maxFeePerGas = feeData.maxFeePerGas
    ? (feeData.maxFeePerGas * 120n) / 100n // +20% buffer on suggested fee
    : ethers.parseUnits("50", "gwei"); // safe fallback

  const txData: ethers.TransactionLike = {
    type: 2, // ← EIP-1559
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
    to,
    value: amountWei,
    data: "0x",
    chainId: config.evm.chainId,
  };

  // Check vault balance before opening a signing session.
  const vaultBalance = await provider.getBalance(bridgeAddress);
  const gasCost = maxFeePerGas * gasLimit;
  if (vaultBalance < amountWei + gasCost) {
    throw new Error(
      `EVM bridge vault has insufficient balance!\n` +
        `Available: ${ethers.formatEther(vaultBalance)} ETH\n` +
        `Required:  ${ethers.formatEther(amountWei + gasCost)} ETH (amount + gas)`,
    );
  }

  const unsignedTx = ethers.Transaction.from(txData);

  // Pass RAW serialized bytes to Ika -- Ika applies KECCAK256 internally.
  const rawTxBytes = ethers.getBytes(unsignedTx.unsignedSerialized);

  // Compute hash separately so we can recover v below.
  const txHash = ethers.keccak256(unsignedTx.unsignedSerialized);

  logger.debug("Requesting EVM transaction signature from Ika dWallet...", {
    txHash,
    nonce,
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  });

  const { signature } = await signEvmTransaction({
    rawTxBytes,
    dWalletInfo,
  });

  // Parse the ECDSA signature (r + s = 64 bytes from Ika)
  const r = "0x" + Buffer.from(signature.slice(0, 32)).toString("hex");
  const s = "0x" + Buffer.from(signature.slice(32, 64)).toString("hex");

  // Recover v (27 or 28) by trying both and seeing which gives back the bridge address.
  // ethers v6 will then convert this to the correct EIP-155 v when serialising.
  let v: number | null = null;
  for (const candidate of [27, 28]) {
    try {
      const recovered = ethers.recoverAddress(txHash, { r, s, v: candidate });
      if (recovered.toLowerCase() === bridgeAddress.toLowerCase()) {
        v = candidate;
        break;
      }
    } catch {
      // Try the other candidate
    }
  }

  if (v === null) {
    throw new Error(
      "Could not recover v value from signature — public key mismatch?\n" +
        `Bridge dWallet address: ${bridgeAddress}\n` +
        "Ensure the dWallet was created with Curve.SECP256K1 and the " +
        "targetChainAddress matches ethers.computeAddress() of its public key.",
    );
  }

  const signedTx = ethers.Transaction.from({
    ...txData,
    signature: { r, s, v },
  });

  logger.info("Broadcasting ETH transaction to EVM network...");
  const txResponse = await provider.broadcastTransaction(signedTx.serialized);

  logger.success("ETH transaction broadcast!", {
    txHash: txResponse.hash,
    to,
    ethAmount: ethers.formatEther(amountWei),
  });

  const receipt = await txResponse.wait(config.evm.confirmations);
  if (!receipt || receipt.status === 0) {
    throw new Error(`EVM transaction failed: ${txResponse.hash}`);
  }

  logger.success("ETH transaction confirmed!", {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });

  return receipt.hash;
}

// ---- Detect ETH deposits ----

/**
 * Scan a block range for ETH deposits to the bridge address.
 *
 * Each block is fetched with prefetched transactions (one RPC call per block).
 * For each tx that sends ETH to the bridge vault, we decode the data field to
 * find the SUI recipient address (encoded as hex-encoded UTF-8 by the sender).
 *
 * Guards:
 *  - Skips txs where the vault itself is the sender (relayer's own outbound
 *    transfers -- nonce advance + ETH send). Without this the relayer would
 *    try to process its own deliveries as new deposits.
 *  - Skips txs whose data decodes to a string that isn't a valid Sui address
 *    (66 chars, starts with 0x).
 *  - Skips txs whose ETH value is below the configured minimum.
 */
export async function detectEvmDeposits(
  bridgeAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<EvmDepositEvent[]> {
  const provider = getEvmProvider();
  const deposits: EvmDepositEvent[] = [];

  logger.debug(`Scanning EVM blocks ${fromBlock}-${toBlock} for deposits...`);

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    const block = await provider.getBlock(blockNum, true);
    if (!block) continue;

    for (const tx of block.prefetchedTransactions) {
      // Only care about txs sent TO the bridge vault
      if (tx.to?.toLowerCase() !== bridgeAddress.toLowerCase()) continue;

      // Skip zero-value txs
      if (tx.value === 0n) continue;

      // Skip txs where the vault is the sender -- these are the relayer's own
      // outbound ETH transfers (signing + broadcast loop). Processing them
      // would create a phantom deposit loop.
      if (tx.from.toLowerCase() === bridgeAddress.toLowerCase()) continue;

      // Decode the data field to extract the SUI recipient address.
      // encodeSuiRecipient() = ethers.hexlify(ethers.toUtf8Bytes(suiAddress))
      // so we reverse with toUtf8String.
      let suiRecipient = "";
      try {
        if (!tx.data || tx.data === "0x" || tx.data.length <= 2) {
          logger.warn("ETH deposit missing SUI recipient in tx data field", {
            txHash: tx.hash,
            from: tx.from,
            value: ethers.formatEther(tx.value),
          });
          continue;
        }

        const decoded = ethers.toUtf8String(tx.data);

        if (!decoded.startsWith("0x") || decoded.length !== 66) {
          logger.warn(
            "ETH deposit has invalid SUI recipient in tx data field",
            {
              txHash: tx.hash,
              decoded,
              expectedFormat: "0x + 64 hex chars (Sui address)",
            },
          );
          continue;
        }

        suiRecipient = decoded;
      } catch {
        logger.warn("Could not decode SUI recipient from tx data field", {
          txHash: tx.hash,
          data: tx.data,
        });
        continue;
      }

      // Enforce minimum deposit amount
      if (tx.value < config.bridge.minAmountEth) {
        logger.warn("ETH deposit below minimum", {
          txHash: tx.hash,
          amount: ethers.formatEther(tx.value),
          minimum: ethers.formatEther(config.bridge.minAmountEth),
        });
        continue;
      }

      if (tx.value > config.bridge.maxAmountEth) {
        logger.warn("ETH deposit above maximum — skipping", {
          txHash: tx.hash,
          amount: ethers.formatEther(tx.value),
          maximum: ethers.formatEther(config.bridge.maxAmountEth),
        });
        continue;
      }

      deposits.push({
        txHash: tx.hash,
        from: tx.from,
        amountWei: tx.value,
        suiRecipient,
        blockNumber: blockNum,
      });

      logger.bridge(
        "ETH -> SUI",
        `${ethers.formatEther(tx.value)} ETH`,
        tx.from,
        suiRecipient,
      );
    }
  }

  return deposits;
}

// ---- Conversion helpers ----

// evmDepositToBridgeRequest — pass GROSS mist, contract takes fee
export function evmDepositToBridgeRequest(
  event: EvmDepositEvent,
  suiRate: bigint,
): BridgeRequest {
  // Gross MIST equivalent of the deposited ETH.
  // Fee is NOT deducted here — release_sui() on the contract takes it.
  const grossAmountMist = (event.amountWei * 1_000_000_000n) / suiRate;

  return {
    id: `eth-${event.txHash}`,
    sourceChain: "evm",
    destChain: "sui",
    senderAddress: event.from,
    recipientAddress: event.suiRecipient,
    amountIn: event.amountWei,
    amountOut: grossAmountMist, // gross — contract takes fee on release
    sourceTxHash: event.txHash,
    status: "pending",
    createdAt: Date.now(),
  };
}

// ---- Balance / block helpers ----

export async function getEthBalance(address: string): Promise<bigint> {
  const provider = getEvmProvider();
  return provider.getBalance(address);
}

export async function getEvmBlockNumber(): Promise<number> {
  const provider = getEvmProvider();
  return provider.getBlockNumber();
}

/**
 * Encode a Sui address for embedding in an Ethereum transaction's data field.
 * Produces hex-encoded UTF-8 bytes of the address string.
 * Decoded on the relayer side with: ethers.toUtf8String(tx.data)
 */
export function encodeSuiRecipient(suiAddress: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(suiAddress));
}
