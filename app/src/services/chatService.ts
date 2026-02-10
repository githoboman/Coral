// src/services/chatService.ts
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export interface ChatMessage {
  user_id: string;
  message: string;
  chat_id?: string;
  agent_id?: string;
  transaction_hash?: string;
  history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export interface ChatResponse {
  response: string;
  agent_used: string;
  chat_id: string;
  requires_fee?: boolean;
  estimated_cost?: number;
  workflow_steps?: any[];
  points_awarded?: number;
  pending_action?: {
    task_id: number;
    action_type: string;
    action_params: any;
  };
}

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetInSeconds: number | null;
  isLimited: boolean;
}

export interface TaskPromptStatus {
  used: number;
  limit: number;
  remaining: number;
  tier: number;
}

/**
 * Send a chat message to the backend
 */
export async function sendChatMessage(
  data: ChatMessage,
): Promise<ChatResponse> {
  const response = await axios.post(`${API_BASE_URL}/api/chat`, data);
  return response.data;
}

/**
 * Get rate limit status for a user
 */
export async function getRateLimitStatus(
  userId: string,
): Promise<RateLimitStatus> {
  const response = await axios.get(`${API_BASE_URL}/api/rate-limit/${userId}`);
  return response.data;
}

/**
 * Track task creation for points (fire-and-forget)
 * Call this immediately after a task is created via the task agent
 */
export async function trackTaskCreation(userId: string): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/task-points/track-creation`, {
      user_id: userId,
    });
    console.log("[TASK TRACKING] Task creation tracked successfully");
  } catch (error) {
    console.error("[TASK TRACKING] Failed to track task creation:", error);
    // Don't throw - task creation should succeed even if tracking fails
  }
}

/**
 * Get claimable task points
 */
export async function getClaimableTaskPoints(userId: string) {
  const response = await axios.get(
    `${API_BASE_URL}/api/task-points/claimable?user_id=${userId}`,
  );
  return response.data;
}

/**
 * Request a task claim ticket from backend
 */
export async function requestTaskClaimTicket(
  userId: string,
  taskCount: number,
) {
  const response = await axios.post(
    `${API_BASE_URL}/api/task-points/request-claim`,
    {
      user_id: userId,
      task_count: taskCount,
    },
  );
  return response.data;
}

/**
 * Confirm task points claim after on-chain transaction
 */
export async function confirmTaskClaim(userId: string, taskCount: number) {
  const response = await axios.post(
    `${API_BASE_URL}/api/task-points/confirm-claim`,
    {
      user_id: userId,
      task_count: taskCount,
    },
  );
  return response.data;
}

/**
 * Get task prompt status for a user
 * Returns daily limit info for task agent prompts
 */
export async function getTaskPromptStatus(userId: string): Promise<{
  used: number;
  limit: number;
  remaining: number;
  tier: number;
}> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/chat/task-prompts/${userId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        "[CHAT SERVICE] Failed to fetch task prompt status:",
        response.status,
      );
      // Return default free tier limits on error
      return {
        used: 0,
        limit: 2,
        remaining: 2,
        tier: 0,
      };
    }

    const data = await response.json();
    console.log("[CHAT SERVICE] Task prompt status:", data);
    return data;
  } catch (error) {
    console.error("[CHAT SERVICE] Error fetching task prompt status:", error);
    // Return default free tier limits on error
    return {
      used: 0,
      limit: 2,
      remaining: 2,
      tier: 0,
    };
  }
}
