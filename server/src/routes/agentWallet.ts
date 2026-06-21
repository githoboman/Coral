import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { toBase64 } from "@mysten/sui/utils";
import { getSuiClient } from "../services/agentWallet/config";
import { getAgentWalletInitializer } from "../services/agentWallet/init";
import { getAgentWalletStore } from "../services/agentWallet/store";
import { getSwapAgent } from "../services/agentWallet/swapAgent";
import { getPolicyChecker } from "../services/agentWallet/policyChecker";
import { getAgentAlerts } from "../services/agentWallet/alerts";
import { buildCreatePolicyTx, extractCreatedIds } from "../services/agentWallet/owner/policyCreator";
import { buildPauseTx, buildResumeTx } from "../services/agentWallet/owner/pauseResume";
import { cleanupAndSweep, buildRevokeTx } from "../services/agentWallet/owner/revocation";
import { bootstrapBalanceManager } from "../services/agentWallet/deepbookSetup";
import { scheduleSwap } from "../services/agentWallet/strategies";
import { getTradeIntentService } from "../services/agentWallet/tradeIntentService";
import type { DeepBookSetup } from "../services/agentWallet/deepbookClient";
import { AgentActionType } from "../services/agentWallet/types";
import type { Transaction } from "@mysten/sui/transactions";

const router = Router();

// Owner-signing endpoints return an unsigned tx the frontend signs with dapp-kit.
// We serialize to base64 tx bytes built against the owner as sender.
async function serializeForOwner(tx: Transaction, owner: string): Promise<string> {
  tx.setSenderIfNotSet(owner);
  const bytes = await tx.build({ client: getSuiClient() });
  return toBase64(bytes);
}

const ok = (res: Response, data: unknown, message = "OK") =>
  res.json({ status: true, message, data });

const fail = (res: Response, code: number, detail: string) =>
  res.status(code).json({ status: false, message: detail, data: null, errors: [{ code: "AGENT_WALLET_ERROR", detail }] });

// ── Wallet lifecycle ──────────────────────────────────────────────────

/** POST /api/agent/wallet/init — get-or-create the agent wallet for the owner. */
router.post("/agent/wallet/init", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletInitializer().getOrCreate(owner);
    return ok(res, {
      agentAddress: wallet.agentAddress,
      policyId: wallet.policyId,
      capabilityId: wallet.capabilityId,
      bound: Boolean(wallet.policyId && wallet.capabilityId),
    });
  } catch (e: any) {
    return fail(res, 500, e?.message || "init failed");
  }
});

/** GET /api/agent/wallet — current agent wallet status for the owner. */
router.get("/agent/wallet", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await getAgentWalletStore().getByOwner(req.user!.wallet_address);
    if (!wallet) return ok(res, null, "No agent wallet yet");
    return ok(res, {
      agentAddress: wallet.agentAddress,
      policyId: wallet.policyId,
      capabilityId: wallet.capabilityId,
      bound: Boolean(wallet.policyId && wallet.capabilityId),
    });
  } catch (e: any) {
    return fail(res, 500, e?.message || "lookup failed");
  }
});

/**
 * GET /api/agent/policy — the live on-chain policy state for the owner's bound
 * policy: budget cap/spent, whitelists, expiry, active flag. Powers the policy
 * drawer's budget bar and expiry countdown. bigints are serialized as strings.
 */
router.get("/agent/policy", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await getAgentWalletStore().getByOwner(req.user!.wallet_address);
    if (!wallet?.policyId) return ok(res, null, "No bound policy");

    const policy = await getPolicyChecker().readPolicy(wallet.policyId);
    if (!policy) return ok(res, null, "Policy object not found on-chain");

    const cap = policy.budgetCap;
    const spent = policy.budgetSpent;
    const remaining = cap > spent ? cap - spent : 0n;
    const usedPct = cap > 0n ? Number((spent * 10000n) / cap) / 100 : 0;

    return ok(res, {
      policyId: policy.policyId,
      budgetCap: cap.toString(),
      budgetSpent: spent.toString(),
      budgetRemaining: remaining.toString(),
      usedPercent: usedPct,
      allowedAssets: policy.allowedAssets,
      allowedProtocols: policy.allowedProtocols,
      allowedActions: policy.allowedActions,
      expiryTimestampMs: policy.expiryTimestamp.toString(),
      gasReserve: policy.gasReserve.toString(),
      isActive: policy.isActive,
    });
  } catch (e: any) {
    return fail(res, 500, e?.message || "policy read failed");
  }
});

