import { SuiClient, SuiEvent } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { bcs } from "@mysten/sui/bcs";

import { SuiBridgeLockEvent, BridgeRequest, ChainId } from "../types";
import { config, calculateBridgeOutput } from "../config";
import { getSuiClient } from "../ika/client";
import {
  executeTransaction,
  loadSuiKeypair,
  getAddress,
} from "../utils/executeTransaction";
import { loadBridgeState } from "../ika/dwalletManager";
import { logger } from "../utils/logger";
import crypto from "crypto";

let BRIDGE_POOL_ADDRESS: string | null = null;

export function getBridgePoolAddress(): string {
  if (!BRIDGE_POOL_ADDRESS) {
    const keypair = loadSuiKeypair(config.ika.suiPrivateKey);
    BRIDGE_POOL_ADDRESS = getAddress(keypair);
  }
  return BRIDGE_POOL_ADDRESS;
}

/**
 *
 * @param amountMist - Amount of SUI to lock, in MIST
 * @param destChain - 'evm' or 'solana'
 * @param recipientAddress - Recipient address on the destination chain
 * @param userKeypair - The user's Sui keypair
 */
export async function lockSui(
  amountMist: bigint,
  destChain: "evm" | "solana",
  recipientAddress: string,
  userKeypair: Ed25519Keypair,
): Promise<{ bridgeRequestId: string; txHash: string }> {
  const suiClient = getSuiClient();
  const userAddress = userKeypair.toSuiAddress();

  logger.info("Locking SUI for bridge transfer...", {
    amountSui: (Number(amountMist) / 1e9).toFixed(4),
    destChain,
    recipient: recipientAddress,
  });

  if (amountMist < config.bridge.minAmountSui) {
    throw new Error(
      `Amount too small. Minimum: ${Number(config.bridge.minAmountSui) / 1e9} SUI`,
    );
  }

  const bridgeState = loadBridgeState();
  const contract = bridgeState?.contract;

  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);

  let bridgeRequestId: string;

  if (contract?.packageId && contract?.poolObjectId) {
    const destChainId = destChain === "evm" ? 0 : 1;

    const recipientBytes = Array.from(
      new TextEncoder().encode(recipientAddress),
    );

    tx.moveCall({
      target: `${contract.packageId}::bridge::lock_sui`,
      arguments: [
        tx.object(contract.poolObjectId),
        coin,
        tx.pure.u8(destChainId),
        tx.pure(bcs.vector(bcs.u8()).serialize(recipientBytes)),
      ],
    });

    bridgeRequestId = crypto.randomUUID();

    logger.debug("Calling Move bridge::lock_sui", {
      packageId: contract.packageId,
      poolObjectId: contract.poolObjectId,
      destChainId,
      recipientAddress,
    });
  } else {
    logger.warn(
      "Move contract not deployed — using plain transfer fallback. " +
        "The relayer will not detect this automatically. Run `pnpm deploy:move` " +
        "to enable the full event-driven flow.",
    );

    const poolAddress = getBridgePoolAddress();
    tx.transferObjects([coin], poolAddress);
    bridgeRequestId = crypto.randomUUID();

    logger.debug("Bridge request metadata (plain transfer):", {
      bridgeRequestId,
      sender: userAddress,
      destChain,
      recipientAddress,
      amountMist: amountMist.toString(),
    });
  }

  const result = await executeTransaction(suiClient, tx, userKeypair);

  logger.success("SUI locked for bridging!", {
    bridgeRequestId,
    txHash: result.digest,
    amountSui: (Number(amountMist) / 1e9).toFixed(4),
    destination: `${destChain}:${recipientAddress}`,
  });

  return { bridgeRequestId, txHash: result.digest };
}

/**
 * Release SUI from the bridge pool to a user.
 *
 *
 * @param recipientAddress
 * @param amountMist
 * @param sourceTxHash
 */
