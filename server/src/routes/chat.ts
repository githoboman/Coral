import { Router } from 'express';
import { agentGraph } from '../services/agents/agent-graph';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatRequest } from '../services/agents/types';
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

// Main chat endpoint - Now with streaming!
router.post('/chat', rateLimitMiddleware, async (req, res) => {
  console.log('[CHAT ROUTE] POST /chat endpoint hit!');
  console.log('[CHAT ROUTE] Request body:', req.body);

  try {
    const { user_id, message, chat_id, agent_id, transaction_hash }: ChatRequest = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'user_id and message are required' });
    }

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

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
      gasPaid: !!transaction_hash,
    };

    console.log('[CHAT ROUTE] Initial state:', {
      hasTransactionHash: !!transaction_hash,
      gasPaid: !!transaction_hash,
    });

    // Variables to collect the complete response
    let finalResponse = '';
    let targetAgent = 'main';
    let requiresFee: boolean | undefined = undefined;
    let estimatedCost: number | undefined = undefined;
    let workflowSteps: any = undefined;
    let pendingAction: { taskId: number; actionType: string; actionParams: any } | undefined = undefined;

    try {
      // Stream the graph execution
      const stream = await agentGraph.stream(initialState);

      for await (const chunk of stream) {
        // Send each chunk to the user immediately
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Collect data from chunks to build final state
        // Each chunk is a Record<string, Partial<AgentState>> where keys are node names
        for (const nodeUpdate of Object.values(chunk)) {
          const update = nodeUpdate as any;
          if (update.finalResponse) {
            finalResponse = update.finalResponse;
          }
          if (update.targetAgent) {
            targetAgent = update.targetAgent;
          }
          if (update.requiresFee !== undefined) {
            requiresFee = update.requiresFee;
          }
          if (update.estimatedCost !== undefined) {
            estimatedCost = update.estimatedCost;
          }
          if (update.workflowSteps) {
            workflowSteps = update.workflowSteps;
          }
          if (update.pendingAction) {
            pendingAction = update.pendingAction;
          }
        }
      }

      // Send completion marker
      res.write('data: [DONE]\n\n');
      res.end();

      console.log('[CHAT ROUTE] Streaming completed. Final response length:', finalResponse.length);

    } catch (streamError) {
      console.error('[CHAT ROUTE] Streaming error:', streamError);
      res.write(`data: ${JSON.stringify({ error: 'Stream failed', details: streamError instanceof Error ? streamError.message : 'Unknown error' })}\n\n`);
      res.end();
      return;
    }

    // Handle database operations asynchronously in the background (don't await)
    (async () => {
      try {
        console.log('[CHAT ROUTE] Starting background database operations...');

        // Generate chat_id if not provided
        let activeChatId = chat_id;
        if (!activeChatId) {
          // Generate smart title using LLM
          const chatTitle = await generateChatTitle(message, finalResponse || '');

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
            console.error('[CHAT ROUTE] Error creating chat:', chatError);
            return;
          }

          activeChatId = newChat.chat_id;
          console.log('[CHAT ROUTE] Created new chat:', activeChatId);
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
          query: finalResponse || 'No response generated',
          sender: 'ai',
        });

        // Update chat last_updated
        await supabase
          .from('chats')
          .update({ last_updated: new Date().toISOString() })
          .eq('chat_id', activeChatId);

        // Award chat points (max 5/day)
        const pointsResult = await awardChatPoints(user_id);

        console.log('[CHAT ROUTE] Database operations completed for chat:', activeChatId);
        console.log('[CHAT ROUTE] Points awarded:', pointsResult.points_awarded);
      } catch (dbError) {
        console.error('[CHAT ROUTE] Error in background database operations:', dbError);
      }
    })();

  } catch (error) {
    console.error('[CHAT ROUTE] Chat error:', error);
    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to process message',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      // If streaming already started, send error as SSE
      res.write(`data: ${JSON.stringify({ error: 'Processing failed' })}\n\n`);
      res.end();
    }
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
      resetInSeconds: count >= LIMIT ? ttl : null,
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