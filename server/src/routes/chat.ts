// server/src/routes/chat.ts
import { Router } from "express";
import { agentGraph } from "../services/agents/graph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatRequest, ChatResponse } from "../services/agents/types";
import {
  unifiedRateLimitMiddleware,
  trackMessageUsage,
} from "../middleware/unifiedRateLimiter";
import { awardChatPoints } from "../services/pointsService";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { fetchBalanceDirect } from "../services/agents/tools/sui";
import { getChatStorageService } from "../services/chatStorageService";

const router = Router();

const titleModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.3,
  maxOutputTokens: 30,
  apiKey: process.env.GEMINI_API_KEY,
});

// Generate chat title
async function generateChatTitle(
  userMessage: string,
  aiResponse: string,
): Promise<string> {
  try {
    const prompt = `Generate a short, concise title (3-6 words max) for this chat. No quotes, no punctuation at end.

User: ${userMessage.substring(0, 200)}
Assistant: ${aiResponse.substring(0, 200)}

Title:`;

    const result = await titleModel.invoke(prompt);
    const title = (result.content as string).trim().substring(0, 50);
    return title || userMessage.substring(0, 50);
  } catch (error) {
    console.error("Error generating chat title:", error);
    return userMessage.substring(0, 50);
  }
}

// Main chat endpoint - Use unified rate limiter
router.post("/chat", unifiedRateLimitMiddleware, async (req, res) => {
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

    // Validate user_id format (Sui address)
    if (!user_id.startsWith("0x") || user_id.length !== 66) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    // Get chat storage service
    const chatStorage = getChatStorageService();

    // Fetch wallet balance if needed
    let walletBalance = undefined;
    if (user_id.startsWith("0x")) {
      walletBalance = await fetchBalanceDirect(user_id);
    }

    // Load chat history if chat_id provided
    let historyMessages: any[] = [];
    if (chat_id) {
      const messages = await chatStorage.getMessages(chat_id);
      historyMessages = messages.map((msg) =>
        msg.sender === "user"
          ? new HumanMessage(msg.text)
          : new AIMessage(msg.text),
      );
    } else if (req.body.history) {
      historyMessages = req.body.history.map((msg: any) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content),
      );
    }

    const initialState = {
      messages: [...historyMessages, new HumanMessage(message)],
      userQuery: message,
      userId: user_id,
      walletAddress: user_id.startsWith("0x") ? user_id : undefined,
      walletBalance,
      chatId: chat_id,
      transactionHash: transaction_hash,
      gasPaid: !!transaction_hash,
    };

    // Run agent graph
    const result = await agentGraph.invoke(initialState);

    // Create new chat if needed
    let activeChatId = chat_id;
    if (!activeChatId) {
      const chatTitle = await generateChatTitle(
        message,
        (result.finalResponse as string) || "",
      );

      const { chatId: newChatId, registryBlobId } =
        await chatStorage.createChat(user_id, chatTitle, agent_id || "main");

      activeChatId = newChatId;

      console.log(
        `✅ New chat created: ${newChatId}, Registry: ${registryBlobId}`,
      );
    }

    // Save messages to Walrus
    await chatStorage.addMessage(activeChatId, user_id, {
      id: `${Date.now()}_user`,
      text: message,
      sender: "user",
      timestamp: new Date().toISOString(),
    });

    await chatStorage.addMessage(activeChatId, user_id, {
      id: `${Date.now()}_ai`,
      text: (result.finalResponse as string) || "No response generated",
      sender: "ai",
      timestamp: new Date().toISOString(),
      agentType: result.targetAgent as string,
      agentId: agent_id || "main",
    });

    // ✅ Track usage AFTER successful response
    if ((req as any).shouldTrackUsage) {
      await trackMessageUsage(user_id);
    }

    // Award chat points
    const pointsResult = await awardChatPoints(user_id);

    const pendingAction = result.pendingAction as
      | { taskId: string; actionType: string; actionParams: any }
      | undefined;

    const response: ChatResponse = {
      response: (result.finalResponse as string) || "No response generated",
      agent_used: (result.targetAgent as string) || "main",
      chat_id: activeChatId as string,
      requires_fee: result.requiresFee as boolean | undefined,
      estimated_cost: result.estimatedCost as number | undefined,
      workflow_steps: result.workflowSteps as any,
      points_awarded: pointsResult.points_awarded,
      pending_action: pendingAction
        ? {
            task_id: pendingAction.taskId,
            action_type: pendingAction.actionType,
            action_params: pendingAction.actionParams,
          }
        : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Failed to process message",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get chat history for user
router.get("/chats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId.startsWith("0x") || userId.length !== 66) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const chatStorage = getChatStorageService();
    const chats = await chatStorage.getChatList(userId);

    res.json(chats);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// Get messages for a chat
router.get("/chats/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (!user_id.startsWith("0x") || user_id.length !== 66) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const chatStorage = getChatStorageService();
    const messages = await chatStorage.getMessages(chatId);

    res.json(messages);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Delete chat
router.delete("/chats/:chatId", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (!user_id.startsWith("0x") || user_id.length !== 66) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const chatStorage = getChatStorageService();
    const success = await chatStorage.deleteChat(user_id, chatId);

    if (!success) {
      return res.status(500).json({ error: "Failed to delete chat" });
    }

    res.json({ message: "Chat deleted successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// Get message usage status
router.get("/message-usage/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId.startsWith("0x") || userId.length !== 66) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const { getSubscriptionService } =
      await import("../services/subscriptionService");
    const subscriptionService = getSubscriptionService();

    const stats = await subscriptionService.getPromptsRemaining(userId);

    res.json({
      ...stats,
      reset_at: "midnight UTC",
    });
  } catch (error) {
    console.error("Error checking message usage:", error);
    res.json({
      used: 0,
      limit: 2,
      remaining: 2,
      tier: 0,
      reset_at: "midnight UTC",
    });
  }
});

export default router;
