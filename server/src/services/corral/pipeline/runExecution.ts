/**
 * The execution pipeline (spec §7): the whole of journey J2, with no user in
 * the loop and no way to widen anything.
 *
 *   gate → chain state → quote → RESERVE SLOT → plan → compile → preflight
 *        → sign (guarded) → submit (own relayer) → record → reconcile
 *
 * Order matters. The slot is reserved (idempotency key inserted) before any
 * signature exists, so a crash anywhere after it can only ever be *resolved*,
 * never *repeated* (NFR-7). Every abort is a typed `ErrorCode` whose retry
 * class the queue obeys — policy rejections are terminal.
 */
import { keccak256, stringToHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { planToWire, type ErrorCode } from "@corral/core";

import type { ProtocolAdapter } from "../../evm/adapters/protocolAdapter.js";
import type { ChainAddresses } from "../../evm/addresses.js";
import { preflight } from "../../evm/execute/preflight.js";
import type { SessionSigner } from "../../evm/execute/sessionSigner.js";
import { buildSessionUserOp, executeSessionUserOp } from "../../evm/execute/sessionUserOp.js";
import { compilePlan } from "../../evm/planner/compile.js";
import { claimExecutionSlot, markIncluded, markRejected, markSimulated, markSubmitted } from "../executions/ledger.js";
import { planDcaFixed, PlanUnsafe, DcaFixedConfigSchema, type DcaFixedConfig } from "../planner/deterministic.js";
import { refreshBudgetMirror } from "../reconcile/budget.js";
import { guardedSessionSigner, SignerRefused } from "../sessions/guardedSigner.js";
import { getSession, isExecutable, type SessionRow } from "../sessions/repository.js";

export interface StrategyRow {
  readonly id: string;
  readonly session_id: string;
  readonly config: Record<string, unknown>;
  readonly seq: number;
  readonly interval_seconds: number;
  readonly next_run_at: Date;
}

export interface RunDeps {
  readonly client: PublicClient;
  readonly relayer: WalletClient;
  readonly addresses: ChainAddresses;
  /** Raw signer for this session's agent; wrapped in the DB gate before use. */
  readonly signer: SessionSigner;
  readonly adapterFor: (config: DcaFixedConfig) => ProtocolAdapter;
  readonly now?: () => number;
}

export type RunOutcome =
  | { readonly kind: "EXECUTED"; readonly executionId: string; readonly txHash: Hex; readonly journaled: boolean }
  | { readonly kind: "SKIPPED"; readonly reason: string }
  | { readonly kind: "ABORTED"; readonly executionId: string | null; readonly code: ErrorCode; readonly detail: string };

/** Deterministic intent hash: same policy + strategy + slot ⇒ same hash (FR-3.4). */
export function intentHashFor(session: SessionRow, strategy: StrategyRow, scheduledFor: Date, seq: number): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        permissionId: session.permission_id,
        strategyId: strategy.id,
        config: strategy.config,
        scheduledFor: scheduledFor.toISOString(),
        seq,
      }),
    ),
  );
}

/** bytes32 form of a database uuid, for the journal entry. */
export function strategyIdB32(strategyId: string): Hex {
  return keccak256(stringToHex(strategyId));
}

