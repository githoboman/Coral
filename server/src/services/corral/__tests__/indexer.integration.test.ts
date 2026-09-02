/**
 * C-701 / I-501 / FR-7.2 / FR-7.3 — event projection and the indexer.
 *
 * The claim under test is narrow and important: the feed is rebuilt from what
 * the chain says, not from what we believed we submitted. So the assertions
 * are about disagreement — a fill that differs from the quote, a router that
 * claims more than it transferred, and a block the chain has changed its mind
 * about.
 */
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BASE_SEPOLIA } from "../../evm/addresses.js";
import { runMigrations } from "../db/migrate.js";
import { closePool, query } from "../db/pool.js";
import { detectReorg, getCursor, indexOnce, setCursor } from "../indexer/poller.js";
import { realisedOutFromLogs } from "../indexer/project.js";
import { createSession, markActive } from "../sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const ACCOUNT = `0x${"c3".repeat(20)}` as Address;
const USDC = `0x${"f6".repeat(20)}` as Address;
const WETH = `0x${"e7".repeat(20)}` as Address;
const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const LOGGED_TOPIC = keccak256(toHex("Logged(address,bytes32,bytes32,bytes32,uint32,uint64)"));

function pad(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function transferLog(token: Address, to: Address, value: bigint): { address: string; data: Hex; topics: Hex[] } {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(`0x${"aa".repeat(20)}`), pad(to)],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

function loggedLog(account: Address, intentHash: Hex, blockNumber: bigint, txHash: Hex, logIndex: number) {
  return {
    address: BASE_SEPOLIA.corralJournal.address,
    topics: [LOGGED_TOPIC, pad(account), pad(`0x${"e5".repeat(32)}`.slice(0, 42)), intentHash],
    data: encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint32" }, { type: "uint64" }],
      [`0x${"11".repeat(32)}`, 1, 1_756_600_000n],
    ),
    blockNumber,
    transactionHash: txHash,
    logIndex,
    args: { account, intentHash, sessionId: `0x${"e5".repeat(32)}` as Hex },
  };
}

interface ChainOpts {
  head: bigint;
  blockHashes?: Record<string, Hex>;
  logs?: ReturnType<typeof loggedLog>[];
  receiptLogs?: { address: string; data: Hex; topics: Hex[] }[];
  receiptStatus?: "success" | "reverted";
  gasUsed?: bigint;
  gasPrice?: bigint;
}

function fakeChain(opts: ChainOpts): PublicClient {
  const hashFor = (n: bigint): Hex => opts.blockHashes?.[n.toString(10)] ?? (`0x${n.toString(16).padStart(64, "0")}` as Hex);
  return {
    chain: { id: 84532 },
    async getBlockNumber() {
      return opts.head;
    },
    async getBlock({ blockNumber, blockHash }: { blockNumber?: bigint; blockHash?: Hex }) {
      const n = blockNumber ?? 100n;
      return { hash: blockHash ?? hashFor(n), number: n, timestamp: 1_756_600_000n };
    },
    async getLogs() {
      return opts.logs ?? [];
    },
    async getTransactionReceipt() {
      return {
        status: opts.receiptStatus ?? "success",
        blockNumber: 100n,
        blockHash: hashFor(100n),
        gasUsed: opts.gasUsed ?? 180_000n,
        effectiveGasPrice: opts.gasPrice ?? 1_500_000n,
        logs: opts.receiptLogs ?? [],
        transactionHash: `0x${"ab".repeat(32)}`,
      };
    },
  } as unknown as PublicClient;
}

// ── Realised output: unit, no database ──────────────────────────────────────

describe("realised output is read from Transfer logs, not from the router", () => {
  it("sums every transfer crediting the account", () => {
    // A two-hop route credits twice. Taking only the first would understate
    // the fill and invent slippage that never happened.
    const out = realisedOutFromLogs(
      [transferLog(WETH, ACCOUNT, 600n), transferLog(WETH, ACCOUNT, 400n)],
      WETH,
      ACCOUNT,
    );
    expect(out).toBe(1000n);
  });

  it("ignores transfers of the same token to somebody else", () => {
    const out = realisedOutFromLogs(
      [transferLog(WETH, ACCOUNT, 600n), transferLog(WETH, `0x${"99".repeat(20)}` as Address, 400n)],
      WETH,
      ACCOUNT,
    );
    expect(out).toBe(600n);
  });

  it("ignores transfers of a different token", () => {
    const out = realisedOutFromLogs([transferLog(USDC, ACCOUNT, 600n)], WETH, ACCOUNT);
    expect(out).toBe(0n);
  });

  it("reports zero rather than throwing when nothing arrived", () => {
    // Zero is a fact worth recording: it means the trade did not deliver.
    expect(realisedOutFromLogs([], WETH, ACCOUNT)).toBe(0n);
  });

  it("survives an undecodable log on the token's own address", () => {
    const junk = { address: WETH, topics: [TRANSFER_TOPIC] as Hex[], data: "0x" as Hex };
    expect(realisedOutFromLogs([junk, transferLog(WETH, ACCOUNT, 5n)], WETH, ACCOUNT)).toBe(5n);
  });
});

