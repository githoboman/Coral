/**
 * Corral API (spec §6.5).
 *
 * RULE: no endpoint accepts calldata, an arbitrary address, or an amount and
 * passes it toward the signer. The signer is reachable only from job code,
 * with a Plan the deterministic planner produced and preflight approved.
 * These routes read state and start a revoke; nothing here can widen a policy
 * or cause an execution.
 */
import { Router, type Response } from "express";

import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { BASE_SEPOLIA } from "../services/evm/addresses.js";
import { isDatabaseConfigured, query } from "../services/corral/db/pool.js";
import { listExecutions } from "../services/corral/executions/ledger.js";
import { depth } from "../services/corral/jobs/queue.js";
import { getSession, type SessionRow } from "../services/corral/sessions/repository.js";
import { requestRevoke, REVOKE_DISCLOSURE } from "../services/corral/sessions/revoke.js";

const router = Router();

/** Engine features are unavailable, not broken, when no database is configured. */
function requireEngine(res: Response): boolean {
  if (isDatabaseConfigured()) return true;
  res.status(503).json({ error: "corral engine is not configured (DATABASE_URL missing)" });
  return false;
}

function ownsSession(req: AuthRequest, session: SessionRow): boolean {
  const wallet = req.user?.wallet_address?.toLowerCase();
  return !!wallet && (wallet === session.owner.toLowerCase() || wallet === session.account.toLowerCase());
}

interface MirrorRow {
  asset: string;
  limit_amount: string;
  spent_amount: string;
  usage_used: number;
  usage_limit: number;
  read_at: Date;
}

/** Budget meters with their source and freshness — FR-6.4 requires both. */
async function budgets(sessionId: string): Promise<unknown[]> {
  const rows = await query<MirrorRow>(
    `SELECT asset, limit_amount, spent_amount, usage_used, usage_limit, read_at
       FROM corral_budget_mirror WHERE session_id = $1 ORDER BY asset`,
    [sessionId],
  );
  return rows.map((r) => ({
    asset: r.asset,
    limit: r.limit_amount,
    spent: r.spent_amount,
    remaining: (BigInt(r.limit_amount) > BigInt(r.spent_amount) ? BigInt(r.limit_amount) - BigInt(r.spent_amount) : 0n).toString(),
    usage: { used: r.usage_used, limit: r.usage_limit },
    source: "on-chain",
    readAt: r.read_at,
  }));
}

/** GET /api/corral/health — is the engine wired up at all? */
router.get("/corral/health", async (_req, res) => {
  if (!isDatabaseConfigured()) return res.json({ database: false, engine: process.env["CORRAL_ENGINE"] === "true" });
  try {
    return res.json({ database: true, engine: process.env["CORRAL_ENGINE"] === "true", queue: await depth() });
  } catch (e) {
    return res.status(503).json({ database: false, error: e instanceof Error ? e.message : "database unreachable" });
  }
});

/** GET /api/corral/sessions/:id — policy, budgets, freshness (FR-6.4, FR-11.3). */
router.get("/corral/sessions/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });
  return res.json({
    id: session.id,
    chainId: session.chain_id,
    account: session.account,
    agentSigner: session.agent_signer,
    permissionId: session.permission_id,
    status: session.status,
    signerDisabled: session.signer_disabled,
    validAfter: Number(session.valid_after),
    validUntil: Number(session.valid_until),
    policy: session.policy,
    budgets: await budgets(session.id),
  });
});

/**
 * Gas, always its own object (FR-6.5).
 *
 * The user's budget is denominated in the asset they allowed the agent to
 * spend; gas is wei. Returning them as siblings in one flat object is how a
 * UI ends up adding them together, so the shape makes that awkward on purpose.
 */
function gasOf(r: { gas_used: string | null; gas_price_wei: string | null; gas_cost_wei: string | null; gas_paid_by: string | null }): unknown {
  if (!r.gas_used) return null;
  return {
    gasUsed: r.gas_used,
    effectiveGasPriceWei: r.gas_price_wei,
    costWei: r.gas_cost_wei,
    paidBy: r.gas_paid_by ?? "ACCOUNT",
    note: "gas is charged in ETH and is not part of the asset budget",
  };
}

/** GET /api/corral/sessions/:id/executions — the activity feed (FR-7.3, FR-7.4). */
router.get("/corral/sessions/:id/executions", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });
  const rows = await listExecutions(session.id, Math.min(Number(req.query["limit"] ?? 50), 200));
  // Failures and aborts appear alongside successes, with their cause (FR-7.4).
  return res.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      seq: r.seq,
      scheduledFor: r.scheduled_for,
      intentHash: r.intent_hash,
      txHash: r.tx_hash,
      blockNumber: r.block_number,
      trade:
        r.amount_in === null
          ? null
          : {
              assetIn: r.asset_in,
              amountIn: r.amount_in,
              assetOut: r.asset_out,
              quotedOut: r.quoted_out,
              realisedOut: r.realised_out,
              slippageBps: r.slippage_bps,
              venue: r.venue,
            },
      gas: gasOf(r),
      errorCode: r.error_code,
      errorDetail: r.error_detail,
      plan: r.plan,
    })),
  );
});

