import { ethers } from "ethers";
import { config } from "../config";
import { BridgeRequest, EvmDepositEvent } from "../types";
import { signEvmTransaction } from "../ika/signer";
import { DWalletInfo } from "../types";
import { logger } from "../utils/logger";

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

  if (!ethers.isAddress(to)) {
    throw new Error(`Invalid Ethereum recipient address: ${to}`);
  }

  const nonce = await provider.getTransactionCount(bridgeAddress);
  const feeData = await provider.getFeeData();
  const gasLimit = 21000n;

  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");

  const maxFeePerGas = feeData.maxFeePerGas
    ? (feeData.maxFeePerGas * 120n) / 100n
    : ethers.parseUnits("50", "gwei");

  const txData: ethers.TransactionLike = {
    type: 2,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
    to,
    value: amountWei,
    data: "0x",
    chainId: config.evm.chainId,
  };

  logger.debug("Requesting EVM transaction signature from Ika dWallet...", {
    txHash: ethers.keccak256(
      ethers.Transaction.from(txData).unsignedSerialized,
    ),
    nonce,
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  });

  const unsignedTx = ethers.Transaction.from(txData);

  const rawTxBytes = ethers.getBytes(unsignedTx.unsignedSerialized);

  const txHash = ethers.keccak256(unsignedTx.unsignedSerialized);

  logger.debug("Requesting EVM transaction signature from Ika dWallet...", {
    txHash,
    nonce,
    gasPrice: feeData.gasPrice ? feeData.gasPrice.toString() : "null",
  });

  const { signature } = await signEvmTransaction({
    rawTxBytes,
    dWalletInfo,
  });

  const r = "0x" + Buffer.from(signature.slice(0, 32)).toString("hex");
  const s = "0x" + Buffer.from(signature.slice(32, 64)).toString("hex");

  let v: number | null = null;
  for (const candidate of [27, 28]) {
    try {
      const recovered = ethers.recoverAddress(txHash, { r, s, v: candidate });
      if (recovered.toLowerCase() === bridgeAddress.toLowerCase()) {
        v = candidate;
        break;
      }
    } catch {}
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
      if (tx.to?.toLowerCase() !== bridgeAddress.toLowerCase()) continue;

      if (tx.value === 0n) continue;

      if (tx.from.toLowerCase() === bridgeAddress.toLowerCase()) continue;

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

export function evmDepositToBridgeRequest(
  event: EvmDepositEvent,
  suiRate: bigint,
): BridgeRequest {
  const grossAmountMist = (event.amountWei * 1_000_000_000n) / suiRate;

  return {
    id: `eth-${event.txHash}`,
    sourceChain: "evm",
    destChain: "sui",
    senderAddress: event.from,
    recipientAddress: event.suiRecipient,
    amountIn: event.amountWei,
    amountOut: grossAmountMist,
    sourceTxHash: event.txHash,
    status: "pending",
    createdAt: Date.now(),
  };
}

export async function getEthBalance(address: string): Promise<bigint> {
  const provider = getEvmProvider();
  return provider.getBalance(address);
}

export async function getEvmBlockNumber(): Promise<number> {
  const provider = getEvmProvider();
  return provider.getBlockNumber();
}

export function encodeSuiRecipient(suiAddress: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(suiAddress));
}