export async function releaseSui(
  recipientAddress: string,
  amountMist: bigint,
  sourceTxHash: string,
): Promise<string> {
  const suiClient = getSuiClient();
  const bridgeKeypair = loadSuiKeypair(config.ika.suiPrivateKey);

  logger.info("Releasing SUI to user...", {
    recipient: recipientAddress,
    amountSui: (Number(amountMist) / 1e9).toFixed(4),
    sourceTx: sourceTxHash,
  });

  const bridgeState = loadBridgeState();
  const contract = bridgeState?.contract;

  const tx = new Transaction();

  if (
    contract?.packageId &&
    contract?.poolObjectId &&
    contract?.adminCapObjectId
  ) {
    const sourceTxHashBytes = Array.from(
      new TextEncoder().encode(sourceTxHash),
    );

    tx.moveCall({
      target: `${contract.packageId}::bridge::release_sui`,
      arguments: [
        tx.object(contract.poolObjectId),
        tx.object(contract.adminCapObjectId),
        tx.pure.address(recipientAddress),
        tx.pure.u64(amountMist),
        tx.pure(bcs.vector(bcs.u8()).serialize(sourceTxHashBytes)),
      ],
    });

    logger.debug("Calling Move bridge::release_sui", {
      packageId: contract.packageId,
      recipient: recipientAddress,
      amountMist: amountMist.toString(),
    });
  } else {
    logger.warn(
      "Move contract not deployed — using plain transfer fallback for release.",
    );

    // Check pool balance manually
    const poolAddress = getBridgePoolAddress();
    const { data: coins } = await suiClient.getCoins({
      owner: poolAddress,
      coinType: "0x2::sui::SUI",
    });

    const totalBalance = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    if (totalBalance < amountMist) {
      throw new Error(
        `Bridge pool has insufficient SUI!\n` +
          `Available: ${(Number(totalBalance) / 1e9).toFixed(4)} SUI\n` +
          `Required:  ${(Number(amountMist) / 1e9).toFixed(4)} SUI`,
      );
    }

    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.transferObjects([coin], recipientAddress);
  }

  const result = await executeTransaction(suiClient, tx, bridgeKeypair);

  logger.success("SUI released to user!", {
    recipient: recipientAddress,
    amountSui: (Number(amountMist) / 1e9).toFixed(4),
    destTxHash: result.digest,
  });

  return result.digest;
}

export function parseSuiLockEvent(event: SuiEvent): SuiBridgeLockEvent | null {
  try {
    if (!event.type.includes("::bridge::BridgeLockEvent")) return null;

    const fields = event.parsedJson as {
      bridge_request_id: string;
      sender: string;
      dest_chain: number | string;
      recipient_address: string;
      gross_amount_mist: string;
      net_amount_mist: string;
      fee_mist: string;
    };

    if (
      fields.bridge_request_id === undefined ||
      !fields.sender ||
      fields.dest_chain === undefined ||
      !fields.recipient_address ||
      !fields.gross_amount_mist ||
      !fields.net_amount_mist
    ) {
      logger.warn("BridgeLockEvent missing expected fields", { fields });
      return null;
    }

    return {
      bridgeRequestId: String(fields.bridge_request_id),
      sender: fields.sender,
      destChain: Number(fields.dest_chain),
      recipientAddress: fields.recipient_address,
      grossAmountMist: fields.gross_amount_mist,
      netAmountMist: fields.net_amount_mist,
      feeMist: fields.fee_mist ?? "0",
    };
  } catch (err) {
    logger.warn("Failed to parse BridgeLockEvent", { err });
    return null;
  }
}

export function lockEventToBridgeRequest(
  event: SuiBridgeLockEvent,
  txHash: string,
): BridgeRequest | null {
  const destChain: ChainId = event.destChain === 0 ? "evm" : "solana";

  const amountIn = BigInt(event.grossAmountMist);

  const netAmountMist = BigInt(event.netAmountMist);
  const rate =
    destChain === "evm"
      ? config.bridge.rateSuiToEth
      : config.bridge.rateSuiToSol;

  const amountOut = (netAmountMist * rate) / 1_000_000_000n;

  logger.debug("Lock event fee breakdown", {
    grossSui: (Number(amountIn) / 1e9).toFixed(6),
    feeSui: (Number(BigInt(event.feeMist)) / 1e9).toFixed(6),
    netSui: (Number(netAmountMist) / 1e9).toFixed(6),
  });

  return {
    id: event.bridgeRequestId || crypto.randomUUID(),
    sourceChain: "sui",
    destChain,
    senderAddress: event.sender,
    recipientAddress: event.recipientAddress,
    amountIn,
    amountOut,
    sourceTxHash: txHash,
    status: "pending",
    createdAt: Date.now(),
  };
}

export async function getSuiBalance(address: string): Promise<bigint> {
  const suiClient = getSuiClient();
  const balance = await suiClient.getBalance({
    owner: address,
    coinType: "0x2::sui::SUI",
  });
  return BigInt(balance.totalBalance);
}