// ── Indexer ─────────────────────────────────────────────────────────────────

describe.skipIf(!TEST_DB)("indexer", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["DATABASE_SCHEMA"] = "corral_test_indexer";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_indexer");
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query(
      "TRUNCATE corral_events, corral_indexer_cursor, corral_relayer_txs, corral_anomalies, corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE",
    );
  });

  async function seedExecution(intentHash: Hex, quotedOut: string): Promise<{ sessionId: string; executionId: string }> {
    const now = Math.floor(Date.now() / 1000);
    const s = await createSession({
      chainId: 84532,
      account: ACCOUNT,
      owner: `0x${"a1".repeat(20)}`,
      agentSigner: `0x${"d4".repeat(20)}`,
      permissionId: `0x${"e5".repeat(32)}`,
      policy: { min_output_bps: 9800 },
      validAfter: now - 60,
      validUntil: now + 86_400,
    });
    await markActive(s.id, `0x${"0".repeat(64)}`);
    const rows = await query<{ id: string }>(
      `INSERT INTO corral_executions
         (session_id, seq, scheduled_for, idempotency_key, status, intent_hash, tx_hash,
          asset_in, amount_in, asset_out, quoted_out, venue)
       VALUES ($1, 1, now(), $2, 'SUBMITTED', $3, $4, $5, '125000000', $6, $7, 'uniswap-v3')
       RETURNING id`,
      [s.id, `k-${intentHash}`, intentHash, `0x${"ab".repeat(32)}`, USDC, WETH, quotedOut],
    );
    return { sessionId: s.id, executionId: rows[0]?.id ?? "" };
  }

  it("stays behind the head by the confirmation depth", async () => {
    // An unconfirmed feed entry is right almost always, and the one time it
    // isn't, a user has already read it.
    await indexOnce(fakeChain({ head: 100n }), BASE_SEPOLIA);
    const cursor = await getCursor(84532);
    expect(cursor?.blockNumber).toBe(95n);
  });

  it("projects a journalled execution into the feed with real slippage", async () => {
    const intentHash = `0x${"77".repeat(32)}` as Hex;
    const { executionId } = await seedExecution(intentHash, "1000000000000000000");
    await indexOnce(
      fakeChain({
        head: 200n,
        logs: [loggedLog(ACCOUNT, intentHash, 100n, `0x${"ab".repeat(32)}`, 3)],
        // Quoted 1.0, delivered 0.998 → 20bps of real slippage.
        receiptLogs: [transferLog(WETH, ACCOUNT, 998_000_000_000_000_000n)],
      }),
      BASE_SEPOLIA,
    );

    const rows = await query<{ realised_out: string; slippage_bps: number; gas_cost_wei: string }>(
      `SELECT realised_out, slippage_bps, gas_cost_wei FROM corral_executions WHERE id = $1`,
      [executionId],
    );
    expect(rows[0]?.realised_out).toBe("998000000000000000");
    expect(rows[0]?.slippage_bps).toBe(20);
    expect(rows[0]?.gas_cost_wei).toBe("270000000000");

    const events = await query<{ kind: string; payload: Record<string, unknown> }>(
      `SELECT kind, payload FROM corral_events WHERE execution_id = $1`,
      [executionId],
    );
    expect(events[0]?.kind).toBe("EXECUTION_SUCCEEDED");
  });

  it("keeps gas out of the swap detail entirely (FR-6.5)", async () => {
    const intentHash = `0x${"78".repeat(32)}` as Hex;
    const { executionId } = await seedExecution(intentHash, "1000000000000000000");
    await indexOnce(
      fakeChain({
        head: 200n,
        logs: [loggedLog(ACCOUNT, intentHash, 100n, `0x${"ab".repeat(32)}`, 3)],
        receiptLogs: [transferLog(WETH, ACCOUNT, 1_000_000_000_000_000_000n)],
      }),
      BASE_SEPOLIA,
    );
    const events = await query<{ payload: { swap: Record<string, unknown>; gas: Record<string, unknown> } }>(
      `SELECT payload FROM corral_events WHERE execution_id = $1`,
      [executionId],
    );
    const payload = events[0]?.payload;
    expect(payload?.gas).toBeTruthy();
    expect(Object.keys(payload?.swap ?? {})).not.toContain("gasUsed");
    expect(Object.keys(payload?.swap ?? {})).not.toContain("costWei");
  });

  it("re-indexing the same log updates rather than duplicating", async () => {
    const intentHash = `0x${"79".repeat(32)}` as Hex;
    const { executionId } = await seedExecution(intentHash, "1000000000000000000");
    const chain = fakeChain({
      head: 200n,
      logs: [loggedLog(ACCOUNT, intentHash, 100n, `0x${"ab".repeat(32)}`, 3)],
      receiptLogs: [transferLog(WETH, ACCOUNT, 998_000_000_000_000_000n)],
    });
    await indexOnce(chain, BASE_SEPOLIA);
    await query(`DELETE FROM corral_indexer_cursor`);
    await indexOnce(chain, BASE_SEPOLIA);

    const rows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM corral_events WHERE execution_id = $1`,
      [executionId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("ignores a journal entry that belongs to somebody else's account", async () => {
    // The journal has no access control by design; consumers filter.
    await indexOnce(
      fakeChain({
        head: 200n,
        logs: [loggedLog(`0x${"99".repeat(20)}` as Address, `0x${"7a".repeat(32)}` as Hex, 100n, `0x${"cd".repeat(32)}`, 1)],
      }),
      BASE_SEPOLIA,
    );
    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_events`);
    expect(rows[0]?.n).toBe("0");
  });

  it("detects that the chain changed its mind about the last indexed block", async () => {
    const chain = fakeChain({ head: 200n, blockHashes: { "100": `0x${"ff".repeat(32)}` } });
    expect(await detectReorg(chain, { blockNumber: 100n, blockHash: `0x${"ff".repeat(32)}` })).toBe(false);
    expect(await detectReorg(chain, { blockNumber: 100n, blockHash: `0x${"00".repeat(32)}` })).toBe(true);
  });

  it("rewinds and re-indexes when the cursor's block no longer matches", async () => {
    await setCursor(84532, { blockNumber: 100n, blockHash: `0x${"00".repeat(32)}` });
    const result = await indexOnce(fakeChain({ head: 200n }), BASE_SEPOLIA);
    expect(result.rewound).toBe(true);
    expect(result.from).toBe(70n); // 100 − REWIND_BLOCKS
  });

  it("treats an unreadable block as a reorg rather than pressing on", async () => {
    // Re-indexing a few blocks is cheap; a rolled-back trade in someone's
    // feed is not.
    const chain = {
      ...fakeChain({ head: 200n }),
      async getBlock({ blockNumber }: { blockNumber?: bigint }) {
        if (blockNumber === 100n) throw new Error("unknown block");
        return { hash: `0x${"aa".repeat(32)}`, number: blockNumber ?? 0n, timestamp: 1n };
      },
    } as unknown as PublicClient;
    await setCursor(84532, { blockNumber: 100n, blockHash: `0x${"aa".repeat(32)}` });
    const result = await indexOnce(chain, BASE_SEPOLIA);
    expect(result.rewound).toBe(true);
  });

  it("advances the cursor with the hash of the block it stopped at", async () => {
    await indexOnce(fakeChain({ head: 500n, blockHashes: { "495": `0x${"be".repeat(32)}` } }), BASE_SEPOLIA);
    const cursor = await getCursor(84532);
    expect(cursor?.blockHash).toBe(`0x${"be".repeat(32)}`);
  });

  it("bounds how many blocks one pass covers", async () => {
    // A cold start on a long-lived chain must not try to read it all at once.
    const result = await indexOnce(fakeChain({ head: 1_000_000n }), BASE_SEPOLIA, {
      startBlock: 0n,
      maxBlocks: 1_000n,
    });
    expect(result.to).toBe(1_000n);
  });
});
