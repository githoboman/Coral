import { Router } from "express";
import { agentGraph } from "../services/agents/agent-graph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatRequest } from "../services/agents/types";
import getSupabaseClient from "../config/supabase";
import { rateLimitMiddleware, redisClient } from "../middleware/rateLimiter";
import { awardChatPoints } from "../services/pointsService";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { fetchBalanceDirect } from "../services/agents/tools/sui";
import { getSubscriptionService } from "../services/subscriptionService";

const router = Router();
const supabase = getSupabaseClient();

function generateChatTitle(userMessage: string): string {
  const cleanMessage = userMessage.trim().replace(/\n/g, " ");
  if (cleanMessage.length <= 40) return cleanMessage;
  return cleanMessage.substring(0, 37) + "...";
}

router.post("/chat", rateLimitMiddleware, async (req, res) => {
  console.log("[CHAT ROUTE] POST /chat endpoint hit!");

  try {
    const {
      user_id,
      message,
      chat_id,
      agent_id,
      transaction_hash,
    }: ChatRequest = req.body;

    if (!user_id || !message) {
      return res
        .status(400)
        .json({ error: "user_id and message are required" });
    }

    // ✅ TASK AGENT: Check daily limit only (general 6h limiter skipped in rateLimiter.ts)
    // canUsePrompt() checks Redis first (fast), falls back to Walrus only on cache miss
    if (agent_id === "task_agent") {
      const subscriptionService = getSubscriptionService();
      const canUse = await subscriptionService.canUsePrompt(user_id);

      if (!canUse) {
        const remaining =
          await subscriptionService.getPromptsRemaining(user_id);
        console.log(
          `[TASK AGENT LIMIT] User ${user_id.substring(0, 10)}... blocked - ${remaining.used}/${remaining.limit} used (tier ${remaining.tier})`,
        );
        return res.status(429).json({
          error: "Task Agent Limit Reached",
          message:
            remaining.tier === 0
              ? "You need to upgrade to premium to continue chatting. Free tier only gets 2 prompts per day."
              : "You've reached your daily limit of 5 task agent prompts. Try again tomorrow.",
          limit: remaining.limit,
          used: remaining.used,
          remaining: 0,
          tier: remaining.tier,
          requiresUpgrade: remaining.tier === 0,
        });
      }

      // ✅ SPEED FIX: Track usage fire-and-forget so stream starts immediately
      // Walrus write happens in background — AI response is not delayed
      (async () => {
        try {
          await subscriptionService.trackPromptUsage(user_id);
          console.log(
            `[TASK AGENT] Prompt tracked for ${user_id.substring(0, 10)}...`,
          );
        } catch (err) {
          console.warn("[TASK AGENT] Failed to track prompt usage:", err);
        }
      })();
    }

    // ✅ SSE headers set immediately — stream opens before any DB work
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Chat ID creation (must be awaited — needed for the stream metadata)
    let activeChatId = chat_id;
    if (!activeChatId) {
      const chatTitle = generateChatTitle(message);
      const { data: newChat, error: chatError } = await supabase
        .from("chats")
        .insert({ user_id, name: chatTitle, agent_id: agent_id || "main" })
        .select("chat_id")
        .single();

      if (chatError) {
        console.error("[CHAT ROUTE] Error creating chat:", chatError);
        return res.status(500).json({ error: "Failed to create chat" });
      }
      activeChatId = newChat.chat_id;
      console.log("[CHAT ROUTE] Created new chat:", activeChatId);
    }

    // ✅ SPEED FIX: User message save is fire-and-forget — don't block stream start
    (async () => {
      try {
        await supabase.from("chat_messages").insert({
          chat_id: activeChatId,
          user_id,
          query: message,
          sender: "user",
        });
      } catch (e) {
        console.warn("[CHAT ROUTE] Failed to save user message:", e);
      }
    })();

    // Send chat_id to client immediately
    res.write(`data: ${JSON.stringify({ chat_id: activeChatId })}\n\n`);

    const historyMessages = (req.body.history || []).map((msg: any) =>
      msg.role === "user"
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content),
    );

    let walletBalance = undefined;
    if (user_id.startsWith("0x")) {
      walletBalance = await fetchBalanceDirect(user_id);
    }

    const initialState = {
      messages: [...historyMessages, new HumanMessage(message)],
      userQuery: message,
      userId: user_id,
      walletAddress: user_id.startsWith("0x") ? user_id : undefined,
      walletBalance,
      chatId: activeChatId,
      targetAgent: agent_id,
      transactionHash: transaction_hash,
      gasPaid: !!transaction_hash,
    };

    let finalResponse = "";
    let targetAgent = "main";
    let requiresFee: boolean | undefined = undefined;
    let estimatedCost: number | undefined = undefined;
    let workflowSteps: any = undefined;
    let pendingAction: any = undefined;

    try {
      const stream = await agentGraph.stream(initialState);
      for await (const chunk of stream) {
        const flattenedUpdate: any = {};
        for (const nodeUpdate of Object.values(chunk)) {
          Object.assign(flattenedUpdate, nodeUpdate);
        }
        res.write(`data: ${JSON.stringify(flattenedUpdate)}\n\n`);

        if (flattenedUpdate.finalResponse)
          finalResponse = flattenedUpdate.finalResponse;
        if (flattenedUpdate.targetAgent)
          targetAgent = flattenedUpdate.targetAgent;
        if (flattenedUpdate.requiresFee !== undefined)
          requiresFee = flattenedUpdate.requiresFee;
        if (flattenedUpdate.estimatedCost !== undefined)
          estimatedCost = flattenedUpdate.estimatedCost;
        if (flattenedUpdate.workflowSteps)
          workflowSteps = flattenedUpdate.workflowSteps;
        if (flattenedUpdate.pendingAction)
          pendingAction = flattenedUpdate.pendingAction;
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (streamError) {
      console.error("[CHAT ROUTE] Streaming error:", streamError);
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
      return;
    }

    // ✅ All post-stream DB work is fire-and-forget — user already sees the response
    (async () => {
      try {
        if (finalResponse) {
          await supabase.from("chat_messages").insert({
            chat_id: activeChatId,
            user_id,
            query: finalResponse,
            sender: "ai",
          });
          await supabase
            .from("chats")
            .update({ last_updated: new Date().toISOString() })
            .eq("chat_id", activeChatId);
        }
        await awardChatPoints(user_id);
      } catch (dbError) {
        console.error("[CHAT ROUTE] Background DB error:", dbError);
      }
    })();
  } catch (error) {
    console.error("[CHAT ROUTE] Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to process message",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Processing failed" })}\n\n`);
      res.end();
    }
  }
});

// Get chat history
router.get("/chats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { agentId } = req.query;

    let query = supabase
      .from("chats")
      .select("*")
      .eq("user_id", userId)
      .order("last_updated", { ascending: false });

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }

    const { data: chats, error } = await query;
    if (error) {
      console.error("Error fetching chats:", error);
      return res.status(500).json({ error: "Failed to fetch chats" });
    }
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// Get messages for a chat
router.get("/chats/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("Error fetching messages:", error);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// General agent rate limit status
router.get("/rate-limit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const LIMIT = 4;
    const key = `ratelimit:${userId}`;

    if (!redisClient || !redisClient.isOpen) {
      return res.json({
        limit: LIMIT,
        remaining: LIMIT,
        resetIn: null,
        isLimited: false,
      });
    }

    const current = await redisClient.get(key);
    const count = current ? parseInt(current) : 0;
    const ttl = count > 0 ? await redisClient.ttl(key) : 0;

    res.json({
      limit: LIMIT,
      remaining: Math.max(0, LIMIT - count),
      resetInSeconds: count >= LIMIT ? ttl : null,
      isLimited: count >= LIMIT,
    });
  } catch (error) {
    res.json({ limit: 4, remaining: 4, resetIn: null, isLimited: false });
  }
});

