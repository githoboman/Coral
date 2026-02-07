import { Router } from 'express';
import { agentGraph } from '../services/agents/agent-graph';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatRequest, ChatResponse } from '../services/agents/types';
import getSupabaseClient from '../config/supabase';
import { rateLimitMiddleware, redisClient } from '../middleware/rateLimiter';
import { awardChatPoints } from '../services/pointsService';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { fetchBalanceDirect } from "../services/agents/tools/sui";

const router = Router();
const supabase = getSupabaseClient();

// LLM for generating chat titles
const titleModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.3,
  maxOutputTokens: 30,
  apiKey: process.env.GEMINI_API_KEY,
});

// Generate a concise, descriptive chat title using LLM
async function generateChatTitle(userMessage: string, aiResponse: string): Promise<string> {
  try {
    const prompt = `Generate a short, concise title (3-6 words max) for this chat. No quotes, no punctuation at end.

User: ${userMessage.substring(0, 200)}
Assistant: ${aiResponse.substring(0, 200)}

Title:`;

    const result = await titleModel.invoke(prompt);
    const title = (result.content as string).trim().substring(0, 50);
    return title || userMessage.substring(0, 50);
  } catch (error) {
    console.error('Error generating chat title:', error);
    return userMessage.substring(0, 50);
  }
}

// Main chat endpoint
router.post('/chat', rateLimitMiddleware, async (req, res) => {
  console.log('[CHAT ROUTE] POST /chat endpoint hit!');
  console.log('[CHAT ROUTE] Request body:', req.body);
  try {
    const { user_id, message, chat_id, agent_id, transaction_hash }: ChatRequest = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'user_id and message are required' });
    }

    // Initialize state
    const historyMessages = (req.body.history || []).map((msg: any) =>
      msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
    );

    // Fetch balance if wallet address
    let walletBalance = undefined;
    if (user_id.startsWith('0x')) {
      walletBalance = await fetchBalanceDirect(user_id);
    }

    const initialState = {
      messages: [...historyMessages, new HumanMessage(message)],
      userQuery: message,
      userId: user_id,
      walletAddress: user_id.startsWith('0x') ? user_id : undefined,
      walletBalance,
      chatId: chat_id,
      transactionHash: transaction_hash,
      gasPaid: !!transaction_hash, // If transaction hash provided, gas is paid
    };

    console.log('[CHAT ROUTE] Initial state:', {
      hasTransactionHash: !!transaction_hash,
      gasPaid: !!transaction_hash,
    });

    // Run the graph
    const result = await agentGraph.invoke(initialState);

    // Generate chat_id if not provided
    let activeChatId = chat_id;
    if (!activeChatId) {
      // Generate smart title using LLM
      const chatTitle = await generateChatTitle(message, result.finalResponse as string || '');

      // Create new chat
      const { data: newChat, error: chatError } = await supabase
        .from('chats')
        .insert({
          user_id,
          name: chatTitle,
          agent_id: agent_id || 'main',
        })
        .select('chat_id')
        .single();

      if (chatError) {
        console.error('Error creating chat:', chatError);
        return res.status(500).json({ error: 'Failed to create chat' });
      }

      activeChatId = newChat.chat_id;
    }

    // Save user message
    await supabase.from('chat_messages').insert({
      chat_id: activeChatId,
      user_id,
      query: message,
      sender: 'user',
    });

    // Save AI response
    await supabase.from('chat_messages').insert({
      chat_id: activeChatId,
      user_id,
      query: result.finalResponse || 'No response generated',
      sender: 'ai',
    });

    // Update chat last_updated
    await supabase
      .from('chats')
      .update({ last_updated: new Date().toISOString() })
      .eq('chat_id', activeChatId);

    // Award chat points (max 5/day)
    const pointsResult = await awardChatPoints(user_id);

    const pendingAction = result.pendingAction as { taskId: number; actionType: string; actionParams: any } | undefined;
    console.log('[CHAT ROUTE] pendingAction from result:', pendingAction);

    const response: ChatResponse = {
      response: (result.finalResponse as string) || 'No response generated',
      agent_used: (result.targetAgent as string) || 'main',
      chat_id: activeChatId as string,
      requires_fee: result.requiresFee as boolean | undefined,
      estimated_cost: result.estimatedCost as number | undefined,
      workflow_steps: result.workflowSteps as any,
      points_awarded: pointsResult.points_awarded,
      pending_action: pendingAction ? {
        task_id: pendingAction.taskId,
        action_type: pendingAction.actionType,
        action_params: pendingAction.actionParams,
      } : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Streaming endpoint (SSE)
router.post('/chat/stream', async (req, res) => {
  try {
    const { user_id, message, chat_id }: ChatRequest = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'user_id and message are required' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    const initialState = {
      messages: [new HumanMessage(message)],
      userQuery: message,
      userId: user_id,
      chatId: chat_id,
    };

    // Stream the graph execution
    const stream = await agentGraph.stream(initialState);

    for await (const chunk of stream) {
      // Send each chunk as SSE
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    res.end();
  }
});

// Get chat history
router.get('/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { agentId } = req.query;

    let query = supabase
      .from('chats')
      .select('*')
      .eq('user_id', userId)
      .order('last_updated', { ascending: false });

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data: chats, error } = await query;

    if (error) {
      console.error('Error fetching chats:', error);
      return res.status(500).json({ error: 'Failed to fetch chats' });
    }

    res.json(chats);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get messages for a chat
router.get('/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;

    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }

    res.json(messages);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get rate limit status for a user
router.get('/rate-limit/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const LIMIT = 4;
    const key = `ratelimit:${userId}`;

    // If Redis not available, return unlimited
    if (!redisClient || !redisClient.isOpen) {
      return res.json({
        limit: LIMIT,
        remaining: LIMIT,
        resetIn: null,
        isLimited: false
      });
    }

    const current = await redisClient.get(key);
    const count = current ? parseInt(current) : 0;
    const ttl = count > 0 ? await redisClient.ttl(key) : 0;

    res.json({
      limit: LIMIT,
      remaining: Math.max(0, LIMIT - count),
      resetInSeconds: count >= LIMIT ? ttl : null, // seconds for countdown
      isLimited: count >= LIMIT
    });
  } catch (error) {
    console.error('Error checking rate limit:', error);
    // On error, assume not limited
    res.json({
      limit: 4,
      remaining: 4,
      resetIn: null,
      isLimited: false
    });
  }
});

export default router;

