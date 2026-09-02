/**
 * The safety jobs: stranded-execution recovery (C-504), module-set monitoring
 * (C-506, FR-1.5) and anomaly detection (C-902, SEC-9).
 *
 * The common theme, and the reason all three live in one suite: each one
 * exists for a failure the on-chain policies do not object to. A stranded
 * execution is a budget the chain already spent and the mirror still shows as
 * free. A second validator is a policy bypass the policy cannot see. A burst
 * of legitimate executions is a month of budget spent in an hour, with every
 * individual step permitted.
 */
import type { Address, PublicClient } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BASE_SEPOLIA } from "../../evm/addresses.js";
import { runMigrations } from "../db/migrate.js";
import { closePool, query } from "../db/pool.js";
import { monitorSession, snapshotModules } from "../jobs/moduleMonitor.js";
import { findStranded, recoverExecution } from "../jobs/recover.js";
import { DEFAULT_THRESHOLDS, detectAnomalies, detectAndPause } from "../reconcile/anomalies.js";
import { createSession, getSession, markActive } from "../sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const ACCOUNT = `0x${"c3".repeat(20)}` as Address;
const USDC = `0x${"f6".repeat(20)}`;

/** A chain that reports whatever the test needs, and nothing else. */
function fakeChain(opts: {
  receipt?: { status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint; logs: unknown[] } | "unknown";
  validators?: Address[] | "unsupported";
  installed?: Record<string, boolean>;
}): PublicClient {
  return {
    chain: { id: 84532 },
    async getTransactionReceipt() {
      if (!opts.receipt || opts.receipt === "unknown") throw new Error("transaction not found");
      return { ...opts.receipt, transactionHash: `0x${"ab".repeat(32)}` };
    },
    async readContract({ functionName, args }: { functionName: string; args: readonly unknown[] }) {
      if (functionName === "getValidatorsPaginated") {
        if (!opts.validators || opts.validators === "unsupported") throw new Error("not supported");
        return [opts.validators, "0x0000000000000000000000000000000000000001"];
      }
      if (functionName === "isModuleInstalled") {
        const module = String(args[1]).toLowerCase();
        return opts.installed?.[module] ?? true;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
}

async function newSession(): Promise<string> {
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
  return s.id;
}

describe.skipIf(!TEST_DB)("safety jobs", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["DATABASE_SCHEMA"] = "corral_test_safety";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_safety");
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query(
      "TRUNCATE corral_relayer_txs, corral_anomalies, corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE",
    );
  });

  // ── C-504: stranded executions ────────────────────────────────────────────

  describe("stranded execution recovery (C-504)", () => {
    async function stranded(txHash: string | null, ageMinutes: number): Promise<string> {
      const sessionId = await newSession();
      const rows = await query<{ id: string }>(
        `INSERT INTO corral_executions (session_id, seq, scheduled_for, idempotency_key, status, tx_hash, updated_at)
         VALUES ($1, 1, now(), $2, 'SUBMITTED', $3, now() - make_interval(mins => $4))
         RETURNING id`,
        [sessionId, `key-${String(ageMinutes)}-${txHash ?? "none"}`, txHash, ageMinutes],
      );
      return rows[0]?.id ?? "";
    }

    it("finds only rows older than the threshold", async () => {
      await stranded(`0x${"11".repeat(32)}`, 30);
      await stranded(`0x${"22".repeat(32)}`, 0);
      const found = await findStranded(10 * 60_000);
      expect(found).toHaveLength(1);
    });

    it("records the real outcome when the transaction landed", async () => {
      const id = await stranded(`0x${"11".repeat(32)}`, 30);
      const row = (await findStranded(60_000))[0];
      expect(row).toBeDefined();
      const out = await recoverExecution(
        fakeChain({ receipt: { status: "success", blockNumber: 42n, gasUsed: 100n, logs: [] } }),
        BASE_SEPOLIA,
        row!,
      );
      // No UserOperationEvent in the logs, so the op did not succeed even
      // though the transaction did — the two are never conflated.
      expect(out.resolution).toBe("FAILED");
      const after = await query<{ status: string; block_number: string }>(
        `SELECT status, block_number FROM corral_executions WHERE id = $1`,
        [id],
      );
      expect(after[0]?.block_number).toBe("42");
    });

    it("leaves a recent unmined transaction alone rather than guessing", async () => {
      await stranded(`0x${"33".repeat(32)}`, 3);
      const row = (await findStranded(60_000))[0];
      const out = await recoverExecution(fakeChain({ receipt: "unknown" }), BASE_SEPOLIA, row!, 30 * 60_000);
      expect(out.resolution).toBe("STILL_PENDING");
    });

    it("closes a long-dropped transaction and raises an anomaly", async () => {
      const id = await stranded(`0x${"44".repeat(32)}`, 90);
      const row = (await findStranded(60_000))[0];
      const out = await recoverExecution(fakeChain({ receipt: "unknown" }), BASE_SEPOLIA, row!, 30 * 60_000);
      expect(out.resolution).toBe("ABANDONED");
      const status = await query<{ status: string }>(`SELECT status FROM corral_executions WHERE id = $1`, [id]);
      expect(status[0]?.status).toBe("ABORTED");
      const anomalies = await query<{ kind: string }>(`SELECT kind FROM corral_anomalies`);
      expect(anomalies.map((a) => a.kind)).toContain("EXECUTION_ABANDONED");
    });

    it("closes a row that was never broadcast at all", async () => {
      await stranded(null, 90);
      const row = (await findStranded(60_000))[0];
      const out = await recoverExecution(fakeChain({}), BASE_SEPOLIA, row!, 30 * 60_000);
      expect(out.resolution).toBe("ABANDONED");
    });

    it("never re-submits — recovery only reads and records", async () => {
      // A chain with no write surface at all: if recovery tried to submit,
      // this would throw rather than pass.
      const id = await stranded(`0x${"55".repeat(32)}`, 90);
      const row = (await findStranded(60_000))[0];
      await recoverExecution(fakeChain({ receipt: "unknown" }), BASE_SEPOLIA, row!, 30 * 60_000);
      const rows = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM corral_executions WHERE session_id = (SELECT session_id FROM corral_executions WHERE id = $1)`,
        [id],
      );
      expect(rows[0]?.n).toBe("1");
    });
  });

  // ── C-506 / FR-1.5: module set ────────────────────────────────────────────

  describe("module-set monitoring (FR-1.5)", () => {
    it("is quiet when exactly the expected validators are installed", async () => {
      const sessionId = await newSession();
      const session = await getSession(sessionId);
      const result = await monitorSession(
        fakeChain({ validators: [BASE_SEPOLIA.smartSessions.address, BASE_SEPOLIA.ownableValidator.address] }),
        BASE_SEPOLIA,
        session!,
      );
      expect(result.changed).toBe(false);
      expect((await getSession(sessionId))?.status).toBe("ACTIVE");
    });

    it("pauses the session when an unknown validator appears", async () => {
      // The attack this catches: a second validator with looser rules makes
      // the SmartSessions policies irrelevant without touching them.
      const sessionId = await newSession();
      const session = await getSession(sessionId);
      const rogue = `0x${"99".repeat(20)}` as Address;
      const result = await monitorSession(
        fakeChain({ validators: [BASE_SEPOLIA.smartSessions.address, rogue] }),
        BASE_SEPOLIA,
        session!,
      );
      expect(result.changed).toBe(true);
      expect(result.paused).toBe(true);
      expect(result.snapshot.unexpected.map((a) => a.toLowerCase())).toContain(rogue);
      expect((await getSession(sessionId))?.status).toBe("PAUSED_MODULE_CHANGE");
    });

    it("pauses when a required module has been removed", async () => {
      const sessionId = await newSession();
      const session = await getSession(sessionId);
      const result = await monitorSession(
        fakeChain({
          validators: [BASE_SEPOLIA.ownableValidator.address],
          installed: { [BASE_SEPOLIA.smartSessions.address.toLowerCase()]: false },
        }),
        BASE_SEPOLIA,
        session!,
      );
      expect(result.changed).toBe(true);
      expect((await getSession(sessionId))?.status).toBe("PAUSED_MODULE_CHANGE");
    });

    it("reports honestly when the account cannot enumerate its validators", async () => {
      // A positive check can prove a required module is gone; it cannot prove
      // nothing extra was added. Saying so beats a clean bill of health we
      // did not actually verify.
      const snapshot = await snapshotModules(fakeChain({ validators: "unsupported" }), BASE_SEPOLIA, ACCOUNT);
      expect(snapshot.enumerated).toBe(false);
      expect(snapshot.unexpected).toEqual([]);
      expect(snapshot.missing).toEqual([]);
    });

    it("does not overwrite an existing pause reason", async () => {
      const sessionId = await newSession();
      await query(`UPDATE corral_sessions SET status = 'PAUSED_MISMATCH' WHERE id = $1`, [sessionId]);
      const session = await getSession(sessionId);
      const result = await monitorSession(
        fakeChain({ validators: [`0x${"99".repeat(20)}` as Address] }),
        BASE_SEPOLIA,
        session!,
      );
      expect(result.changed).toBe(true);
      expect(result.paused).toBe(false);
      expect((await getSession(sessionId))?.status).toBe("PAUSED_MISMATCH");
    });
  });

  // ── C-902 / SEC-9: anomalies ──────────────────────────────────────────────

  describe("anomaly detection (SEC-9)", () => {
    async function addExecutions(
      sessionId: string,
      rows: { status: string; code?: string | null; amount?: string; ageMinutes?: number }[],
    ): Promise<void> {
      let i = 0;
      for (const r of rows) {
        i += 1;
        await query(
          `INSERT INTO corral_executions (session_id, seq, scheduled_for, idempotency_key, status, error_code, amount_in, asset_in, created_at)
           VALUES ($1, $2, now(), $3, $4, $5, $6, $7, now() - make_interval(mins => $8))`,
          [
            sessionId,
            i,
            `k-${sessionId}-${String(i)}`,
            r.status,
            r.code ?? null,
            r.amount ?? null,
            r.amount ? USDC : null,
            r.ageMinutes ?? 0,
          ],
        );
      }
    }

    it("flags a burst that the session's own schedule could not produce", async () => {
      const sessionId = await newSession();
      // A weekly strategy: one run per week, so five in an hour is the signal.
      await query(
        `INSERT INTO corral_strategies (session_id, kind, config, interval_seconds, next_run_at, status)
         VALUES ($1, 'DCA_FIXED', '{}'::jsonb, 604800, now(), 'ACTIVE')`,
        [sessionId],
      );
      await addExecutions(
        sessionId,
        Array.from({ length: 6 }, () => ({ status: "SUCCEEDED" })),
      );
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).toContain("BURN_RATE");
    });

    it("does not flag a fast strategy running at its own cadence", async () => {
      const sessionId = await newSession();
      // Every ten minutes: six runs in an hour is exactly the schedule.
      await query(
        `INSERT INTO corral_strategies (session_id, kind, config, interval_seconds, next_run_at, status)
         VALUES ($1, 'DCA_FIXED', '{}'::jsonb, 600, now(), 'ACTIVE')`,
        [sessionId],
      );
      await addExecutions(
        sessionId,
        Array.from({ length: 6 }, () => ({ status: "SUCCEEDED" })),
      );
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).not.toContain("BURN_RATE");
    });

    it("flags an execution taking an outsized share of the remaining budget", async () => {
      const sessionId = await newSession();
      await query(
        `INSERT INTO corral_budget_mirror (session_id, asset, limit_amount, spent_amount, usage_used, usage_limit)
         VALUES ($1, $2, 1000, 900, 1, 8)`,
        [sessionId, USDC],
      );
      // 900 of a 1000 limit already spent, and this execution was 900 of the
      // 1000 that were available before it — far past 25%.
      await addExecutions(sessionId, [{ status: "SUCCEEDED", amount: "900" }]);
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).toContain("OUTSIZED_EXECUTION");
    });

    it("leaves a normal-sized execution alone", async () => {
      const sessionId = await newSession();
      await query(
        `INSERT INTO corral_budget_mirror (session_id, asset, limit_amount, spent_amount, usage_used, usage_limit)
         VALUES ($1, $2, 1000, 100, 1, 8)`,
        [sessionId, USDC],
      );
      await addExecutions(sessionId, [{ status: "SUCCEEDED", amount: "100" }]);
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).not.toContain("OUTSIZED_EXECUTION");
    });

    it("flags a streak of policy rejections", async () => {
      const sessionId = await newSession();
      await addExecutions(sessionId, [
        { status: "REJECTED", code: "POLICY_TARGET_NOT_ALLOWED" },
        { status: "REJECTED", code: "POLICY_BUDGET_EXCEEDED" },
        { status: "REJECTED", code: "POLICY_TARGET_NOT_ALLOWED" },
      ]);
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).toContain("REJECTION_RATE");
    });

    it("a single rejection among successes is not a streak", async () => {
      const sessionId = await newSession();
      await addExecutions(sessionId, [
        { status: "SUCCEEDED" },
        { status: "REJECTED", code: "POLICY_BUDGET_EXCEEDED" },
        { status: "SUCCEEDED" },
      ]);
      const findings = await detectAnomalies(sessionId);
      expect(findings.map((f) => f.kind)).not.toContain("REJECTION_RATE");
    });

    it("records the finding and pauses the session", async () => {
      const sessionId = await newSession();
      await addExecutions(sessionId, [
        { status: "REJECTED", code: "POLICY_BUDGET_EXCEEDED" },
        { status: "REJECTED", code: "POLICY_BUDGET_EXCEEDED" },
        { status: "REJECTED", code: "POLICY_BUDGET_EXCEEDED" },
      ]);
      const { findings, paused } = await detectAndPause(sessionId);
      expect(findings.length).toBeGreaterThan(0);
      expect(paused).toBe(true);
      expect((await getSession(sessionId))?.status).toBe("PAUSED_DRIFT");
      const anomalies = await query<{ kind: string }>(`SELECT kind FROM corral_anomalies WHERE session_id = $1`, [
        sessionId,
      ]);
      expect(anomalies.map((a) => a.kind)).toContain("REJECTION_RATE");
    });

    it("compares sizes without float math", () => {
      // The threshold is basis points against a bigint remainder; there is no
      // ratio computed anywhere, so no rounding to argue about.
      expect(DEFAULT_THRESHOLDS.outsizedShareBps).toBe(2500n);
    });
  });
});
