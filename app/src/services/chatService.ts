

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface ChatMessage {
  user_id: string;
  message: string;
  agent_id?: string;
  chat_id?: string;
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
}

export async function sendChatMessage(data: ChatMessage): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Chat API error: ${response.statusText}`);
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
