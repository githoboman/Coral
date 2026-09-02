/**
 * The indexer (I-501, C-701, FR-7.2): keep the feed within 15 seconds of the
 * chain, and survive a reorg without lying about history.
 *
 * Three decisions worth stating:
 *
 *  1. **Confirmations, not optimism.** We index up to `head − CONFIRMATIONS`.
 *     Base's sequencer is fast and reorgs are rare, which is exactly why an
 *     unconfirmed feed entry is dangerous: it will be right almost always,
 *     and the one time it isn't, a user has already read it.
 *
 *  2. **Detect reorgs, don't assume them away.** The cursor stores the hash of
 *     the last block indexed. If the chain no longer agrees about that block,
 *     we rewind and re-index rather than continuing from a history that no
 *     longer exists.
 *
 *  3. **Re-indexing is idempotent.** Events are keyed on
 *     (chain, txHash, logIndex), so a rewind updates rows instead of
 *     duplicating them — a feed that grows a second copy of an event every
 *     time we look again is worse than one that lags.
 */
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { eventToWire } from "@corral/core";

import type { ChainAddresses } from "../../evm/addresses.js";
import { query } from "../db/pool.js";
import { buildExecutionEvent, projectExecution, type ExecutionForProjection } from "./project.js";

/**
 * Blocks to stay behind the head. Base produces a block every ~2s, so 5
 * confirmations is ~10s — inside the 15s freshness budget of FR-7.2 with
 * room for the poll interval.
 */
export const CONFIRMATIONS = 5n;

const journalAbi = parseAbi([
  "event Logged(address indexed account, bytes32 indexed sessionId, bytes32 indexed intentHash, bytes32 strategyId, uint32 seq, uint64 timestamp)",
]);

