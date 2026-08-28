/**
 * Event projection (C-701, FR-7.3): turn a mined transaction into the feed
 * entry a user reads.
 *
 * The rule that shapes this file: **the chain is the source, our records are
 * only the join key.** We stored what we intended to trade and what we were
 * quoted; the receipt says what actually moved. Where they disagree, the
 * receipt wins and the difference is the number worth showing — that is
 * exactly what slippage is.
 *
 * Realised output is read from the ERC-20 `Transfer` log crediting the
 * account, not from the swap function's return value, because the return
 * value is what the router claims and the Transfer is what the token did.
 */
import { decodeEventLog, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { gasCostWei, slippageBps, type CorralEvent } from "@corral/core";

const erc20Abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export interface ExecutionForProjection {
  readonly id: string;
  readonly session_id: string;
  readonly strategy_id: string | null;
  readonly seq: number;
  readonly intent_hash: string | null;
  readonly tx_hash: string | null;
  readonly asset_in: string | null;
  readonly amount_in: string | null;
  readonly asset_out: string | null;
  readonly quoted_out: string | null;
  readonly venue: string | null;
  readonly status: string;
  readonly error_code: string | null;
}

export interface Projection {
  readonly realisedOut: bigint | null;
  readonly slippageBps: number | null;
  readonly gasUsed: bigint;
  readonly gasPriceWei: bigint;
  readonly gasCostWei: bigint;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTimeSeconds: number;
  readonly success: boolean;
}

/**
 * How much of `assetOut` the account actually received in this transaction.
 *
 * Sums every crediting Transfer rather than taking the first: a route that
 * settles in two hops credits twice, and reporting only one would understate
 * the fill and invent slippage that never happened.
 */
export function realisedOutFromLogs(
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[],
  assetOut: Address,
  account: Address,
): bigint {
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== assetOut.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "Transfer" && ev.args.to.toLowerCase() === account.toLowerCase()) {
        total += ev.args.value;
      }
    } catch {
      // Not a Transfer we can decode — an unrelated log on the same address.
    }
  }
  return total;
}

/**
 * Read the chain for one execution and compute everything the feed needs.
 *
 * Returns `null` when the transaction is not (yet) known: the caller decides
 * whether that means "wait" or "abandon"; projection does not guess.
 */
export async function projectExecution(
  client: PublicClient,
  execution: ExecutionForProjection,
  account: Address,
): Promise<Projection | null> {
  if (!execution.tx_hash) return null;

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: execution.tx_hash as Hex });
  } catch {
    return null;
  }

  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const gasUsed = receipt.gasUsed;
  const gasPriceWei = receipt.effectiveGasPrice;

  let realisedOut: bigint | null = null;
  let slippage: number | null = null;
  if (execution.asset_out && receipt.status === "success") {
    realisedOut = realisedOutFromLogs(receipt.logs, execution.asset_out as Address, account);
    if (execution.quoted_out) {
      // The single narrowing of the clamped bigint from core (±10000).
      slippage = Number(slippageBps(BigInt(execution.quoted_out), realisedOut));
    }
  }

  return {
    realisedOut,
    slippageBps: slippage,
    gasUsed,
    gasPriceWei,
    gasCostWei: gasCostWei(gasUsed, gasPriceWei),
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    blockTimeSeconds: Number(block.timestamp),
    success: receipt.status === "success",
  };
}

/**
 * Build the canonical event for a projected execution.
 *
 * Gas is attached in its own object, never merged into the swap detail
 * (FR-6.5): the user's budget and the cost of moving it are different
 * quantities in different assets, and the schema makes conflating them
 * impossible rather than merely discouraged.
 */
export function buildExecutionEvent(input: {
  readonly chainId: number;
  readonly account: Address;
  readonly permissionId: string | null;
  readonly execution: ExecutionForProjection;
  readonly projection: Projection;
  readonly assetInSymbol: string;
  readonly assetOutSymbol: string;
  readonly minAmountOut: string;
  readonly sponsored: boolean;
}): CorralEvent {
  const { execution: x, projection: p } = input;
  const traded = x.asset_in !== null && x.amount_in !== null && x.asset_out !== null && p.realisedOut !== null;

  return {
    kind: p.success ? "EXECUTION_SUCCEEDED" : "EXECUTION_FAILED",
    at: p.blockTimeSeconds,
    chainId: input.chainId,
    account: input.account.toLowerCase(),
    permissionId: input.permissionId,
    executionId: x.id,
    strategyId: x.strategy_id,
    seq: x.seq,
    intentHash: x.intent_hash,
    txHash: x.tx_hash,
    blockNumber: Number(p.blockNumber),
    swap: traded
      ? {
          assetIn: { symbol: input.assetInSymbol, address: x.asset_in },
          assetOut: { symbol: input.assetOutSymbol, address: x.asset_out },
          amountIn: BigInt(x.amount_in ?? "0"),
          quotedOut: BigInt(x.quoted_out ?? "0"),
          realisedOut: p.realisedOut ?? 0n,
          minAmountOut: BigInt(input.minAmountOut),
          slippageBps: p.slippageBps ?? 0,
          venue: x.venue ?? "unknown",
        }
      : null,
    gas: {
      gasUsed: p.gasUsed,
      effectiveGasPriceWei: p.gasPriceWei,
      costWei: p.gasCostWei,
      paidBy: input.sponsored ? "SPONSOR" : "ACCOUNT",
    },
    errorCode: p.success ? null : (x.error_code ?? "SIMULATION_REVERT"),
    detail: {},
  } as CorralEvent;
}
