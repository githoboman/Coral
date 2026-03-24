// Watches the Solana bridge address for incoming SOL deposits.
// Uses connection.onLogs() WebSocket subscription via Helius —
// fires instantly when any transaction touches the bridge address.

import { BridgeRequest } from "../types";
import {
  detectSolanaDeposits,
  solanaDepositToBridgeRequest,
  getSolanaConnection,
} from "../chains/solana";
import { config } from "../config";
import { logger } from "../utils/logger";
import { PublicKey, Logs } from "@solana/web3.js";
import {
  isSolanaTxProcessed,
  markSolanaTxProcessed,
} from "../utils/processedTxStore";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

export async function startSolanaListener(
  bridgeSolanaAddress: string,
  onBridgeRequest: (request: BridgeRequest) => void,
): Promise<() => void> {
  logger.info("Starting Solana deposit listener (WebSocket)...", {
    watchingAddress: bridgeSolanaAddress,
  });

  const connection = getSolanaConnection();
  const bridgePubkey = new PublicKey(bridgeSolanaAddress);

  const existing = await connection.getSignaturesForAddress(bridgePubkey, {
    limit: 1,
  });
  let lastSignature: string | undefined =
    existing.length > 0 ? existing[0].signature : undefined;

  let isRunning = true;
  let subscriptionId: number | null = null;
  let reconnectDelay = RECONNECT_DELAY_MS;

  async function handleLogEvent(logs: Logs) {
    if (logs.err) return;

    logger.debug("Solana log event received", { signature: logs.signature });

    reconnectDelay = RECONNECT_DELAY_MS;

    try {
      const deposits = await detectSolanaDeposits(
        bridgeSolanaAddress,
        lastSignature,
      );

      for (const deposit of deposits) {
        if (await isSolanaTxProcessed(deposit.signature)) continue;
        markSolanaTxProcessed(deposit.signature);

        const bridgeRequest = solanaDepositToBridgeRequest(
          deposit,
          config.bridge.rateSuiToSol,
        );

        logger.bridge(
          "SOL → SUI",
          `${(Number(deposit.amountLamports) / 1e9).toFixed(6)} SOL`,
          deposit.from,
          deposit.suiRecipient,
        );

        onBridgeRequest(bridgeRequest);
      }

      // Advance cursor
      if (deposits.length > 0) {
        lastSignature = deposits[0].signature;
      }
    } catch (err) {
      logger.error("Error processing Solana deposit event", err);
    }
  }

  function subscribe() {
    if (!isRunning) return;

    try {
      subscriptionId = connection.onLogs(
        bridgePubkey,
        handleLogEvent,
        "confirmed",
      );

      logger.success("Solana WebSocket subscription active", {
        bridgeAddress: bridgeSolanaAddress,
        subscriptionId,
      });
    } catch (err) {
      logger.error("Failed to subscribe to Solana logs", err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!isRunning) return;

    logger.warn(
      `Solana WebSocket disconnected. Reconnecting in ${reconnectDelay}ms...`,
    );

    setTimeout(async () => {
      if (!isRunning) return;

      if (subscriptionId !== null) {
        await connection.removeOnLogsListener(subscriptionId).catch(() => {});
        subscriptionId = null;
      }

      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      subscribe();
    }, reconnectDelay);
  }

  const keepalive = setInterval(async () => {
    if (!isRunning) return;
    try {
      await connection.getSlot();
    } catch {
      logger.warn("Solana keepalive failed — connection may be lost");
      scheduleReconnect();
    }
  }, KEEPALIVE_INTERVAL_MS);

  subscribe();

  logger.success("Solana deposit listener started", {
    bridgeAddress: bridgeSolanaAddress,
    mode: "WebSocket (onLogs)",
    rpcUrl: config.solana.rpcUrl,
  });

  return () => {
    isRunning = false;
    clearInterval(keepalive);
    if (subscriptionId !== null) {
      connection.removeOnLogsListener(subscriptionId).catch(() => {});
    }
    logger.info("Solana deposit listener stopped");
  };
}