export async function runExecution(
  deps: RunDeps,
  input: { readonly sessionId: string; readonly strategy: StrategyRow; readonly scheduledFor: Date },
): Promise<RunOutcome> {
  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const { strategy, scheduledFor } = input;

  // 1. Gate. The signer would refuse anyway (SEC-14); failing here keeps the
  //    ledger clean of executions that were never going to be attempted.
  const session = await getSession(input.sessionId);
  if (!session) return { kind: "SKIPPED", reason: "unknown session" };
  const gate = isExecutable(session, nowSeconds);
  if (!gate.ok) return { kind: "SKIPPED", reason: gate.reason };

  const config = DcaFixedConfigSchema.parse(strategy.config);
  const adapter = deps.adapterFor(config);
  const seq = strategy.seq + 1;

  // 2. Reserve the slot BEFORE any work that could be duplicated. A second
  //    delivery of this job stops right here.
  const execution = await claimExecutionSlot({ sessionId: session.id, strategyId: strategy.id, scheduledFor, seq });
  if (!execution) return { kind: "SKIPPED", reason: "slot already claimed (duplicate delivery)" };

  const account = session.account as Address;
  const abort = async (code: ErrorCode, detail: string): Promise<RunOutcome> => {
    await markRejected(execution.id, code, detail, code.startsWith("POLICY_") || code === "SESSION_REVOKED" ? "REJECTED" : "ABORTED");
    return { kind: "ABORTED", executionId: execution.id, code, detail };
  };

  try {
    // 3. Chain state + quote, then plan deterministically.
    const snapshot = await preflight({
      client: deps.client,
      addresses: deps.addresses,
      account,
      permissionId: session.permission_id as Hex,
      spend: { token: config.assetIn.address as Address, approveSelector: "0x095ea7b3", amount: 0n },
      callData: "0x",
      now: nowSeconds,
    });
    const remaining = snapshot.snapshot?.budget.remaining ?? 0n;

    const quote = await adapter.quote(deps.client, {
      account,
      assetIn: config.assetIn,
      assetOut: config.assetOut,
      amountIn: BigInt(config.amountIn),
      minOutputBps: Number((session.policy as { min_output_bps?: number }).min_output_bps ?? 9800),
    });

    const plan = planDcaFixed(config, {
      chainId: session.chain_id,
      permissionId: session.permission_id,
      strategyIdB32: strategyIdB32(strategy.id),
      seq,
      spender: adapterSpender(adapter, config),
      quote,
    }, remaining);

    // 4. Compile → preflight the real calldata.
    const intentHash = intentHashFor(session, strategy, scheduledFor, seq);
    const compiled = compilePlan({ plan, account, adapter, addresses: deps.addresses, intentHash });

    const pf = await preflight({
      client: deps.client,
      addresses: deps.addresses,
      account,
      permissionId: session.permission_id as Hex,
      spend: { token: config.assetIn.address as Address, approveSelector: "0x095ea7b3", amount: BigInt(config.amountIn) },
      callData: compiled.callData,
      now: nowSeconds,
    });
    if (!pf.ok) return abort(pf.code, pf.detail);

    await markSimulated(execution.id, {
      // Wire form: amounts become decimal strings. A Plan holds branded
      // bigints, which JSON cannot serialize — persisting one directly throws
      // (found by the chaos test, 2026-08-27).
      plan: planToWire(plan),
      intentHash,
      callDataHash: keccak256(compiled.callData),
      assetIn: config.assetIn.address,
      amountIn: BigInt(config.amountIn),
      assetOut: config.assetOut.address,
      quotedOut: quote.amountOut,
      venue: adapter.venue,
    });

    // 5. Sign through the DB gate, then submit through our own relayer.
    const signer = guardedSessionSigner(deps.signer, session.id, "pipeline");
    const userOp = await buildSessionUserOp({
      client: deps.client,
      addresses: deps.addresses,
      account,
      permissionId: session.permission_id as Hex,
      signer,
      callData: compiled.callData,
    });
    await markSubmitted(execution.id, keccak256(userOp.signature), null);

    const outcome = await executeSessionUserOp({ client: deps.client, relayer: deps.relayer, addresses: deps.addresses }, userOp);
    await markIncluded(execution.id, {
      txHash: outcome.submission.txHash,
      blockNumber: outcome.submission.blockNumber,
      gasUsed: outcome.submission.gasUsed,
      opSuccess: outcome.submission.opSuccess,
      errorCode: outcome.submission.opSuccess ? null : "SIMULATION_REVERT",
      errorDetail: outcome.submission.opRevertReason ?? null,
    });

    // 6. Refresh the mirror from chain. Drift pauses the session (FR-6.3).
    await refreshBudgetMirror(deps.client, deps.addresses, session);

    return { kind: "EXECUTED", executionId: execution.id, txHash: outcome.submission.txHash, journaled: outcome.journal !== null };
  } catch (e) {
    if (e instanceof PlanUnsafe) return abort("PLAN_UNSAFE_BOUNDS", e.message);
    if (e instanceof SignerRefused) return abort("SESSION_REVOKED", e.reason);
    const msg = e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e);
    return abort("SIMULATION_REVERT", msg);
  }
}

/** The spender an adapter's APPROVE action must name (its router). */
function adapterSpender(adapter: ProtocolAdapter, config: DcaFixedConfig): string {
  const targets = adapter.requiredTargets({
    tokenIn: config.assetIn.address as Address,
    tokenOut: config.assetOut.address as Address,
    maxPerExecution: BigInt(config.amountIn),
    minAmountOutFloor: 1n,
  });
  const approve = targets.find((t) => t.action === "APPROVE");
  const rule = approve?.param_rules.find((r) => r.rule === "IN_SET" && r.param_index === 0);
  const value = rule && rule.rule === "IN_SET" ? rule.allowed[0] : undefined;
  if (!value || value.kind !== "address") throw new Error("adapter does not declare an approve spender");
  return value.value;
}
