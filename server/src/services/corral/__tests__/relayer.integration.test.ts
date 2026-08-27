/**
 * I-402 acceptance — the nonce allocator, over-tested on purpose.
 *
 * CLAUDE.md §8.3: "a nonce gap stalls every user's executions simultaneously,
 * and it's the kind of bug that appears only under concurrency in production."
 * So the assertions here are about what must be true under contention:
 * allocations are unique, contiguous, never rewound, and a crashed worker's
 * hole is reclaimed rather than left to block everything behind it.
 *
 * Runs against a real Postgres (`TEST_DATABASE_URL`); skipped without one,
 * because these guarantees ARE Postgres guarantees and a mock would prove
 * nothing about them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../db/migrate.js";
import { closePool, query } from "../db/pool.js";
import {
  bumpFees,
  feeCeilingWei,
  FeeCeilingExceeded,
  initialFees,
  isValidReplacement,
  MIN_BUMP_PCT,
} from "../relayer/fees.js";
import {
  abandon,
  allocateNonce,
  findStuck,
  headOfLine,
  inFlightCount,
  markSent,
  markSettled,
} from "../relayer/nonces.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const CHAIN = 84532;
const RELAYER = `0x${"ab".repeat(20)}`;
const OTHER_RELAYER = `0x${"cd".repeat(20)}`;

describe.skipIf(!TEST_DB)("relayer nonce allocator (I-402)", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["DATABASE_SCHEMA"] = "corral_test_relayer";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_relayer");
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query("TRUNCATE corral_relayer_txs, corral_relayer_nonces CASCADE");
  });

  it("hands out contiguous nonces starting from the chain's pending count", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 7n });
    const b = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 7n });
    const c = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 7n });
    expect([a.nonce, b.nonce, c.nonce]).toEqual([7n, 8n, 9n]);
  });

  it("50 racing workers get 50 distinct, contiguous nonces — no duplicate, no gap", async () => {
    // The failure this guards against is silent: two workers both broadcast
    // with nonce N, one is dropped as a duplicate, and its user's execution
    // vanishes without an error anywhere.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 100n })),
    );
    const nonces = results.map((r) => r.nonce).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(new Set(nonces.map(String)).size).toBe(50);
    expect(nonces[0]).toBe(100n);
    expect(nonces[49]).toBe(149n);
    for (let i = 1; i < nonces.length; i++) {
      expect(nonces[i]).toBe((nonces[i - 1] as bigint) + 1n);
    }
  });

  it("never rewinds when the chain reports a lower pending count", async () => {
    // A lagging RPC replica reporting an old count must not cause us to
    // re-issue a nonce that is already in flight — that would replace a live
    // transaction with an unrelated one.
    await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 40n });
    await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 40n });
    const third = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 5n });
    expect(third.nonce).toBe(42n);
  });

  it("jumps forward when the chain is ahead of the stored counter", async () => {
    // Something submitted outside this allocator (a manual transaction, a
    // restored backup). Following the chain is the only safe direction.
    await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 3n });
    const next = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 90n });
    expect(next.nonce).toBe(90n);
  });

  it("keeps separate counters per relayer and per chain", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 10n });
    const b = await allocateNonce({ chainId: CHAIN, relayer: OTHER_RELAYER, chainPendingNonce: 0n });
    const c = await allocateNonce({ chainId: 8453, relayer: RELAYER, chainPendingNonce: 0n });
    expect(a.nonce).toBe(10n);
    expect(b.nonce).toBe(0n);
    expect(c.nonce).toBe(0n);
  });

  it("refuses two live claims on the same nonce", async () => {
    // The unique partial index is the guarantee; the allocator's lock is the
    // optimisation. Assert the guarantee directly.
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 1n });
    await expect(
      query(`INSERT INTO corral_relayer_txs (chain_id, relayer, nonce, status) VALUES ($1, $2, $3, 'ALLOCATED')`, [
        CHAIN,
        RELAYER.toLowerCase(),
        a.nonce.toString(10),
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("reuses a settled nonce slot for a new row once it is no longer live", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 1n });
    await markSettled(a.id, "MINED");
    // Same nonce, now permitted because the earlier claim is not live.
    await expect(
      query(`INSERT INTO corral_relayer_txs (chain_id, relayer, nonce, status) VALUES ($1, $2, $3, 'MINED')`, [
        CHAIN,
        RELAYER.toLowerCase(),
        a.nonce.toString(10),
      ]),
    ).resolves.toBeDefined();
  });

  it("reclaims a hole left by a worker that died between allocating and sending", async () => {
    // Without this the nonce is burned, and every allocation after it waits
    // behind a transaction that will never exist.
    const dead = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 20n });
    await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 20n });
    await query(`UPDATE corral_relayer_txs SET allocated_at = now() - interval '10 minutes' WHERE id = $1`, [dead.id]);

    const reclaimed = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 20n });
    expect(reclaimed.reclaimed).toBe(true);
    expect(reclaimed.nonce).toBe(dead.nonce);
    expect(reclaimed.id).toBe(dead.id);
  });

  it("does not reclaim an allocation that is still fresh", async () => {
    const fresh = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 30n });
    const next = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 30n });
    expect(next.reclaimed).toBe(false);
    expect(next.nonce).toBe(fresh.nonce + 1n);
  });

  it("does not reclaim a nonce that was already broadcast", async () => {
    // A sent-but-unmined transaction is not a hole. Reusing its nonce for
    // different calldata is a replacement, and an accidental one at that.
    const sent = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 50n });
    await markSent(sent.id, `0x${"11".repeat(32)}`, { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
    await query(`UPDATE corral_relayer_txs SET allocated_at = now() - interval '10 minutes' WHERE id = $1`, [sent.id]);

    const next = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 50n });
    expect(next.reclaimed).toBe(false);
    expect(next.nonce).toBe(51n);
  });

  it("abandoning frees the nonce for immediate reuse", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 60n });
    await abandon(a.id, "simulation failed after allocation");
    // The chain still reports 60 pending, and nothing live holds it.
    const b = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 60n });
    expect(b.nonce).toBe(61n);
    expect(await inFlightCount(CHAIN, RELAYER)).toBe(1);
  });

  it("reports the head-of-line nonce — the number to alert on", async () => {
    const first = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 70n });
    await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 70n });
    expect((await headOfLine(CHAIN, RELAYER))?.id).toBe(first.id);
    await markSettled(first.id, "MINED");
    expect((await headOfLine(CHAIN, RELAYER))?.nonce).toBe("71");
  });

  it("finds transactions stuck past the replacement threshold, lowest nonce first", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 80n });
    const b = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 80n });
    await markSent(a.id, `0x${"aa".repeat(32)}`, { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
    await markSent(b.id, `0x${"bb".repeat(32)}`, { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
    await query(`UPDATE corral_relayer_txs SET sent_at = now() - interval '5 minutes' WHERE id = $1`, [a.id]);

    const stuck = await findStuck(CHAIN, RELAYER, 60_000);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.id).toBe(a.id);
  });

  it("records fees as exact wei integers, not floats", async () => {
    const a = await allocateNonce({ chainId: CHAIN, relayer: RELAYER, chainPendingNonce: 0n });
    const huge = 123_456_789_012_345_678_901n;
    await markSent(a.id, `0x${"cc".repeat(32)}`, { maxFeePerGas: huge, maxPriorityFeePerGas: 1n });
    const rows = await query<{ max_fee: string }>(`SELECT max_fee FROM corral_relayer_txs WHERE id = $1`, [a.id]);
    expect(BigInt(rows[0]?.max_fee ?? "0")).toBe(huge);
  });
});

// ── Fees: unit, no database ─────────────────────────────────────────────────

describe("replacement fee bumping (I-403)", () => {
  it("always satisfies the node's 10% replacement rule", () => {
    const previous = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
    const next = bumpFees(previous, { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, 10_000_000_000n);
    expect(isValidReplacement(previous, next)).toBe(true);
  });

  it("bumps from the PREVIOUS attempt even when the market has fallen", () => {
    // Nodes compare a replacement against the original transaction's fees,
    // not against the current market. Pricing off the market alone produces a
    // replacement the node rejects, leaving the nonce stuck.
    const previous = { maxFeePerGas: 5_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };
    const next = bumpFees(previous, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }, 10_000_000_000n);
    expect(next.maxFeePerGas).toBeGreaterThan(previous.maxFeePerGas);
    expect(next.maxPriorityFeePerGas).toBeGreaterThan(previous.maxPriorityFeePerGas);
    expect(isValidReplacement(previous, next)).toBe(true);
  });

  it("follows the market up when it has risen past the bump", () => {
    const previous = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };
    const next = bumpFees(previous, { maxFeePerGas: 9_000_000n, maxPriorityFeePerGas: 900_000n }, 10_000_000_000n);
    expect(next.maxFeePerGas).toBe(9_000_000n);
  });

  it("rounds the bump up, never down", () => {
    // A one-wei rounding error under the threshold is rejected outright.
    const previous = { maxFeePerGas: 7n, maxPriorityFeePerGas: 7n };
    const next = bumpFees(previous, { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, 10_000n);
    expect(next.maxFeePerGas * 100n).toBeGreaterThanOrEqual(previous.maxFeePerGas * (100n + MIN_BUMP_PCT));
  });

  it("stops at the ceiling instead of escalating without limit", () => {
    const previous = { maxFeePerGas: 1_000n, maxPriorityFeePerGas: 10n };
    expect(() => bumpFees(previous, { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, 1_000n)).toThrow(FeeCeilingExceeded);
  });

  it("keeps maxFee at or above the priority fee in every path", () => {
    const previous = { maxFeePerGas: 100n, maxPriorityFeePerGas: 90n };
    const next = bumpFees(previous, { maxFeePerGas: 0n, maxPriorityFeePerGas: 10_000n }, 1_000_000n);
    expect(next.maxFeePerGas).toBeGreaterThanOrEqual(next.maxPriorityFeePerGas);
  });

  it("gives a first attempt headroom above the current base fee", () => {
    const fees = initialFees({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n });
    expect(fees.maxFeePerGas).toBeGreaterThan(1_000_000n);
    expect(fees.maxPriorityFeePerGas).toBe(100_000n);
  });

  it("reads its ceiling from configuration and rejects a non-integer", () => {
    const before = process.env["RELAYER_MAX_FEE_WEI"];
    process.env["RELAYER_MAX_FEE_WEI"] = "12345";
    expect(feeCeilingWei()).toBe(12_345n);
    process.env["RELAYER_MAX_FEE_WEI"] = "1.5 gwei";
    expect(() => feeCeilingWei()).toThrow();
    if (before === undefined) delete process.env["RELAYER_MAX_FEE_WEI"];
    else process.env["RELAYER_MAX_FEE_WEI"] = before;
  });
});
