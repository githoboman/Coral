// server/src/routes/proactive.ts
// Phase 1 + 2 + 4: Routes for wallet monitoring, preferences, suggestions, and simulations

import { Router, Request, Response } from "express";
import { getUserStateService } from "../services/userStateService";
import { getEventMonitorService } from "../services/eventMonitorService";
import { getSuggestionThrottler } from "../services/suggestionThrottler";
import { getSuggestionEngine } from "../services/suggestionEngine";
import { requireAuth } from "../middleware/auth";


const router = Router();

// ══════════════════════════════════════════════════════════════════════
// TRACKED ITEMS
// ══════════════════════════════════════════════════════════════════════

/**
 * POST /api/proactive/track
 * Register a wallet item to monitor (token, NFT, or address).
 * Body: { wallet_address, type, identifier, label }
 */
router.post("/track", requireAuth, async (req: Request, res: Response) => {
  try {
    const { wallet_address, type, identifier, label } = req.body;

    if (!wallet_address || !type || !identifier || !label) {
      return res.status(400).json({
        error: "wallet_address, type, identifier, and label are required",
      });
    }

    if (!["token", "nft", "address"].includes(type)) {
      return res.status(400).json({
        error: "type must be one of: token, nft, address",
      });
    }

    const userState = getUserStateService();
    const item = await userState.addTrackedItem(wallet_address, {
      type,
      identifier,
      label,
    });

    if (!item) {
      return res.status(409).json({
        error: "Tracked item limit reached (max 10)",
      });
    }

    // Start monitoring if not already active
    const eventMonitor = getEventMonitorService();
    await eventMonitor.startMonitoring(wallet_address);

    return res.status(201).json(item);
  } catch (error) {
    console.error("[Proactive] Error adding tracked item:", error);
    return res.status(500).json({ error: "Failed to add tracked item" });
  }
});

/**
 * DELETE /api/proactive/track/:itemId
 * Remove a tracked item.
 * Query: ?wallet_address=0x...
 */
router.delete("/track/:itemId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const walletAddress = req.query.wallet_address as string;

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const userState = getUserStateService();
    const removed = await userState.removeTrackedItem(walletAddress, itemId);

    if (!removed) {
      return res.status(404).json({ error: "Tracked item not found" });
    }

    // If no tracked items left, stop monitoring
    const remaining = await userState.getTrackedItems(walletAddress);
    if (remaining.length === 0) {
      const eventMonitor = getEventMonitorService();
      eventMonitor.stopMonitoring(walletAddress);
    }

    return res.json({ message: "Tracked item removed" });
  } catch (error) {
    console.error("[Proactive] Error removing tracked item:", error);
    return res.status(500).json({ error: "Failed to remove tracked item" });
  }
});

/**
 * GET /api/proactive/tracked
 * Get all tracked items for a wallet.
 * Query: ?wallet_address=0x...
 */
