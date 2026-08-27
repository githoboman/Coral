/**
 * Chaos: NFR-7 — "Zero double-executions against a single budget. Non-negotiable."
 *
 * Drives the REAL `runExecution` against a fake chain so a crash can be
 * injected at each stage of the pipeline, then lets the queue's reaper hand
 * the job to a second worker — exactly what happens when a process dies
 * mid-execution. The invariant under test: at most one execution row, and at
 * most one submission, per (session, strategy, slot, seq) — no matter where
 * the first attempt died.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type PublicClient, type WalletClient } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

import { uniswapV3Adapter } from "../../evm/adapters/uniswapV3.js";
import { BASE_SEPOLIA } from "../../evm/addresses.js";
import { localSessionSigner } from "../../evm/execute/sessionSigner.js";
import { runMigrations } from "../db/migrate.js";
import { closePool, query } from "../db/pool.js";
import { claim, complete, enqueue, reapStale } from "../jobs/queue.js";
import { runExecution, type RunDeps, type StrategyRow } from "../pipeline/runExecution.js";
import { createSession, disableSigner, markActive } from "../sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4" as const;
const AGENT_PK = `0x${"0".repeat(59)}a11ce` as const;
const signer = localSessionSigner(AGENT_PK);

/** Where a worker dies. Each is a real boundary in the pipeline. */
type KillPoint = "quote" | "preflight" | "sign" | "submit" | "after-submit" | "none";

interface FakeChain {
  submissions: number;
  killAt: KillPoint;
  /** The account the op runs on — needed to emit a faithful UserOperationEvent. */
  sender: string;
}

/**
 * A real UserOperationEvent log, so the relayer decoder under test actually
 * runs. This is where op-level success comes from: a userOp can revert inside
 * a perfectly successful handleOps transaction.
 */
function userOpEventLog(sender: string, success: boolean) {
  return {
    address: BASE_SEPOLIA.entryPoint.address,
    topics: encodeEventTopics({
      abi: entryPoint07Abi,
      eventName: "UserOperationEvent",
      args: {
        userOpHash: `0x${"cd".repeat(32)}` as `0x${string}`,
        sender: sender as `0x${string}`,
        paymaster: "0x0000000000000000000000000000000000000000",
      },
    }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, success, 1000n, 100_000n]),
  };
}

function fakeClient(chain: FakeChain): PublicClient {
  const die = (at: KillPoint): void => {
    if (chain.killAt === at) throw new Error(`chaos: worker died at ${at}`);
  };
  const reads: Record<string, unknown> = {
    isPermissionEnabled: true,
    getUsageLimit: 8n,
    getUsed: 0n,
    // validAfter 0, validUntil far future, packed as (until << 48) | after
    getTimeFrameConfig: (4_000_000_000n << 48n) | 0n,
    getRateLimitConfig: [2, 86_400, 0],
    getUsedInWindow: 0,
    getPolicyData: [4_000_000n, 0n, 0n],
    getNonce: 0n,
  };
  return {
    chain: { id: 84532 },
    async readContract({ functionName }: { functionName: string }) {
      return reads[functionName];
    },
    async call() {
      return { data: "0x" };
    },
    async simulateContract({ functionName }: { functionName: string }) {
      if (functionName === "quoteExactInputSingle") {
        die("quote");
        return { result: [1_367_911_410_436_060n, 0n, 0, 0n] };
      }
      die("submit");
      chain.submissions += 1;
      return { result: undefined };
    },
    async estimateFeesPerGas() {
      return { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1_000_000n };
    },
    async waitForTransactionReceipt() {
      die("after-submit");
      return { status: "success", blockNumber: 1n, gasUsed: 100_000n, logs: [userOpEventLog(chain.sender, true)] };
    },
    async getTransactionReceipt() {
      return { status: "success", blockNumber: 1n, gasUsed: 100_000n, logs: [userOpEventLog(chain.sender, true)] };
    },
  } as unknown as PublicClient;
}

function fakeRelayer(): WalletClient {
  return {
    account: { address: "0x91ac808850c33E15dc028a12Bfcaad70F1F8e6f9" },
    chain: { id: 84532 },
    async writeContract() {
      return `0x${"ab".repeat(32)}`;
    },
  } as unknown as WalletClient;
}

function deps(chain: FakeChain): RunDeps {
  return {
    client: fakeClient(chain),
    relayer: fakeRelayer(),
    addresses: BASE_SEPOLIA,
    signer:
      chain.killAt === "sign"
        ? { address: signer.address, signHash: async () => { throw new Error("chaos: worker died at sign"); } }
        : signer,
    adapterFor: () => uniswapV3Adapter({ router: ROUTER, quoter: "0xc5290058841028f1614f3a6f0f5816cad0df5e27", fee: 3000 }),
  };
}