export interface Cursor {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

export async function getCursor(chainId: number): Promise<Cursor | null> {
  const rows = await query<{ block_number: string; block_hash: string }>(
    `SELECT block_number, block_hash FROM corral_indexer_cursor WHERE chain_id = $1`,
    [chainId],
  );
  const r = rows[0];
  return r ? { blockNumber: BigInt(r.block_number), blockHash: r.block_hash as Hex } : null;
}

export async function setCursor(chainId: number, cursor: Cursor): Promise<void> {
  await query(
    `INSERT INTO corral_indexer_cursor (chain_id, block_number, block_hash, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chain_id) DO UPDATE SET block_number = EXCLUDED.block_number,
                                          block_hash = EXCLUDED.block_hash,
                                          updated_at = now()`,
    [chainId, cursor.blockNumber.toString(10), cursor.blockHash],
  );
}

/**
 * Has the chain changed its mind about the block we last indexed?
 *
 * A `null` answer means we could not tell — treated as "assume a reorg" by
 * the caller, because re-indexing a few blocks is cheap and showing a user a
 * trade that was rolled back is not.
 */
export async function detectReorg(client: PublicClient, cursor: Cursor): Promise<boolean | null> {
  try {
    const block = await client.getBlock({ blockNumber: cursor.blockNumber });
    return block.hash.toLowerCase() !== cursor.blockHash.toLowerCase();
  } catch {
    return null;
  }
}

/** How far back a rewind goes. Generous: re-indexing is idempotent and cheap. */
export const REWIND_BLOCKS = 30n;

export interface IndexResult {
  readonly from: bigint;
  readonly to: bigint;
  readonly journalEntries: number;
  readonly projected: number;
  readonly rewound: boolean;
}

interface ExecutionRow extends ExecutionForProjection {
  readonly account: string;
  readonly permission_id: string;
  readonly policy: { min_output_bps?: number };
}

/** Persist one projected event. Keyed on the log, so re-indexing updates. */
async function upsertEvent(input: {
  chainId: number;
  account: string;
  sessionId: string;
  executionId: string;
  kind: string;
  occurredAt: Date;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
  payload: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO corral_events
       (chain_id, account, session_id, execution_id, kind, occurred_at, block_number, block_hash, tx_hash, log_index, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind, payload = EXCLUDED.payload, block_hash = EXCLUDED.block_hash,
                   occurred_at = EXCLUDED.occurred_at, block_number = EXCLUDED.block_number`,
    [
      input.chainId,
      input.account.toLowerCase(),
      input.sessionId,
      input.executionId,
      input.kind,
      input.occurredAt,
      input.blockNumber.toString(10),
      input.blockHash,
      input.txHash,
      input.logIndex,
      JSON.stringify(input.payload),
    ],
  );
}

/**
 * One indexing pass.
 *
 * Journal entries are the anchor: `CorralJournal.Logged` carries the intent
 * hash, which is how a transaction on chain is tied back to the plan that
 * produced it (FR-3.4). An execution with no journal entry did not happen as
 * far as the feed is concerned, which is precisely the traceability guarantee
 * the journal call exists to provide.
 */
export async function indexOnce(
  client: PublicClient,
  addresses: ChainAddresses,
  opts: { readonly maxBlocks?: bigint; readonly startBlock?: bigint } = {},
): Promise<IndexResult> {
  const chainId = addresses.chainId;
  const head = await client.getBlockNumber();
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

  const cursor = await getCursor(chainId);
  let from = cursor ? cursor.blockNumber + 1n : (opts.startBlock ?? safeHead);
  let rewound = false;

  if (cursor) {
    const reorged = await detectReorg(client, cursor);
    if (reorged !== false) {
      // Unknown counts as reorged: re-indexing a few blocks is cheap, and a
      // rolled-back trade sitting in someone's feed is not.
      from = cursor.blockNumber > REWIND_BLOCKS ? cursor.blockNumber - REWIND_BLOCKS : 0n;
      rewound = true;
    }
  }

  const maxBlocks = opts.maxBlocks ?? 2_000n;
  const to = safeHead - from > maxBlocks ? from + maxBlocks : safeHead;
  if (to < from) return { from, to: from, journalEntries: 0, projected: 0, rewound };

  const logs = await client.getLogs({
    address: addresses.corralJournal.address,
    event: journalAbi[0],
    fromBlock: from,
    toBlock: to,
  });

  let projected = 0;
  for (const log of logs) {
    const intentHash = log.args.intentHash;
    if (!intentHash) continue;

    const rows = await query<ExecutionRow>(
      `SELECT e.id, e.session_id, e.strategy_id, e.seq, e.intent_hash, e.tx_hash, e.asset_in, e.amount_in,
              e.asset_out, e.quoted_out, e.venue, e.status, e.error_code,
              s.account, s.permission_id, s.policy
         FROM corral_executions e
         JOIN corral_sessions s ON s.id = e.session_id
        WHERE e.intent_hash = $1
        LIMIT 1`,
      [intentHash],
    );
    const execution = rows[0];
    // A journal entry with no matching execution row means someone else's
    // account used the same journal contract — expected, and not ours to index.
    if (!execution) continue;

    const projection = await projectExecution(client, execution, execution.account as Address);
    if (!projection) continue;

    const minOutBps = BigInt(execution.policy.min_output_bps ?? 9800);
    const minAmountOut = execution.quoted_out
      ? ((BigInt(execution.quoted_out) * minOutBps) / 10_000n).toString(10)
      : "0";

    const event = buildExecutionEvent({
      chainId,
      account: execution.account as Address,
      permissionId: execution.permission_id,
      execution,
      projection,
      assetInSymbol: "",
      assetOutSymbol: "",
      minAmountOut,
      // The relayer pays L2 gas and is refunded by the EntryPoint from the
      // account's deposit; sponsorship is a separate arrangement and is not
      // assumed here.
      sponsored: false,
    });

    await query(
      `UPDATE corral_executions
          SET realised_out = $2, slippage_bps = $3, gas_used = $4, gas_price_wei = $5,
              gas_cost_wei = $6, gas_paid_by = $7, block_number = $8, block_hash = $9, updated_at = now()
        WHERE id = $1`,
      [
        execution.id,
        projection.realisedOut?.toString(10) ?? null,
        projection.slippageBps,
        projection.gasUsed.toString(10),
        projection.gasPriceWei.toString(10),
        projection.gasCostWei.toString(10),
        "ACCOUNT",
        projection.blockNumber.toString(10),
        projection.blockHash,
      ],
    );

    await upsertEvent({
      chainId,
      account: execution.account,
      sessionId: execution.session_id,
      executionId: execution.id,
      kind: event.kind,
      occurredAt: new Date(projection.blockTimeSeconds * 1000),
      blockNumber: projection.blockNumber,
      blockHash: projection.blockHash,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      payload: eventToWire(event),
    });
    projected += 1;
  }

  const finalBlock = await client.getBlock({ blockNumber: to });
  await setCursor(chainId, { blockNumber: to, blockHash: finalBlock.hash });

  return { from, to, journalEntries: logs.length, projected, rewound };
}
