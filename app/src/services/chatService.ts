

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface ChatMessage {
  user_id: string;
  message: string;
  agent_id?: string;
  chat_id?: string;
  transaction_hash?: string; // Gas payment transaction hash
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface ChatResponse {
  response: string;
  agent_used: string;
  chat_id: string;
  requires_fee?: boolean;
  estimated_cost?: number;
  workflow_steps?: Array<{
    step: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    message: string;
  }>;
  pending_action?: {
    task_id: number;
    action_type: string;
    action_params: {
      recipientAddress?: string;
      coinType?: string;
      amount?: string;
    };
  };
}

export async function sendChatMessage(data: ChatMessage): Promise<ChatResponse> {
  const url = `${API_BASE_URL}/api/chat`;
  console.log('[ChatService] Sending message to:', url);
  console.log('[ChatService] Request data:', { ...data, message: data.message.substring(0, 50) + '...' });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  console.log('[ChatService] Response status:', response.status, response.statusText);

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      const errorText = await response.text();
      errorData = { message: errorText };
    }

    console.error('[ChatService] Error response:', errorData);

    // Create error with response data for rate limiting
    const error: any = new Error(errorData.message || `Chat API error: ${response.statusText}`);
    error.response = {
      status: response.status,
      data: errorData
    };
    throw error;
  }

  return response.json();
}

export async function fetchChats(userId: string) {
  const response = await fetch(`${API_BASE_URL}/api/chats/${userId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch chats: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchChatMessages(chatId: string) {
  const response = await fetch(`${API_BASE_URL}/api/chats/${chatId}/messages`);

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.statusText}`);
  }

  return response.json();
}

// Helper to generate chat ID (for local state before server creates one)
export function generateChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetInSeconds: number | null; // seconds until reset, null if not limited
  isLimited: boolean;
}

export async function getRateLimitStatus(userId: string): Promise<RateLimitStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/rate-limit/${userId}`);

    if (!response.ok) {
      // On error, assume not limited
      return { limit: 4, remaining: 4, resetInSeconds: null, isLimited: false };
    }

    return response.json();
  } catch (error) {
    console.error('[ChatService] Error checking rate limit:', error);
    return { limit: 4, remaining: 4, resetInSeconds: null, isLimited: false };
  }
}

