// server/src/services/agents/agentTypes.ts
// Shared types for all AI agents

import type { Response } from "express";

// ── Request / Response Types ───────────────────────────────────────────

export interface ChatRequest {
  userId: string; // wallet address
  agentId: string; // "task" | "research" | "tovira" | "alert"
  message: string;
  conversationId?: string;
  clientTime?: string; // ISO string from frontend
}

/**
 * SSE event types streamed to the frontend:
 *  status  - thinking indicator text (e.g. "Creating task...")
 *  chunk   - streamed token of the response text
 *  action  - structured side-effect (task created, etc.)
 *  done    - signals end of response
 *  error   - error message
 */
export type SSEEventType = "status" | "chunk" | "action" | "done" | "error" | "conversation";

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown> | string;
}

// ── SSE Helper ─────────────────────────────────────────────────────────

/**
 * Lightweight SSE writer. Keeps the response open and sends events.
 * Usage:
 *   const sse = createSSEWriter(res);
 *   sse.status("Interpreting your request");
 *   sse.chunk("Hello ");
 *   sse.chunk("world!");
 *   sse.action({ type: "task_created", task: {...} });
 *   sse.done();
 */
export function createSSEWriter(res: Response) {
  // Configure SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
  });

  const send = (event: SSEEventType, data: unknown) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
  };

  return {
    status: (text: string) => send("status", JSON.stringify({ text })),
    chunk: (text: string) => send("chunk", JSON.stringify({ text })),
    action: (payload: Record<string, unknown>) => send("action", JSON.stringify(payload)),
    done: () => {
      send("done", JSON.stringify({}));
      res.end();
    },
    conversation: (id: string) => send("conversation", JSON.stringify({ id })),
    error: (message: string) => {
      send("error", JSON.stringify({ message }));
      res.end();
    },
  };
}

// ── Agent Interface ────────────────────────────────────────────────────

export interface AgentHandler {
  handle(
    req: ChatRequest,
    sse: ReturnType<typeof createSSEWriter>,
  ): Promise<string>;
}