router.get("/tracked", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query.wallet_address as string;

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const userState = getUserStateService();
    const items = await userState.getTrackedItems(walletAddress);

    return res.json({ items, count: items.length, limit: 10 });
  } catch (error) {
    console.error("[Proactive] Error fetching tracked items:", error);
    return res.status(500).json({ error: "Failed to fetch tracked items" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// WALLET EVENTS
// ══════════════════════════════════════════════════════════════════════

/**
 * GET /api/proactive/events
 * Get recent wallet events (on-chain activity detected by the monitor).
 * Query: ?wallet_address=0x...&limit=20&type=token_received&unprocessed=true
 */
router.get("/events", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query.wallet_address as string;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const type = req.query.type as string | undefined;
    const unprocessed = req.query.unprocessed === "true";

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const eventMonitor = getEventMonitorService();
    const events = await eventMonitor.getRecentEvents(walletAddress, {
      limit,
      type: type as any,
      unprocessedOnly: unprocessed,
    });

    return res.json({ events, count: events.length });
  } catch (error) {
    console.error("[Proactive] Error fetching events:", error);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ══════════════════════════════════════════════════════════════════════

/**
 * GET /api/proactive/preferences
 * Get user's proactive feature preferences.
 * Query: ?wallet_address=0x...
 */
router.get("/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query.wallet_address as string;

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const userState = getUserStateService();
    const prefs = await userState.getPreferences(walletAddress);

    return res.json(prefs);
  } catch (error) {
    console.error("[Proactive] Error fetching preferences:", error);
    return res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

/**
 * PUT /api/proactive/preferences
 * Update user's proactive feature preferences.
 * Body: { wallet_address, risk_tolerance?, notification_frequency?, proactive_suggestions?, tracking_opt_in? }
 */
router.put("/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const { wallet_address, ...prefs } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ error: "wallet_address is required" });
    }

    // Validate enum values if provided
    if (prefs.risk_tolerance && !["conservative", "moderate", "aggressive"].includes(prefs.risk_tolerance)) {
      return res.status(400).json({ error: "risk_tolerance must be: conservative, moderate, or aggressive" });
    }
    if (prefs.notification_frequency && !["low", "normal", "high"].includes(prefs.notification_frequency)) {
      return res.status(400).json({ error: "notification_frequency must be: low, normal, or high" });
    }

    const userState = getUserStateService();
    const updated = await userState.updatePreferences(wallet_address, prefs);

    return res.json(updated);
  } catch (error) {
    console.error("[Proactive] Error updating preferences:", error);
    return res.status(500).json({ error: "Failed to update preferences" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// MONITOR STATUS
// ══════════════════════════════════════════════════════════════════════

/**
 * GET /api/proactive/status
 * Get the status of the event monitoring system.
 */
router.get("/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const eventMonitor = getEventMonitorService();
    return res.json({
      active_monitors: eventMonitor.getActiveCount(),
      status: "operational",
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to get monitor status" });
  }
});

// ======================================================================
// PHASE 2: SUGGESTIONS
// ======================================================================

/**
 * GET /api/proactive/suggestions
 * Get recent proactive suggestions for a wallet.
 * Query: ?wallet_address=0x...&limit=20
 */
router.get("/suggestions", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query.wallet_address as string;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const throttler = getSuggestionThrottler();
    const suggestions = await throttler.getRecent(walletAddress, limit);

    return res.json({ suggestions, count: suggestions.length });
  } catch (error) {
    console.error("[Proactive] Error fetching suggestions:", error);
    return res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

/**
 * POST /api/proactive/suggestions/:id/respond
 * Accept or dismiss a suggestion from the web UI.
 * Body: { action: "accept" | "dismiss" }
 */
router.post("/suggestions/:id/respond", requireAuth, async (req: Request, res: Response) => {
  try {
    const suggestionId = parseInt(req.params.id, 10);
    const { action } = req.body;

    if (isNaN(suggestionId)) {
      return res.status(400).json({ error: "Invalid suggestion ID" });
    }

    if (!["accept", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be 'accept' or 'dismiss'" });
    }

    const engine = getSuggestionEngine();

    if (action === "accept") {
      const success = await engine.acceptSuggestion(suggestionId);
      return res.json({ success, message: success ? "Task created from suggestion" : "Suggestion expired or already responded" });
    } else {
      const success = await engine.dismissSuggestion(suggestionId);
      return res.json({ success, message: "Suggestion dismissed" });
    }
  } catch (error) {
    console.error("[Proactive] Error responding to suggestion:", error);
    return res.status(500).json({ error: "Failed to respond to suggestion" });
  }
});

// ======================================================================
// PHASE 4: SIMULATIONS
// ======================================================================

/**
 * POST /api/proactive/simulate
 * Run a transaction simulation.
 * Body: { wallet_address, type: "transfer"|"swap"|"stake", ...params }
 */
router.post("/simulate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { wallet_address, type, amount, recipient, coinType, targetCoin, validatorAddress } = req.body;

    if (!wallet_address || !type || !amount) {
      return res.status(400).json({ error: "wallet_address, type, and amount are required" });
    }

    // Lazy import to reduce startup cost
    const { getSimulationService } = await import("../services/simulationService");
    const simService = getSimulationService();

    let result;
    if (type === "transfer") {
      result = await simService.simulateTransfer(wallet_address, recipient || "", amount, coinType || "0x2::sui::SUI");
    } else if (type === "swap") {
      result = await simService.simulateSwap(wallet_address, coinType || "SUI", targetCoin || "", amount);
    } else if (type === "stake") {
      result = await simService.simulateStake(wallet_address, validatorAddress || "", amount);
    } else {
      return res.status(400).json({ error: "type must be 'transfer', 'swap', or 'stake'" });
    }

    return res.json(result);
  } catch (error) {
    console.error("[Proactive] Simulation error:", error);
    return res.status(500).json({ error: "Simulation failed" });
  }
});

/**
 * GET /api/proactive/simulations
 * Get recent simulation logs for a wallet.
 * Query: ?wallet_address=0x...&limit=10
 */
router.get("/simulations", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query.wallet_address as string;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    if (!walletAddress) {
      return res.status(400).json({ error: "wallet_address query param is required" });
    }

    const { getSimulationService } = await import("../services/simulationService");
    const simService = getSimulationService();
    const logs = await simService.getRecentSimulations(walletAddress, limit);

    return res.json({ simulations: logs, count: logs.length });
  } catch (error) {
    console.error("[Proactive] Simulation logs error:", error);
    return res.status(500).json({ error: "Failed to fetch simulation logs" });
  }
});

/**
 * POST /api/proactive/simulations/:id/execute
 * Mark a simulation as executed with the real tx digest.
 * Body: { tx_digest: string }
 */
router.post("/simulations/:id/execute", requireAuth, async (req: Request, res: Response) => {
  try {
    const simId = parseInt(req.params.id, 10);
    const { tx_digest } = req.body;

    if (isNaN(simId)) {
      return res.status(400).json({ error: "Invalid simulation ID" });
    }
    if (!tx_digest) {
      return res.status(400).json({ error: "tx_digest is required" });
    }

    const { getSimulationService } = await import("../services/simulationService");
    const simService = getSimulationService();
    const success = await simService.markExecuted(simId, tx_digest);

    return res.json({ success, message: success ? "Simulation marked as executed" : "Simulation not found" });
  } catch (error) {
    console.error("[Proactive] Mark executed error:", error);
    return res.status(500).json({ error: "Failed to mark simulation as executed" });
  }
});

export default router;
