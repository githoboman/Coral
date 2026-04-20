// ============================================================
// relayer/solanaListener.ts
//
// Watches the Solana bridge address for incoming SOL deposits.
//
// Uses connection.onLogs() WebSocket subscription via Helius —
// fires instantly when any transaction touches the bridge address.
// No polling, no rate-limit hammering.
//
// Reconnect logic handles dropped WS connections automatically.
// ============================================================

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
import { redis } from "../server/index";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

// ── Cursor persistence (Redis) ────────────────────────────────────────────────

const CURSOR_KEY = "bridge:solana:cursor";

async function loadSolanaCursor(): Promise<string | undefined> {
  try {
    const raw = await redis.get(CURSOR_KEY);
    return raw ?? undefined;
  } catch (err) {
    logger.warn("Could not load Solana listener cursor from Redis, starting from latest", { err });
    return undefined;
  }
}

async function saveSolanaCursor(signature: string): Promise<void> {
  try {
    await redis.set(CURSOR_KEY, signature);
  } catch (err) {
    logger.warn("Could not save Solana listener cursor to Redis", { err });
  }
}

// ── Listener ──────────────────────────────────────────────────────────────────

export async function startSolanaListener(
  bridgeSolanaAddress: string,
  onBridgeRequest: (request: BridgeRequest) => void,
): Promise<() => void> {
  logger.info("Starting Solana deposit listener (WebSocket)...", {
    watchingAddress: bridgeSolanaAddress,
  });

  const connection = getSolanaConnection();
  const bridgePubkey = new PublicKey(bridgeSolanaAddress);

  // Load persisted cursor from Redis; fall back to current chain tip on first run.
  let lastSignature: string | undefined = await loadSolanaCursor();

  if (lastSignature) {
    logger.info("Resuming Solana listener from Redis cursor", { lastSignature });
  } else {
    const existing = await connection.getSignaturesForAddress(bridgePubkey, { limit: 1 });
    lastSignature = existing.length > 0 ? existing[0].signature : undefined;
    if (lastSignature) {
      await saveSolanaCursor(lastSignature);
      logger.info("Solana cursor initialized to current tip", { lastSignature });
    } else {
      logger.info("No existing Solana transactions — will process all future deposits.");
    }
  }

  let isRunning = true;
  let subscriptionId: number | null = null;
  let reconnectDelay = RECONNECT_DELAY_MS;

  // ── Core handler: called by onLogs when a tx hits our address ──────────
  async function handleLogEvent(logs: Logs) {
    // Skip failed transactions — they can't be valid deposits
    if (logs.err) return;

    logger.debug("Solana log event received", { signature: logs.signature });

    // Reset backoff on successful event
    reconnectDelay = RECONNECT_DELAY_MS;

    try {
      // detectSolanaDeposits fetches all new txs since lastSignature.
      // Usually this is just the one that triggered onLogs, but handles
      // the edge case where multiple txs arrive between event callbacks.
      const deposits = await detectSolanaDeposits(
        bridgeSolanaAddress,
        lastSignature,
      );

      for (const deposit of deposits) {
        if (await isSolanaTxProcessed(deposit.signature)) continue;
        await markSolanaTxProcessed(deposit.signature);

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

      // Advance cursor and persist to Redis
      if (deposits.length > 0) {
        lastSignature = deposits[0].signature;
        await saveSolanaCursor(lastSignature);
      }
    } catch (err) {
      logger.error("Error processing Solana deposit event", err);
    }
  }

  // ── Subscribe ───────────────────────────────────────────────────────────
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

  // ── Reconnect with exponential backoff ──────────────────────────────────
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

      // Exponential backoff, capped at MAX_RECONNECT_DELAY_MS
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      subscribe();
    }, reconnectDelay);
  }

  // ── Keepalive: detect silently dropped connections ───────────────────────
  // Helius WS is reliable but connections can drop without an error event.
  // Every 30s, verify the connection is alive with a lightweight RPC call.
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