// Task agent daily prompt status (subscription-aware: 2 free / 5 premium)
// Task agent daily prompt status (subscription-aware: 2 free / 5 premium)
router.get("/task-prompts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const subscriptionService = getSubscriptionService();

    console.log(
      `\n[TASK PROMPTS] Getting status for ${userId.substring(0, 10)}...`,
    );

    // ✅ Get tier from blockchain (source of truth)
    const tierStatus = await subscriptionService.getCurrentTier(userId);
    const limit = tierStatus.isActivePremium ? 5 : 2;

    // ✅ Get usage from Redis (same source that blocks users)
    const today = new Date().toISOString().split("T")[0];
    let used = 0;

    if (redisClient && redisClient.isOpen) {
      try {
        const redisKey = `prompts:${userId}:${today}`;
        const count = await redisClient.get(redisKey);
        used = count ? parseInt(count) : 0;
        console.log(`[TASK PROMPTS] Redis: ${redisKey} = ${used}`);
      } catch (redisError) {
        console.warn("[TASK PROMPTS] Redis failed, using Walrus fallback");
        const remaining = await subscriptionService.getPromptsRemaining(userId);
        used = remaining.used;
      }
    } else {
      // No Redis - fallback to Walrus
      const remaining = await subscriptionService.getPromptsRemaining(userId);
      used = remaining.used;
    }

    const result = {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      tier: tierStatus.tier,
    };

    console.log(`[TASK PROMPTS] Returning: ${JSON.stringify(result)}`);

    res.json(result);
  } catch (error) {
    console.error("Error checking task prompt status:", error);
    res.json({ used: 0, limit: 2, remaining: 2, tier: 0 });
  }
});

export default router;