/**
 * GET /api/corral/sessions/:id/events — the projected feed (FR-7.1, FR-7.2).
 *
 * These come from chain logs rather than from what we believed we submitted.
 * Where the two disagree, this endpoint is the one to trust.
 */
router.get("/corral/sessions/:id/events", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });
  const rows = await query<{ payload: Record<string, unknown>; occurred_at: Date }>(
    `SELECT payload, occurred_at FROM corral_events WHERE session_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
    [session.id, Math.min(Number(req.query["limit"] ?? 50), 200)],
  );
  return res.json(rows.map((r) => r.payload));
});

/** One CSV field: quoted, with embedded quotes doubled. Never interpolated raw. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * GET /api/corral/sessions/:id/executions.csv — export (FR-7.5).
 *
 * Amounts are exported in **base units**, deliberately. A spreadsheet that
 * opens this will happily turn 1234.000000000000000001 into a float and lose
 * the tail; an integer string survives. Gas is its own column group and is
 * never summed into the asset columns.
 */
router.get("/corral/sessions/:id/executions.csv", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });

  const rows = await listExecutions(session.id, 1000);
  const header = [
    "scheduled_for", "status", "seq", "asset_in", "amount_in_base_units", "asset_out",
    "quoted_out_base_units", "realised_out_base_units", "slippage_bps", "venue",
    "gas_used", "gas_price_wei", "gas_cost_wei", "gas_paid_by", "tx_hash", "intent_hash", "error_code",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.scheduled_for?.toISOString?.() ?? r.scheduled_for, r.status, r.seq, r.asset_in, r.amount_in, r.asset_out,
        r.quoted_out, r.realised_out, r.slippage_bps, r.venue,
        r.gas_used, r.gas_price_wei, r.gas_cost_wei, r.gas_paid_by, r.tx_hash, r.intent_hash, r.error_code,
      ]
        .map(csvField)
        .join(","),
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="corral-${session.id}.csv"`);
  return res.send(lines.join("\r\n"));
});

/**
 * POST /api/corral/sessions/:id/revoke/prepare (FR-8.1, FR-8.2).
 *
 * Disables the off-chain signer IMMEDIATELY — not conditional on the
 * transaction landing — then returns the transaction for the OWNER to sign.
 * Corral cannot revoke on their behalf and does not hold a key that could.
 */
router.post("/corral/sessions/:id/revoke/prepare", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });
  const ticket = await requestRevoke(BASE_SEPOLIA, session.id);
  return res.json({
    ...ticket,
    // The standalone page (FR-8.3) works even if this endpoint is down.
    fallbackPage: "/revoke",
  });
});

/** POST /api/corral/sessions/:id/revoke/confirm — believes the chain, not the caller. */
router.post("/corral/sessions/:id/revoke/confirm", requireAuth, async (req: AuthRequest, res) => {
  if (!requireEngine(res)) return;
  const session = await getSession(req.params["id"] as string);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!ownsSession(req, session)) return res.status(403).json({ error: "not your session" });
  // Confirmation needs a chain client; the deployment supplies one. Until then
  // the truth is still readable by anyone from the chain, and the off-chain
  // signer is already disabled, so nothing is pending on this call.
  return res.status(501).json({
    error: "on-chain confirmation runs in the engine process",
    note: "the signer is already disabled; the session flips to REVOKED when the engine observes the chain",
    disclosure: REVOKE_DISCLOSURE,
  });
});

/**
 * GET /api/corral/verify/:address — public, unauthenticated (FR-7.6, journey J5).
 * Anyone can check what an account's agents did, without trusting us.
 */
router.get("/corral/verify/:address", async (req, res) => {
  if (!requireEngine(res)) return;
  const address = String(req.params["address"] ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ error: "not an address" });
  const sessions = await query<SessionRow>(`SELECT * FROM corral_sessions WHERE account = $1 ORDER BY created_at`, [address]);
  const out = [];
  for (const s of sessions) {
    const rows = await listExecutions(s.id, 100);
    out.push({
      permissionId: s.permission_id,
      status: s.status,
      validAfter: Number(s.valid_after),
      validUntil: Number(s.valid_until),
      policy: s.policy,
      journal: rows
        .filter((r) => r.tx_hash)
        .map((r) => ({ seq: r.seq, intentHash: r.intent_hash, txHash: r.tx_hash, status: r.status })),
    });
  }
  return res.json({ account: address, sessions: out });
});

export default router;