// ── Owner controls (return unsigned tx bytes) ─────────────────────────

/**
 * POST /api/agent/policy/create-tx — build the create_policy tx for the owner to
 * sign. Body: { budgetCap, allowedAssets[], allowedActions?, expiryHours?, gasReserve }.
 * The agent address is derived from the owner's initialized wallet.
 */
router.post("/agent/policy/create-tx", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletInitializer().getOrCreate(owner);
    const { budgetCap, allowedAssets, allowedActions, expiryHours, gasReserve } = req.body ?? {};
    if (budgetCap == null || !Array.isArray(allowedAssets) || gasReserve == null) {
      return fail(res, 400, "budgetCap, allowedAssets[], gasReserve are required");
    }

    const tx = buildCreatePolicyTx({
      agentAddress: wallet.agentAddress,
      budgetCap: BigInt(budgetCap),
      allowedAssets,
      allowedActions: allowedActions as AgentActionType[] | undefined,
      expiryHours,
      gasReserve: BigInt(gasReserve),
    });

    return ok(res, { txBytes: await serializeForOwner(tx, owner), agentAddress: wallet.agentAddress });
  } catch (e: any) {
    return fail(res, 500, e?.message || "create-tx failed");
  }
});

/**
 * POST /api/agent/policy/bind — after the owner signs+executes create_policy, the
 * frontend posts the resulting objectChanges so we can bind policy+capability ids.
 * Body: { objectChanges }.
 */
router.post("/agent/policy/bind", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet) return fail(res, 404, "No agent wallet to bind");

    const { policyId, capabilityId } = extractCreatedIds(req.body?.objectChanges ?? []);
    if (!policyId || !capabilityId) {
      return fail(res, 400, "Could not find AgentPolicy/AgentCapability in objectChanges");
    }
    const bound = await getAgentWalletInitializer().bindToPolicy(wallet.agentAddress, policyId, capabilityId);
    return ok(res, { policyId: bound.policyId, capabilityId: bound.capabilityId }, "Policy bound");
  } catch (e: any) {
    return fail(res, 500, e?.message || "bind failed");
  }
});

/** POST /api/agent/policy/pause-tx — unsigned pause tx. */
router.post("/agent/policy/pause-tx", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet?.policyId) return fail(res, 404, "No bound policy");
    const tx = buildPauseTx(wallet.policyId);
    return ok(res, { txBytes: await serializeForOwner(tx, owner) });
  } catch (e: any) {
    return fail(res, 500, e?.message || "pause-tx failed");
  }
});

/** POST /api/agent/policy/resume-tx — unsigned resume tx. */
router.post("/agent/policy/resume-tx", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet?.policyId) return fail(res, 404, "No bound policy");
    const tx = buildResumeTx(wallet.policyId);
    return ok(res, { txBytes: await serializeForOwner(tx, owner) });
  } catch (e: any) {
    return fail(res, 500, e?.message || "resume-tx failed");
  }
});

/**
 * POST /api/agent/policy/revoke — two-step revocation. Step 1 runs server-side
 * (agent-signed cleanup + sweep); we return the unsigned revoke tx for the owner to
 * sign as step 2. Body: { deepbook: DeepBookSetup }.
 */
router.post("/agent/policy/revoke", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet?.policyId || !wallet.capabilityId) return fail(res, 404, "No bound policy");

    const deepbook = req.body?.deepbook as DeepBookSetup | undefined;
    let cleanup: { ok: boolean; reason?: string; cleanupDigest?: string } = { ok: true };
    if (deepbook) {
      cleanup = await cleanupAndSweep(wallet, deepbook);
    }

    const revokeTx = buildRevokeTx(wallet.policyId, wallet.capabilityId);
    const txBytes = await serializeForOwner(revokeTx, owner);

    getAgentAlerts().revoked(owner, wallet.policyId);
    return ok(res, {
      cleanup,
      revokeTxBytes: txBytes,
      note: "Sign revokeTxBytes with the owner wallet to destroy the capability (step 2).",
    });
  } catch (e: any) {
    return fail(res, 500, e?.message || "revoke failed");
  }
});

// ── Agentic entrypoint (natural language) ─────────────────────────────

