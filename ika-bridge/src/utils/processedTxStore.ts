// ============================================================
// utils/processedTxStore.ts
//
// Tracks processed tx hashes to prevent double-processing deposits
// after a relayer restart or redeploy.
//
// Previously: wrote JSON files to ./relayer-state/ on disk.
// Now: stores in Redis with a 7-day TTL per hash.
//
// Why Redis instead of files:
//   - Cloud deployments (Render, Railway, Fly.io) have ephemeral
//     filesystems — a redeploy wipes the files and the relayer
//     could reprocess old deposits.
//   - Redis is already running for BullMQ, so no new dependency.
//   - TTL-based expiry replaces the manual MAX_ENTRIES trim logic.
//
// Public API is identical to the file-based version — no changes
// needed in evmListener.ts or solanaListener.ts.
// ============================================================

import { redis } from "../server/index";
import { logger } from "./logger";

// 7 days — long enough to cover any realistic restart window.
// Older hashes are auto-expired by Redis.
const TTL_SECONDS = 60 * 60 * 24 * 7;

const KEY_PREFIX_EVM = "bridge:processed:evm:";
const KEY_PREFIX_SOL = "bridge:processed:sol:";

// ── EVM ──────────────────────────────────────────────────────────────────────

export async function isEvmTxProcessed(txHash: string): Promise<boolean> {
  try {
    const exists = await redis.exists(KEY_PREFIX_EVM + txHash.toLowerCase());
    return exists === 1;
  } catch (err) {
    // On Redis failure, return false so we don't silently drop deposits.
    // The duplicate-check is best-effort — the BullMQ job deduplication
    // via job name (request.id) provides a second layer of protection.
    logger.warn("Redis check failed for EVM tx — allowing through", {
      txHash,
      err,
    });
    return false;
  }
}

export async function markEvmTxProcessed(txHash: string): Promise<void> {
  try {
    await redis.set(
      KEY_PREFIX_EVM + txHash.toLowerCase(),
      "1",
      "EX",
      TTL_SECONDS,
    );
  } catch (err) {
    logger.warn("Redis mark failed for EVM tx", { txHash, err });
  }
}

// ── Solana ────────────────────────────────────────────────────────────────────

export async function isSolanaTxProcessed(signature: string): Promise<boolean> {
  try {
    const exists = await redis.exists(KEY_PREFIX_SOL + signature);
    return exists === 1;
  } catch (err) {
    logger.warn("Redis check failed for Solana tx — allowing through", {
      signature,
      err,
    });
    return false;
  }
}

export async function markSolanaTxProcessed(signature: string): Promise<void> {
  try {
    await redis.set(KEY_PREFIX_SOL + signature, "1", "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn("Redis mark failed for Solana tx", { signature, err });
  }
}
