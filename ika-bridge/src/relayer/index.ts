// ============================================================
// relayer/index.ts
//
// The main bridge relayer process.
//
// This is the "brain" of the bridge. It:
//   1. Loads the dWallet IDs from bridge-state.json
//   2. Starts listeners on Sui, EVM, and Solana
//   3. Processes each bridge request:
//      - SUI → ETH: sign ETH transfer via EVM dWallet, broadcast to Ethereum
//      - SUI → SOL: sign SOL transfer via Solana dWallet, broadcast to Solana
//      - ETH → SUI: release SUI from pool to recipient on Sui
//      - SOL → SUI: release SUI from pool to recipient on Sui
//
// Run this with: pnpm relayer
// ============================================================

import { BridgeRequest } from "../types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { loadBridgeState } from "../ika/dwalletManager";
import { getIkaClient } from "../ika/client";
import { releaseSui } from "../chains/sui";
import { sendEthViaDWallet } from "../chains/evm";
import { sendSolViaDWallet } from "../chains/solana";
import { startSuiListener } from "./suiListener";
import { startEvmListener } from "./evmListener";
import { startSolanaListener } from "./solanaListener";

// ---- Request Queue ----
// Simple in-memory queue. In production, use Redis or a message queue (RabbitMQ, SQS)
const requestQueue: BridgeRequest[] = [];
let isProcessing = false;

// ---- Main ----

async function main() {
  logger.info("");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("          🌉  IKA BRIDGE RELAYER  🌉");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info(`  Network: ${config.ika.network}`);
  logger.info(`  EVM:     ${config.evm.rpcUrl}`);
  logger.info(`  Solana:  ${config.solana.rpcUrl}`);
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("");

  // Step 1: Load dWallet state
  const bridgeState = loadBridgeState();
  if (!bridgeState) {
    logger.error("No bridge state found! Run setup first:");
    logger.error("  pnpm setup");
    process.exit(1);
  }

  // Step 2: Initialize Ika client
  logger.info("Connecting to Ika network...");
  await getIkaClient();

  // Step 3: Log bridge vault addresses
  logger.info("");
  logger.info("Bridge vault addresses:");
  logger.info(`  EVM (Ethereum): ${bridgeState.evmDWallet.targetChainAddress}`);
  logger.info(
    `  Solana:         ${bridgeState.solanaDWallet.targetChainAddress}`,
  );
  logger.info("");
  logger.warn("⚠️  Make sure these addresses are funded with ETH and SOL!");
  logger.info("");

  // Step 4: Callback to handle each incoming bridge request
  function onBridgeRequest(request: BridgeRequest) {
    if (requestQueue.length >= config.relayer.maxQueueSize) {
      logger.warn("Bridge request queue is full! Dropping request.", {
        requestId: request.id,
        queueSize: requestQueue.length,
      });
      return;
    }

    logger.info("New bridge request queued", {
      id: request.id,
      route: `${request.sourceChain} → ${request.destChain}`,
      amountIn: request.amountIn.toString(),
      recipient: request.recipientAddress,
    });

    requestQueue.push(request);

    // Trigger processing if not already running
    if (!isProcessing) {
      processQueue(bridgeState);
    }
  }

  // Step 5: Start all chain listeners
  logger.info("Starting chain listeners...");
  const cleanupFns = await Promise.all([
    startSuiListener(onBridgeRequest),
    startEvmListener(
      bridgeState.evmDWallet.targetChainAddress,
      onBridgeRequest,
    ),
    startSolanaListener(
      bridgeState.solanaDWallet.targetChainAddress,
      onBridgeRequest,
    ),
  ]);

  logger.info("");
  logger.success("🟢 Bridge relayer is running! Watching for transfers...");
  logger.info("");
  logger.info("Press Ctrl+C to stop.");

  // Step 6: Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down bridge relayer...");
    cleanupFns.forEach((fn) => fn());
    logger.info("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---- Queue Processor ----

/**
 * Process bridge requests from the queue, one at a time.
 * Sequential processing prevents nonce/double-spend issues.
 */
async function processQueue(
  bridgeState: Awaited<ReturnType<typeof loadBridgeState>>,
) {
  if (!bridgeState) return;
  if (isProcessing) return;
  isProcessing = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift()!;
    await processBridgeRequest(request, bridgeState);
  }

  isProcessing = false;
}

/**
 * Process a single bridge request.
 * Routes to the correct handler based on source/destination chains.
 */
async function processBridgeRequest(
  request: BridgeRequest,
  bridgeState: NonNullable<ReturnType<typeof loadBridgeState>>,
) {
  logger.info(`Processing bridge request [${request.id}]`, {
    route: `${request.sourceChain} → ${request.destChain}`,
    amountIn: request.amountIn.toString(),
    amountOut: request.amountOut.toString(),
    recipient: request.recipientAddress,
  });

  request.status = "signing";

  try {
    let destTxHash: string;

    // ---- Route: SUI → EVM ----
    if (request.sourceChain === "sui" && request.destChain === "evm") {
      logger.info(
        `[${request.id}] SUI → ETH: Signing ETH transfer via Ika dWallet...`,
      );
      destTxHash = await sendEthViaDWallet(
        request.recipientAddress,
        request.amountOut,
        bridgeState.evmDWallet,
      );
    }

    // ---- Route: SUI → Solana ----
    else if (request.sourceChain === "sui" && request.destChain === "solana") {
      logger.info(
        `[${request.id}] SUI → SOL: Signing SOL transfer via Ika dWallet...`,
      );
      destTxHash = await sendSolViaDWallet(
        request.recipientAddress,
        request.amountOut,
        bridgeState.solanaDWallet,
      );
    }

    // ---- Route: EVM → SUI ----
    else if (request.sourceChain === "evm" && request.destChain === "sui") {
      logger.info(
        `[${request.id}] ETH → SUI: Releasing SUI from bridge pool...`,
      );
      // For ETH → SUI, we don't need a dWallet signature —
      // we just release SUI from the bridge's Sui pool (signed with our regular Sui key)
      destTxHash = await releaseSui(
        request.recipientAddress,
        request.amountOut,
        request.sourceTxHash,
      );
    }

    // ---- Route: Solana → SUI ----
    else if (request.sourceChain === "solana" && request.destChain === "sui") {
      logger.info(
        `[${request.id}] SOL → SUI: Releasing SUI from bridge pool...`,
      );
      destTxHash = await releaseSui(
        request.recipientAddress,
        request.amountOut,
        request.sourceTxHash,
      );
    } else {
      throw new Error(
        `Unsupported bridge route: ${request.sourceChain} → ${request.destChain}`,
      );
    }

    // Success!
    request.status = "completed";
    request.destTxHash = destTxHash;

    logger.success(`✅ Bridge request [${request.id}] completed!`, {
      route: `${request.sourceChain} → ${request.destChain}`,
      recipient: request.recipientAddress,
      destTxHash,
    });
  } catch (err) {
    request.status = "failed";
    request.error = err instanceof Error ? err.message : String(err);

    // Stringify BigInt fields before logging — JSON.stringify cannot handle BigInt natively
    const safeRequest = {
      ...request,
      amountIn: request.amountIn.toString(),
      amountOut: request.amountOut.toString(),
    };

    logger.error(`❌ Bridge request [${request.id}] FAILED`, err, safeRequest);

    // In production: alert/notify, add to retry queue, etc.
  }
}

// ---- Start ----
main().catch((err) => {
  logger.error("Fatal error in bridge relayer", err);
  process.exit(1);
});