/**
 * POST /api/agent/intent — the headline agentic endpoint. Takes a plain-language
 * instruction ("swap 30% of my SUI to USDC", "buy SUI if it drops below 0.20"),
 * parses it into a structured intent, validates against policy, and executes or
 * arms the right strategy. Body: { message, deepbook }.
 */
router.post("/agent/intent", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const { message, deepbook } = req.body ?? {};
    if (!message || !deepbook) {
      return fail(res, 400, "message and deepbook are required");
    }
    const result = await getTradeIntentService().handle(owner, String(message), deepbook as DeepBookSetup);
    // Always 200 with the parsed intent so the UI can show what the agent understood,
    // even when the action was rejected (policy/validation). `ok` flags success.
    return ok(res, result, result.message);
  } catch (e: any) {
    return fail(res, 500, e?.message || "intent failed");
  }
});

// ── Agent actions (executed server-side with the agent key) ───────────

/**
 * POST /api/agent/swap — execute a market swap or limit order via the agent.
 * Body: { deepbook, tokenIn, tokenOut, amount, market, price? }.
 */
router.post("/agent/swap", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet) return fail(res, 404, "No agent wallet");

    const { deepbook, tokenIn, tokenOut, amount, market, price } = req.body ?? {};
    if (!deepbook || !tokenIn || !tokenOut || amount == null) {
      return fail(res, 400, "deepbook, tokenIn, tokenOut, amount are required");
    }

    const outcome = await getSwapAgent().execute({
      wallet,
      deepbook,
      tokenIn,
      tokenOut,
      amount: BigInt(amount),
      market: market !== false,
      price,
    });

    if (!outcome.ok) return fail(res, 422, outcome.reason || "swap rejected");
    return ok(res, outcome, "Action executed");
  } catch (e: any) {
    return fail(res, 500, e?.message || "swap failed");
  }
});

/**
 * POST /api/agent/deepbook/bootstrap — create + (optionally) fund the agent's
 * BalanceManager. Body: { deposits?: [{ coinKey, amount }] }. Run once before trading.
 */
router.post("/agent/deepbook/bootstrap", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet) return fail(res, 404, "No agent wallet");
    const result = await bootstrapBalanceManager(wallet, req.body?.deposits ?? []);
    if (!result.ok) return fail(res, 422, result.reason || "bootstrap failed");
    return ok(res, result, "BalanceManager ready");
  } catch (e: any) {
    return fail(res, 500, e?.message || "bootstrap failed");
  }
});

/**
 * POST /api/agent/swap/schedule — schedule a swap for a future time. The on-chain
 * Clock gate enforces "not before" regardless of when the backend timer fires.
 * Body: { deepbook, tokenIn, tokenOut, amount, market?, price?, atEpochMs }.
 */
router.post("/agent/swap/schedule", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user!.wallet_address;
    const wallet = await getAgentWalletStore().getByOwner(owner);
    if (!wallet) return fail(res, 404, "No agent wallet");

    const { deepbook, tokenIn, tokenOut, amount, market, price, atEpochMs } = req.body ?? {};
    if (!deepbook || !tokenIn || !tokenOut || amount == null || !atEpochMs) {
      return fail(res, 400, "deepbook, tokenIn, tokenOut, amount, atEpochMs are required");
    }

    scheduleSwap({
      request: {
        wallet,
        deepbook,
        tokenIn,
        tokenOut,
        amount: BigInt(amount),
        market: market !== false,
        price,
      },
      atEpochMs: Number(atEpochMs),
      onResult: (o) =>
        o.ok
          ? getAgentAlerts().actionSucceeded(owner, "Scheduled swap executed", `${amount} ${tokenIn}->${tokenOut}`, { digest: o.digest })
          : getAgentAlerts().actionFailed(owner, o.reason || "scheduled swap failed"),
      onError: (err) => getAgentAlerts().actionFailed(owner, String(err)),
    });

    return ok(res, { scheduledFor: Number(atEpochMs) }, "Swap scheduled");
  } catch (e: any) {
    return fail(res, 500, e?.message || "schedule failed");
  }
});

// ── Alerts feed ───────────────────────────────────────────────────────

/** GET /api/agent/alerts?sinceId=... — newest-first in-app alerts for the owner. */
router.get("/agent/alerts", requireAuth, async (req: AuthRequest, res: Response) => {
  const owner = req.user!.wallet_address;
  const sinceId = req.query.sinceId as string | undefined;
  return ok(res, getAgentAlerts().list(owner, sinceId));
});

export default router;
