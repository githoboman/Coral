// server/src/routes/chat.ts
// SSE chat endpoint that routes messages to AI agents

import { Router, Request, Response, NextFunction } from "express";
import { createSSEWriter, type ChatRequest } from "../services/agents/agentTypes";
// import { unifiedRateLimitMiddleware } from "../middleware/unifiedRateLimiter"; // Removed
import { getTaskManagerAgent } from "../services/agents/taskManagerAgent";
import { getSubscriptionService } from "../services/subscriptionService";
import { getChatService } from "../services/chatService";
import { getResearchAgent } from "../services/agents/researchAgent";
import { getUserStateService } from "../services/userStateService";
import { trackTaskCreation } from "../services/agents/taskManagerAgent";


const router = Router();

/**
 * POST /api/chat
 * Body: { user_id, message, chat_id, agent_id, ... }
 */
router.post("/", async (req: Request, res: Response) => {
  console.log("[CHAT ROUTE] POST /api/chat endpoint hit!");

  try {
    const {
      user_id, // Note: Frontend sends snake_case or camelCase? checks below... 
      // Actually the user snippet uses snake_case in destructuring: 
      // const { user_id, message, chat_id, agent_id } = req.body
      message,
      chat_id,
      agent_id,
      transaction_hash,
      history
    } = req.body;

    // Handle both camelCase and snake_case inputs for robustness
    const userId = user_id || req.body.userId;
    const msgContent = message || req.body.message;
    const agentId = agent_id || req.body.agentId;
    const chatId = chat_id || req.body.chatId; // Optional
    const clientTime = req.body.client_time || new Date().toISOString(); // Default to server time if missing

    if (!userId || !msgContent) {
      return res.status(400).json({ error: "user_id and message are required" });
    }

    // ✅ TASK AGENT: Check daily limit
    if (agentId === "task" || agentId === "task_agent") {
      const subscriptionService = getSubscriptionService();
      const canUse = await subscriptionService.canUsePrompt(userId, 'task');

      if (!canUse) {
        const remaining = await subscriptionService.getPromptsRemaining(userId, 'task');
        console.log(`[TASK AGENT LIMIT] User ${userId.substring(0, 10)}... blocked - ${remaining.used}/${remaining.limit} used`);
        return res.status(429).json({
          error: "Task Agent Limit Reached",
          message: remaining.tier === 0
            ? "You need to upgrade to premium to continue chatting. Free tier only gets 2 prompts per day."
            : "You've reached your daily limit of 5 task agent prompts. Try again tomorrow.",
          limit: remaining.limit,
          used: remaining.used,
          requiresUpgrade: remaining.tier === 0,
        });
      }

      // Track usage
      subscriptionService.trackPromptUsage(userId, 'task').catch(() => { });
    }

    // ✅ RESEARCH AGENT: Check daily limit (3 free / 6 premium)
    if (agentId === "research") {
      const subscriptionService = getSubscriptionService();
      const canUse = await subscriptionService.canUsePrompt(userId, 'research');

      if (!canUse) {
        const remaining = await subscriptionService.getPromptsRemaining(userId, 'research');
        console.log(`[RESEARCH AGENT LIMIT] User ${userId.substring(0, 10)}... blocked - ${remaining.used}/${remaining.limit} used`);
        return res.status(429).json({
          error: "Research Agent Limit Reached",
          message: remaining.tier === 0
            ? "You need to upgrade to premium to continue. Free tier only gets 3 research prompts per day."
            : "You've reached your daily limit of 6 research prompts. Try again tomorrow.",
          limit: remaining.limit,
          used: remaining.used,
          requiresUpgrade: remaining.tier === 0,
        });
      }

      // Track usage
      subscriptionService.trackPromptUsage(userId, 'research').catch(() => { });
    }

    // ✅ SSE headers set immediately
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sse = createSSEWriter(res);

    // ── Handle Conversation ID ───────────────────────────────────────
    const chatService = getChatService();
    let finalConversationId = chatId;

    if (!finalConversationId || finalConversationId.startsWith("conv-")) {
      try {
        const newChat = await chatService.createChat(
          userId,
          agentId || "task",
          msgContent.length > 30 ? msgContent.substring(0, 30) + "..." : msgContent
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
      // Send existing ID to ensure client sync
      sse.conversation(finalConversationId);
    }

    // ✅ SPEED FIX: User message save is fire-and-forget
    chatService.addMessage(finalConversationId, userId, "user", msgContent)
      .catch((err) => console.error("[CHAT] Failed to save user message:", err));


    // ── Route to agent ───────────────────────────────────────────────
    try {
      console.log(`[CHAT] ${agentId} agent request from ${userId.substring(0, 10)}...`);

      const agentStart = Date.now();
      let fullResponse = "";

      // Map "task_agent" from legacy payload to "task"
      const normalizedAgentId = (agentId === "task_agent") ? "task" : agentId;

      switch (normalizedAgentId) {
        case "task": {
          const agent = getTaskManagerAgent();
          fullResponse = await agent.handle(
            { userId, agentId: "task", message: msgContent, conversationId: finalConversationId, clientTime },
            sse,
          );
          break;
        }

        case "research": {
          const agent = getResearchAgent();
          fullResponse = await agent.handle(
            { userId, agentId: "research", message: msgContent, conversationId: finalConversationId, clientTime },
            sse
          );
          // Reward user for research agent usage
          trackTaskCreation(userId, "research").catch(err => console.error("[CHAT] Failed to track research points:", err));
          break;
        }

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

      // Save AI Response (fire-and-forget)
      if (finalConversationId && fullResponse) {
        chatService.addMessage(finalConversationId, null, "ai", fullResponse)
          .catch((err) => console.error("[CHAT] Failed to save AI message:", err));
      }

      // Phase 1: Track interaction pattern (fire-and-forget)
      (async () => {
        try {
          const userStateService = getUserStateService();
          const interactionType = normalizedAgentId === "research" ? "research" : "task";
          // Extract token mention from message for research tracking
          const tokenMatch = msgContent.match(/\b(SUI|USDC|USDT|BTC|ETH)\b/i);
          await userStateService.recordInteraction(userId, interactionType, {
            token: tokenMatch ? tokenMatch[1].toUpperCase() : undefined,
          });
        } catch (err) {
          // Non-critical, never block the response
        }
      })();

      // Phase 2: Post-research suggestion trigger (fire-and-forget)
      if (normalizedAgentId === "research" && fullResponse) {
        (async () => {
          try {
            const { getSuggestionEngine } = await import("../services/suggestionEngine");
            await getSuggestionEngine().onResearchComplete(userId, msgContent, fullResponse);
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
      } catch { }
    }

  } catch (error) {
    console.error("[CHAT ROUTE] Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process message" });
    }
  }
});

// ✅ Legacy endpoints requested by user

// Task agent daily prompt status
router.get("/task-prompts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const subscriptionService = getSubscriptionService();
    const remaining = await subscriptionService.getPromptsRemaining(userId, 'task');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const resetInSeconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);

    res.json({
      ...remaining,
      resetInSeconds,
    });
  } catch (error) {
    res.json({ used: 0, limit: 2, remaining: 2, tier: 0 });
  }
});

// Research agent daily prompt status
router.get("/research-prompts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const subscriptionService = getSubscriptionService();
    const remaining = await subscriptionService.getPromptsRemaining(userId, 'research');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const resetInSeconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);

    res.json({
      ...remaining,
      resetInSeconds,
    });
  } catch (error) {
    res.json({ used: 0, limit: 3, remaining: 3, tier: 0 });
  }
});


export default router;
