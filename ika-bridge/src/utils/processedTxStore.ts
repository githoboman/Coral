// Tracks processed tx hashes to prevent double-processing deposits
// after a relayer restart or redeploy.

import { redis } from "../server/index";
import { logger } from "./logger";

const TTL_SECONDS = 60 * 60 * 24 * 7;

const KEY_PREFIX_EVM = "bridge:processed:evm:";
const KEY_PREFIX_SOL = "bridge:processed:sol:";

export async function isEvmTxProcessed(txHash: string): Promise<boolean> {
  try {
    const exists = await redis.exists(KEY_PREFIX_EVM + txHash.toLowerCase());
    return exists === 1;
  } catch (err) {
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
