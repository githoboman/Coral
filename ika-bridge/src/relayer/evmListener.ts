//
// Watches the EVM bridge address for incoming ETH deposits.
//
// Uses ethers WebSocketProvider to subscribe to new blocks via Alchemy.
// On each new block event, scans only that block range for deposits.

import { ethers } from "ethers";
import { BridgeRequest } from "../types";
import { detectEvmDeposits, evmDepositToBridgeRequest } from "../chains/evm";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  isEvmTxProcessed,
  markEvmTxProcessed,
} from "../utils/processedTxStore";

const INITIAL_LOOKBACK_BLOCKS = 10;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export async function startEvmListener(
  bridgeEvmAddress: string,
  onBridgeRequest: (request: BridgeRequest) => void,
): Promise<() => void> {
  logger.info("Starting EVM deposit listener (WebSocket)...", {
    watchingAddress: bridgeEvmAddress,
  });

  let isRunning = true;
  let provider: ethers.WebSocketProvider | null = null;
  let lastProcessedBlock = 0;
  let reconnectDelay = RECONNECT_DELAY_MS;

  const MAX_BLOCKS_PER_SCAN = 50;

  async function onNewBlock(blockNumber: number) {
    if (lastProcessedBlock === 0) return;

    const fromBlock = lastProcessedBlock + 1;

    const toBlock = Math.min(blockNumber, fromBlock + MAX_BLOCKS_PER_SCAN - 1);

    if (fromBlock > toBlock) return;

    if (blockNumber > fromBlock + MAX_BLOCKS_PER_SCAN) {
      logger.warn("EVM listener is behind — catching up incrementally", {
        currentBlock: blockNumber,
        processingUpTo: toBlock,
        blocksRemaining: blockNumber - toBlock,
      });
    }

    logger.debug(
      `New EVM block ${blockNumber}, scanning blocks ${fromBlock}–${toBlock}...`,
    );

    try {
      const deposits = await detectEvmDeposits(
        bridgeEvmAddress,
        fromBlock,
        toBlock,
      );

      for (const deposit of deposits) {
        if (await isEvmTxProcessed(deposit.txHash)) continue;
        await markEvmTxProcessed(deposit.txHash);

        const bridgeRequest = evmDepositToBridgeRequest(
          deposit,
          config.bridge.rateSuiToEth,
        );

        logger.bridge(
          "ETH → SUI",
          `${(Number(deposit.amountWei) / 1e18).toFixed(6)} ETH`,
          deposit.from,
          deposit.suiRecipient,
        );

        onBridgeRequest(bridgeRequest);
      }

      lastProcessedBlock = toBlock;
      reconnectDelay = RECONNECT_DELAY_MS;
    } catch (err) {
      logger.error(`Error scanning EVM blocks ${fromBlock}–${toBlock}`, err);
    }
  }

  async function connect() {
    if (!isRunning) return;

    try {
      provider = new ethers.WebSocketProvider(config.evm.wsUrl);

      await provider.ready;

      const currentBlock = await provider.getBlockNumber();
      lastProcessedBlock = currentBlock - INITIAL_LOOKBACK_BLOCKS;

      provider.on("block", onNewBlock);

      const ws = (provider as any).websocket;
      if (ws) {
        ws.on?.("close", () => {
          if (!isRunning) return;
          logger.warn("EVM WebSocket connection closed");
          scheduleReconnect();
        });
        ws.on?.("error", (err: Error) => {
          if (!isRunning) return;
          logger.error("EVM WebSocket error", err);
          scheduleReconnect();
        });
      }

      reconnectDelay = RECONNECT_DELAY_MS;
      logger.success("EVM WebSocket subscription active", {
        bridgeAddress: bridgeEvmAddress,
        currentBlock,
        wsUrl: config.evm.wsUrl,
      });
    } catch (err) {
      logger.error("Failed to connect EVM WebSocket", err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!isRunning) return;

    logger.warn(
      `EVM WebSocket disconnected. Reconnecting in ${reconnectDelay}ms...`,
    );

    setTimeout(async () => {
      if (!isRunning) return;

      if (provider) {
        provider.removeAllListeners();
        await provider.destroy().catch(() => {});
        provider = null;
      }

      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      await connect();
    }, reconnectDelay);
  }

  await connect();

  logger.success("EVM deposit listener started", {
    bridgeAddress: bridgeEvmAddress,
    mode: "WebSocket (block subscription)",
  });

  return () => {
    isRunning = false;
    if (provider) {
      provider.removeAllListeners();
      provider.destroy().catch(() => {});
    }
    logger.info("EVM deposit listener stopped");
  };
}
