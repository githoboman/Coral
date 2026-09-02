/**
 * Integration tests for the execution engine's persistence (spec §6.3, §7, §10.2).
 *
 * Needs a real Postgres — `FOR UPDATE SKIP LOCKED`, unique indexes and
 * transactional visibility are exactly what is under test, so an in-memory
 * emulator would prove nothing. Set `TEST_DATABASE_URL` (CI and the local
 * docker container both do); the suite skips loudly without it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, query } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { claimExecutionSlot, findInFlight, idempotencyKey, markSimulated, markSubmitted } from "../executions/ledger.js";
import { backoffMs, claim, complete, depth, enqueue, fail, reapStale } from "../jobs/queue.js";
import { createSession, disableSigner, getSession, isExecutable, markActive, setStatus, type SessionRow } from "../sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
if (!TEST_DB) console.warn("[corral-db] TEST_DATABASE_URL not set — persistence integration tests skipped");

let n = 0;
async function freshSession(): Promise<SessionRow> {
  n += 1;
  const now = Math.floor(Date.now() / 1000);
  return createSession({
    chainId: 84532,
    account: `0x${n.toString(16).padStart(40, "0")}`,
    owner: `0x${"1".repeat(40)}`,
    agentSigner: `0x${"2".repeat(40)}`,
    permissionId: `0x${n.toString(16).padStart(64, "0")}`,
    policy: { version: 1 },
    validAfter: now - 60,
    validUntil: now + 86_400,
  });
}

describe.skipIf(!TEST_DB)("corral persistence", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    // Own schema: parallel test files must not share tables.
    process.env["DATABASE_SCHEMA"] = "corral_test_db";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_db");
    await runMigrations();
    await query("TRUNCATE corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE");
  });
  // `claim()` is global by design (a worker takes the oldest due job on any
  // session), so each test needs a queue of its own to assert against.
  beforeEach(async () => {
    await query("TRUNCATE corral_jobs CASCADE");
  });
  afterAll(async () => {
    await closePool();
  });

  describe("migrations", () => {
    it("are idempotent — a second run applies nothing", async () => {
      const again = await runMigrations();
      expect(again.every((m) => m.alreadyApplied)).toBe(true);
    });
  });

  describe("job queue", () => {
    it("enqueue → claim → complete, and a claimed job is invisible to others", async () => {
      const s = await freshSession();
      await enqueue({ kind: "execution.run", sessionId: s.id, payload: { a: 1 } });
      const job = await claim("worker-a");
      expect(job?.kind).toBe("execution.run");
      expect(job?.attempt).toBe(1);
      expect(await claim("worker-b")).toBeNull(); // same session is busy
      await complete(job!.id);
      expect((await depth()).running).toBe(0);
    });

    it("dedupe_key keeps exactly one live job", async () => {
      const s = await freshSession();
      const first = await enqueue({ kind: "strategy.tick", sessionId: s.id, dedupeKey: `tick:${s.id}:slot-1` });
      const second = await enqueue({ kind: "strategy.tick", sessionId: s.id, dedupeKey: `tick:${s.id}:slot-1` });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("a future run_at is not claimable yet", async () => {
      const s = await freshSession();
      await enqueue({ kind: "later", sessionId: s.id, runInMs: 60_000 });
      expect(await claim("worker-a")).toBeNull();
    });

    it("fail() reschedules until max_attempts, then dead-letters", async () => {
      const s = await freshSession();
      await enqueue({ kind: "flaky", sessionId: s.id, maxAttempts: 2 });
      const j1 = await claim("w");
      expect(await fail(j1!.id, "boom", 0)).toBe("PENDING");
      const j2 = await claim("w");
      expect(j2!.attempt).toBe(2);
      expect(await fail(j2!.id, "boom again", 0)).toBe("DEAD");
      expect(await claim("w")).toBeNull();
    });

    it("a terminal failure (retryInMs = null) dead-letters immediately — policy rejections are never retried", async () => {
      const s = await freshSession();
      await enqueue({ kind: "policy-reject", sessionId: s.id, maxAttempts: 5 });
      const j = await claim("w");
      expect(await fail(j!.id, "POLICY_BUDGET_EXCEEDED", null)).toBe("DEAD");
    });

    it("the visibility-timeout reaper returns a dead worker's job to the queue", async () => {
      const s = await freshSession();
      await enqueue({ kind: "orphan", sessionId: s.id });
      const j = await claim("worker-that-dies");
      expect(j).not.toBeNull();
      // Simulate a worker that died 10 minutes ago.
      await query(`UPDATE corral_jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1`, [j!.id]);
      expect(await reapStale(60_000)).toBe(1);
      const again = await claim("worker-b");
      expect(again?.id).toBe(j!.id);
      await complete(again!.id);
    });

    it("backoff is bounded and jittered", () => {
      for (let attempt = 1; attempt <= 12; attempt++) {
        const d = backoffMs(attempt, 1000, 60_000);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(60_000);
      }
    });
  });

  describe("per-session concurrency (NFR-7, spec §10.2)", () => {
    it("50 racing workers claim at most ONE job for the same session", async () => {
      const s = await freshSession();
      for (let i = 0; i < 20; i++) await enqueue({ kind: "execution.run", sessionId: s.id, payload: { i } });

      const claimed = (await Promise.all(Array.from({ length: 50 }, (_, i) => claim(`racer-${i}`)))).filter((j) => j !== null);
      expect(claimed).toHaveLength(1);

      // The database itself refuses a second RUNNING row for that session.
      await expect(
        query(`UPDATE corral_jobs SET status = 'RUNNING' WHERE session_id = $1 AND status = 'PENDING'`, [s.id]),
      ).rejects.toMatchObject({ code: "23505" });

      await complete(claimed[0]!.id);
      const next = await claim("racer-after");
      expect(next).not.toBeNull();
      await complete(next!.id);
    });

    it("different sessions still run in parallel — the limit is per session, not global", async () => {
      const [a, b, c] = await Promise.all([freshSession(), freshSession(), freshSession()]);
      for (const s of [a, b, c]) await enqueue({ kind: "execution.run", sessionId: s.id });
      const claimed = (await Promise.all([claim("w1"), claim("w2"), claim("w3")])).filter((j) => j !== null);
      expect(claimed).toHaveLength(3);
      expect(new Set(claimed.map((j) => j!.session_id)).size).toBe(3);
      for (const j of claimed) await complete(j!.id);
    });
  });

  describe("execution ledger — the commit point (spec §7 step 8)", () => {
    it("30 concurrent attempts on the same slot yield exactly one execution", async () => {
      const s = await freshSession();
      const slot = { sessionId: s.id, strategyId: null, scheduledFor: new Date("2026-09-01T12:00:00Z"), seq: 1 };
      const results = await Promise.all(Array.from({ length: 30 }, () => claimExecutionSlot(slot)));
      const won = results.filter((r) => r !== null);
      expect(won).toHaveLength(1);
      expect(won[0]!.idempotency_key).toBe(idempotencyKey(slot));
      const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_executions WHERE session_id = $1`, [s.id]);
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("a different slot (next seq or next schedule) is a different execution", async () => {
      const s = await freshSession();
      const base = { sessionId: s.id, strategyId: null, scheduledFor: new Date("2026-09-01T12:00:00Z") };
      expect(await claimExecutionSlot({ ...base, seq: 1 })).not.toBeNull();
      expect(await claimExecutionSlot({ ...base, seq: 2 })).not.toBeNull();
      expect(await claimExecutionSlot({ ...base, scheduledFor: new Date("2026-09-08T12:00:00Z"), seq: 1 })).not.toBeNull();
      expect(await claimExecutionSlot({ ...base, seq: 1 })).toBeNull(); // the original slot stays taken
    });

    it("in-flight rows are discoverable for recovery", async () => {
      const s = await freshSession();
      const ex = await claimExecutionSlot({ sessionId: s.id, strategyId: null, scheduledFor: new Date(), seq: 99 });
      await markSimulated(ex!.id, {
        plan: { chain_id: 84532 },
        intentHash: `0x${"a".repeat(64)}`,
        callDataHash: `0x${"b".repeat(64)}`,
        assetIn: `0x${"c".repeat(40)}`,
        amountIn: 200_000n,
        assetOut: `0x${"d".repeat(40)}`,
        quotedOut: 1_367_911_410_436_060n,
        venue: "uniswap-v3/3000",
      });
      await markSubmitted(ex!.id, `0x${"e".repeat(64)}`, null);
      await query(`UPDATE corral_executions SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [ex!.id]);
      const stuck = await findInFlight(60_000);
      expect(stuck.map((r) => r.id)).toContain(ex!.id);
      // Amounts survive the numeric(78,0) round trip exactly.
      const row = await query<{ amount_in: string; quoted_out: string }>(`SELECT amount_in, quoted_out FROM corral_executions WHERE id = $1`, [ex!.id]);
      expect(row[0]!.amount_in).toBe("200000");
      expect(row[0]!.quoted_out).toBe("1367911410436060");
    });

    it("stores a full-range uint256 amount without loss", async () => {
      const s = await freshSession();
      const ex = await claimExecutionSlot({ sessionId: s.id, strategyId: null, scheduledFor: new Date(), seq: 1 });
      const max = (1n << 256n) - 1n;
      await markSimulated(ex!.id, {
        plan: {}, intentHash: `0x${"0".repeat(64)}`, callDataHash: `0x${"0".repeat(64)}`,
        assetIn: `0x${"0".repeat(40)}`, amountIn: max, assetOut: `0x${"0".repeat(40)}`, quotedOut: max, venue: "v",
      });
      const row = await query<{ amount_in: string }>(`SELECT amount_in FROM corral_executions WHERE id = $1`, [ex!.id]);
      expect(BigInt(row[0]!.amount_in)).toBe(max);
    });
  });

  describe("session gate (FR-8.2, SEC-14)", () => {
    it("disableSigner makes a session non-executable immediately, before any on-chain revoke", async () => {
      const s = await freshSession();
      await markActive(s.id, `0x${"f".repeat(64)}`);
      const active = await getSession(s.id);
      expect(isExecutable(active!)).toStrictEqual({ ok: true });

      const t0 = Date.now();
      const disabled = await disableSigner(s.id);
      const elapsed = Date.now() - t0;
      expect(disabled!.signer_disabled).toBe(true);
      expect(elapsed).toBeLessThan(1000); // NFR-3: off-chain disable in under a second
      expect(isExecutable(disabled!).ok).toBe(false);
    });

    it("refuses outside the validity window and in any non-ACTIVE state", async () => {
      const s = await freshSession();
      await markActive(s.id, "0x");
      const row = (await getSession(s.id))!;
      expect(isExecutable(row, Number(row.valid_after) - 1).ok).toBe(false);
      expect(isExecutable(row, Number(row.valid_until) + 1).ok).toBe(false);
      await setStatus(s.id, "PAUSED_DRIFT");
      expect(isExecutable((await getSession(s.id))!).ok).toBe(false);
    });
  });
});