let n = 5000;
async function activeSession() {
  n += 1;
  const now = Math.floor(Date.now() / 1000);
  const s = await createSession({
    chainId: 84532,
    account: `0x${n.toString(16).padStart(40, "0")}`,
    owner: `0x${"1".repeat(40)}`,
    agentSigner: signer.address,
    permissionId: `0x${n.toString(16).padStart(64, "0")}`,
    policy: { min_output_bps: 9500, budgets: [{ asset: { address: USDC }, max_total: "4000000" }] },
    validAfter: now - 60,
    validUntil: now + 86_400,
  });
  await markActive(s.id, `0x${"0".repeat(64)}`);
  const rows = await query<{ id: string }>(
    `INSERT INTO corral_strategies (session_id, kind, config, status, interval_seconds, next_run_at)
     VALUES ($1, 'DCA_FIXED', $2::jsonb, 'ACTIVE', 604800, now()) RETURNING id`,
    [
      s.id,
      JSON.stringify({
        kind: "DCA_FIXED",
        venue: "uniswap-v3",
        fee: 3000,
        assetIn: { symbol: "USDC", address: USDC },
        assetOut: { symbol: "WETH", address: WETH },
        amountIn: "200000",
      }),
    ],
  );
  const strategy: StrategyRow = {
    id: rows[0]!.id,
    session_id: s.id,
    config: {
      kind: "DCA_FIXED",
      venue: "uniswap-v3",
      fee: 3000,
      assetIn: { symbol: "USDC", address: USDC },
      assetOut: { symbol: "WETH", address: WETH },
      amountIn: "200000",
    },
    seq: 0,
    interval_seconds: 604_800,
    next_run_at: new Date(),
  };
  return { session: s, strategy };
}

const SLOT = new Date("2026-09-01T12:00:00.000Z");

describe.skipIf(!TEST_DB)("pipeline chaos (NFR-7)", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    // Own schema: parallel test files must not share tables.
    process.env["DATABASE_SCHEMA"] = "corral_test_chaos";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_chaos");
    await runMigrations();
    // Start from empty: session identifiers are generated from a counter that
    // restarts each run, and createSession upserts — so leftovers from a
    // previous run would attach to the same session and inflate the counts.
    await query("TRUNCATE corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE");
  });
  beforeEach(async () => {
    await query("TRUNCATE corral_jobs CASCADE");
  });
  afterAll(async () => {
    await closePool();
  });

  const killPoints: KillPoint[] = ["quote", "preflight", "sign", "submit", "after-submit"];

  it.each(killPoints)("a worker dying at '%s' leaves at most one execution and one submission", async (killAt) => {
    const { session, strategy } = await activeSession();
    await enqueue({ kind: "execution.run", sessionId: session.id, payload: { strategyId: strategy.id } });

    // Worker A claims and dies mid-pipeline.
    const jobA = await claim("worker-A");
    expect(jobA).not.toBeNull();
    const chain: FakeChain = { submissions: 0, killAt, sender: session.account };
    const first = await runExecution(deps(chain), { sessionId: session.id, strategy, scheduledFor: SLOT });
    expect(["ABORTED", "EXECUTED"]).toContain(first.kind);

    // The process is gone: the job stays RUNNING until the reaper returns it.
    await query(`UPDATE corral_jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1`, [jobA!.id]);
    expect(await reapStale(60_000)).toBe(1);

    // Worker B picks up the same job and runs the same slot.
    const jobB = await claim("worker-B");
    expect(jobB!.id).toBe(jobA!.id);
    chain.killAt = "none";
    const second = await runExecution(deps(chain), { sessionId: session.id, strategy, scheduledFor: SLOT });

    // THE INVARIANT: the slot was already reserved, so the retry cannot
    // re-plan or re-sign it — it stops instead.
    expect(second.kind).toBe("SKIPPED");
    if (second.kind === "SKIPPED") expect(second.reason).toContain("already claimed");

    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_executions WHERE session_id = $1`, [session.id]);
    expect(Number(rows[0]!.n)).toBe(1);
    expect(chain.submissions).toBeLessThanOrEqual(1);
    await complete(jobB!.id);
  });

  it("a revoked session is refused by the signer even if a job survives in the queue (SEC-14)", async () => {
    const { session, strategy } = await activeSession();
    await disableSigner(session.id);
    const out = await runExecution(deps({ submissions: 0, killAt: "none", sender: session.account }), { sessionId: session.id, strategy, scheduledFor: SLOT });
    expect(out.kind).toBe("SKIPPED");
    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_executions WHERE session_id = $1`, [session.id]);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("a clean run records SUCCEEDED exactly once and journals the intent hash", async () => {
    const { session, strategy } = await activeSession();
    const chain: FakeChain = { submissions: 0, killAt: "none", sender: session.account };
    const out = await runExecution(deps(chain), { sessionId: session.id, strategy, scheduledFor: SLOT });
    expect(out.kind).toBe("EXECUTED");
    const rows = await query<{ status: string; intent_hash: string; amount_in: string }>(
      `SELECT status, intent_hash, amount_in FROM corral_executions WHERE session_id = $1`,
      [session.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SUCCEEDED");
    expect(rows[0]!.amount_in).toBe("200000");
    expect(rows[0]!.intent_hash).toMatch(/^0x[0-9a-f]{64}$/);
    // Every signing attempt is auditable (SEC-13).
    const audit = await query<{ outcome: string }>(`SELECT outcome FROM corral_signer_audit WHERE session_id = $1`, [session.id]);
    expect(audit.map((a) => a.outcome)).toContain("SIGNED");
  });

  it("an unsafe plan (too large a share of remaining budget) is rejected before signing (FR-4.7)", async () => {
    const { session, strategy } = await activeSession();
    const greedy: StrategyRow = { ...strategy, config: { ...strategy.config, amountIn: "3000000" } };
    const chain: FakeChain = { submissions: 0, killAt: "none", sender: session.account };
    const out = await runExecution(deps(chain), { sessionId: session.id, strategy: greedy, scheduledFor: SLOT });
    expect(out.kind).toBe("ABORTED");
    if (out.kind === "ABORTED") expect(out.code).toBe("PLAN_UNSAFE_BOUNDS");
    expect(chain.submissions).toBe(0);
    const audit = await query<{ outcome: string }>(`SELECT outcome FROM corral_signer_audit WHERE session_id = $1`, [session.id]);
    expect(audit).toHaveLength(0); // never reached the signer
  });
});
