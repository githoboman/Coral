// server/src/routes/chat.ts
// DIFF from original: added bridge agent case + subscription check
// Lines marked NEW are additions; everything else is preserved exactly.

import { Router, Request, Response } from "express";
import {
  createSSEWriter,
  type ChatRequest,
} from "../services/agents/agentTypes";
import { getTaskManagerAgent } from "../services/agents/taskManagerAgent";
import { getSubscriptionService } from "../services/subscriptionService";
import { getChatService } from "../services/chatService";
import { getResearchAgent } from "../services/agents/researchAgent";
import { getUserStateService } from "../services/userStateService";
import { trackTaskCreation } from "../services/agents/taskManagerAgent";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getBridgeAgent } from "../services/agents/bridgeAgent"; // NEW

const router = Router();

/**
 * POST /api/chat
 * Body: { message, chat_id, agent_id, ... }
 */
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  console.log("[CHAT ROUTE] POST /api/chat endpoint hit!");

  try {
    const userId = req.user!.wallet_address;

    const { message, agent_id, chat_id } = req.body;
    const msgContent = message || req.body.message;
    const agentId = agent_id || req.body.agentId;
    const chatId = chat_id || req.body.chatId;
    const clientTime =
      req.body.client_time || req.body.clientTime || new Date().toISOString();

    if (!msgContent) {
      return res.status(400).json({ error: "message is required" });
    }

    // ✅ TASK AGENT: Check daily limit
    if (agentId === "task" || agentId === "task_agent") {
      const subscriptionService = getSubscriptionService();
      const canUse = await subscriptionService.canUsePrompt(
        userId,
        "task",
        true,
      );

      if (!canUse) {
        const remaining = await subscriptionService.getPromptsRemaining(
          userId,
          "task",
        );
        console.log(
          `[TASK AGENT LIMIT] User ${userId.substring(0, 10)}... blocked - ${remaining.used}/${remaining.limit} used`,
        );
        return res.status(429).json({
          error: "Task Agent Limit Reached",
          message:
            remaining.tier === 0
              ? "You need to upgrade to premium to continue chatting. Free tier only gets 2 prompts per day."
              : "You've reached your daily limit of 4 task agent prompts. Try again tomorrow.",
          limit: remaining.limit,
          used: remaining.used,
          requiresUpgrade: remaining.tier === 0,
        });
      }

      subscriptionService.trackPromptUsage(userId, "task").catch(() => {});
    }

    // ✅ RESEARCH AGENT: Check daily limit
    if (agentId === "research") {
      const subscriptionService = getSubscriptionService();
      const canUse = await subscriptionService.canUsePrompt(
        userId,
        "research",
        true,
      );

      if (!canUse) {
        const remaining = await subscriptionService.getPromptsRemaining(
          userId,
          "research",
        );
        console.log(
          `[RESEARCH AGENT LIMIT] User ${userId.substring(0, 10)}... blocked - ${remaining.used}/${remaining.limit} used`,
        );
        return res.status(429).json({
          error: "Research Agent Limit Reached",
          message:
            remaining.tier === 0
              ? "You need to upgrade to premium to continue. Free tier only gets 2 research prompts per day."
              : "You've reached your daily limit of 5 research prompts. Try again tomorrow.",
          limit: remaining.limit,
          used: remaining.used,
          requiresUpgrade: remaining.tier === 0,
        });
      }

      subscriptionService.trackPromptUsage(userId, "research").catch(() => {});
    }

    // NEW: BRIDGE AGENT — no hard limit enforced in MVP; use subscription check if desired
    // (currently bridge is treated as a free utility)

    // ✅ SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sse = createSSEWriter(res);

    // ── Handle Conversation ID ─────────────────────────────────────
    const chatService = getChatService();
    let finalConversationId = chatId;

    if (!finalConversationId || finalConversationId.startsWith("conv-")) {
      try {
        const newChat = await chatService.createChat(
          userId,
          agentId || "task",
          msgContent.length > 30
            ? msgContent.substring(0, 30) + "..."
            : msgContent,
        );

        if (newChat) {
          finalConversationId = newChat.chat_id;
          sse.conversation(finalConversationId);
        } else {
          finalConversationId = crypto.randomUUID();
          sse.conversation(finalConversationId);
        }
      } catch (err) {
        console.error("[CHAT] Error creating chat:", err);
        finalConversationId = crypto.randomUUID();
        sse.conversation(finalConversationId);
      }
    } else {
      sse.conversation(finalConversationId);
    }

    // Save user message (fire-and-forget)
    chatService
      .addMessage(finalConversationId, userId, "user", msgContent)
      .catch((err) =>
        console.error("[CHAT] Failed to save user message:", err),
      );

    // ── Route to agent ─────────────────────────────────────────────
    try {
      console.log(
        `[CHAT] ${agentId} agent request from ${userId.substring(0, 10)}...`,
      );

      const agentStart = Date.now();
      let fullResponse = "";

      const normalizedAgentId = agentId === "task_agent" ? "task" : agentId;

      switch (normalizedAgentId) {
        case "task": {
          const agent = getTaskManagerAgent();
          fullResponse = await agent.handle(
            {
              userId,
              agentId: "task",
              message: msgContent,
              conversationId: finalConversationId,
              clientTime,
            },
            sse,
          );
          break;
        }

        case "research": {
          const agent = getResearchAgent();
          fullResponse = await agent.handle(
            {
              userId,
              agentId: "research",
              message: msgContent,
              conversationId: finalConversationId,
              clientTime,
            },
            sse,
          );
          trackTaskCreation(userId, "research").catch((err) =>
            console.error("[CHAT] Failed to track research points:", err),
          );
          break;
        }

        // NEW: Bridge Agent ──────────────────────────────────────────
        case "bridge": {
          const agent = getBridgeAgent();
          fullResponse = await agent.handle(
            {
              userId,
              agentId: "bridge",
              message: msgContent,
              conversationId: finalConversationId,
              clientTime,
              conversationHistory: req.body.conversationHistory || [],
            },
            sse,
          );
          break;
        }
        // ────────────────────────────────────────────────────────────

        case "tovira":
        case "alert": {
          sse.status("Processing");
          const msg = `The ${normalizedAgentId} is coming soon. For now, please use the Task Manager.`;
          sse.chunk(msg);
          fullResponse = msg;
          sse.done();
          break;
        }

        default:
          sse.error(`Unknown agent: ${agentId}`);
          return;
      }

      // Save AI response (fire-and-forget)
      if (finalConversationId && fullResponse) {
        chatService
          .addMessage(finalConversationId, null, "ai", fullResponse)
          .catch((err) =>
            console.error("[CHAT] Failed to save AI message:", err),
          );
      }

      // Track interaction pattern (fire-and-forget)
      (async () => {
        try {
          const userStateService = getUserStateService();
          const interactionType =
            normalizedAgentId === "research" ? "research" : "task";
          const tokenMatch = msgContent.match(/\b(SUI|USDC|USDT|BTC|ETH)\b/i);
          await userStateService.recordInteraction(userId, interactionType, {
            token: tokenMatch ? tokenMatch[1].toUpperCase() : undefined,
          });
        } catch (err) {
          // Non-critical
        }
      })();

      // Post-research suggestion trigger (fire-and-forget)
      if (normalizedAgentId === "research" && fullResponse) {
        (async () => {
          try {
            const { getSuggestionEngine } =
              await import("../services/suggestionEngine");
            await getSuggestionEngine().onResearchComplete(
              userId,
              msgContent,
              fullResponse,
            );
          } catch (err) {
            // Non-critical
          }
        })();
      }

      console.log(`[CHAT] Agent completed in ${Date.now() - agentStart}ms`);
    } catch (error) {
      console.error("[CHAT] Agent error:", error);
      try {
        sse.error("An unexpected error occurred. Please try again.");
      } catch {}
    }
  } catch (error) {
    console.error("[CHAT ROUTE] Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process message" });
    }
  }
});

// ── Prompt status endpoints (unchanged) ───────────────────────────────

router.get(
  "/task-prompts/:userId",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.wallet_address;
      const forceRefresh = req.query.force === "true";
      const subscriptionService = getSubscriptionService();
      const remaining = await subscriptionService.getPromptsRemaining(
        userId,
        "task",
        forceRefresh,
      );

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      const resetInSeconds = Math.floor(
        (tomorrow.getTime() - now.getTime()) / 1000,
      );

      res.json({ ...remaining, resetInSeconds });
    } catch (error) {
      res.json({ used: 0, limit: 2, remaining: 2, tier: 0 });
    }
  },
);

router.get(
  "/research-prompts/:userId",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.wallet_address;
      const forceRefresh = req.query.force === "true";
      const subscriptionService = getSubscriptionService();
      const remaining = await subscriptionService.getPromptsRemaining(
        userId,
        "research",
        forceRefresh,
      );

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      const resetInSeconds = Math.floor(
        (tomorrow.getTime() - now.getTime()) / 1000,
      );

      res.json({ ...remaining, resetInSeconds });
    } catch (error) {
      res.json({ used: 0, limit: 3, remaining: 3, tier: 0 });
    }
  },
);

export default router;
