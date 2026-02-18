// server/src/services/agents/taskManagerAgent.ts
// ULTIMATE OPTIMIZED: Maximum speed with all optimizations applied

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { getTaskStorageService } from "../taskStorageService";
import { getNotificationService } from "../notificationService";
import type {
  ChatRequest,
  createSSEWriter,
} from "./agentTypes";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const IntentExtractionSchema = z.object({
  intent: z.enum([
    "create_task",
    "list_tasks",
    "update_task",
    "delete_task",
    "complete_task",
    "greeting",
    "general_question",
  ]),
  task_name: z.string().optional(),
  description: z.string().optional(),
  due_date: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  tags: z.array(z.string()).optional(),
  task_identifier: z.string().optional(),
});

type IntentExtraction = z.infer<typeof IntentExtractionSchema>;

// ══════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════

const TaskAgentState = Annotation.Root({
  userId: Annotation<string>,
  message: Annotation<string>,
  sse: Annotation<ReturnType<typeof createSSEWriter>>,
  intent: Annotation<string>,
  extraction: Annotation<Record<string, unknown>>,
  cachedTasks: Annotation<Array<any>>,
  responseText: Annotation<string>,
  actionEvent: Annotation<Record<string, unknown> | null>,
  fastPath: Annotation<boolean>,
});

// ══════════════════════════════════════════════════════════════════════
// LLM INSTANCES - OPTIMIZED FOR MAXIMUM SPEED
// ══════════════════════════════════════════════════════════════════════

const fastLlm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0, // Lower = faster
  maxRetries: 0,
  maxOutputTokens: 1000, // Increased to allow full JSON extraction for long tasks
});

const structuredExtractLlm = fastLlm.withStructuredOutput(IntentExtractionSchema);

const chatLlm = new ChatGoogleGenerativeAI({
  model: process.env.LLM_MODEL || "gemini-1.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0, // Lower = faster
  maxRetries: 0,
  maxOutputTokens: 200, // CRITICAL: Faster responses with limited output
});

// ══════════════════════════════════════════════════════════════════════
// RESPONSE CACHE - Instant responses for repeated queries
// ══════════════════════════════════════════════════════════════════════

const responseCache = new Map<string, {
  intent: string;
  extraction: Record<string, unknown>;
  timestamp: number;
}>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedIntent(message: string) {
  const key = message.toLowerCase().trim();
  const cached = responseCache.get(key);

  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached;
  }

  return null;
}

function setCachedIntent(message: string, intent: string, extraction: Record<string, unknown>) {
  const key = message.toLowerCase().trim();
  responseCache.set(key, {
    intent,
    extraction,
    timestamp: Date.now()
  });
}

// ══════════════════════════════════════════════════════════════════════
// BACKGROUND TASK QUEUE
// ══════════════════════════════════════════════════════════════════════

interface BackgroundTask {
  type: 'create' | 'update' | 'delete' | 'complete';
  userId: string;
  data: any;
  retries: number;
}

class BackgroundTaskQueue {
  private queue: BackgroundTask[] = [];
  private processing = false;

  async add(task: BackgroundTask) {
    this.queue.push(task);
    console.log(`[BG QUEUE] Added ${task.type} task (queue: ${this.queue.length})`);

    if (!this.processing) {
      this.process();
    }
  }

  private async process() {
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const startMs = Date.now();

      try {
        await this.executeTask(task);
        console.log(`[BG QUEUE] ✅ ${task.type} completed (${Date.now() - startMs}ms)`);
      } catch (error) {
        console.error(`[BG QUEUE] ❌ ${task.type} failed (${Date.now() - startMs}ms):`, error);

        // Retry logic
        if (task.retries < 3) {
          task.retries++;
          this.queue.push(task);
          console.log(`[BG QUEUE] 🔄 Retrying ${task.type} (attempt ${task.retries + 1}/3)`);
        } else {
          console.error(`[BG QUEUE] 💀 ${task.type} failed after 3 retries`);
        }
      }

      // Small delay between tasks
      await new Promise(r => setTimeout(r, 100));
    }

    this.processing = false;
  }

  private async executeTask(task: BackgroundTask) {
    const taskStorage = getTaskStorageService();

    switch (task.type) {
      case 'create':
        const result = await taskStorage.createTask(task.userId, task.data);
        if (result) {
          // Send notification (fire-and-forget)
          const notificationService = getNotificationService();
          notificationService.sendTaskCreatedNotification(task.userId, task.data)
            .catch(err => console.error("Failed to send creation notification:", err));
        }
        break;
      case 'update':
        await taskStorage.updateTask(task.userId, task.data.id, task.data.updates);
        break;
      case 'delete':
        await taskStorage.deleteTask(task.userId, task.data.id);
        break;
      case 'complete':
        await taskStorage.updateTask(task.userId, task.data.id, { status: 'completed' });
        break;
    }
  }
}

const bgQueue = new BackgroundTaskQueue();

// ══════════════════════════════════════════════════════════════════════
// FAST PATH MATCHER - Expanded with greetings
// ══════════════════════════════════════════════════════════════════════

interface FastPathResult {
  matched: boolean;
  intent?: string;
  extraction?: Record<string, unknown>;
}

function tryFastPath(message: string): FastPathResult {
  const msg = message.toLowerCase().trim();

  // ─────────────────────────────────────────────────────────────────
  // GREETINGS & CASUAL - Instant responses (no LLM needed)
  // ─────────────────────────────────────────────────────────────────
  const greetings = [
    "hi", "hello", "hey", "gm", "good morning", "good afternoon",
    "good evening", "good night", "howdy", "sup", "what's up", "whats up",
    "yo", "hola", "greetings", "hi there", "hello there"
  ];

  const casual = [
    "thanks", "thank you", "thx", "ty", "cool", "nice", "ok", "okay",
    "sure", "got it", "alright", "kk", "k", "i'm good", "im good",
    "i'm chill", "im chill", "nothing much", "nm", "not much", "nah"
  ];

  if (greetings.includes(msg) || casual.includes(msg)) {
    return {
      matched: true,
      intent: "greeting",
      extraction: { greeting_type: msg }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // LIST TASKS
  // ─────────────────────────────────────────────────────────────────
  const listExact = [
    "list", "tasks", "my tasks", "show tasks", "list tasks",
    "list my tasks", "show my tasks", "get tasks", "view tasks",
    "see tasks", "display tasks", "what are my tasks", "show me my tasks"
  ];

  if (listExact.includes(msg) ||
    /^(list|show|display|see|get|view|what are|whats?)\s+(my\s+)?(all\s+)?(tasks?|todos?)$/i.test(msg)) {
    return { matched: true, intent: "list_tasks", extraction: {} };
  }

  // ─────────────────────────────────────────────────────────────────
  // COMPLETE TASK
  // ─────────────────────────────────────────────────────────────────
  const completeMatch =
    msg.match(/^(complete|finish|done|mark\s+(?:done|complete|as\s+done)|finished?)\s+(.+)/) ||
    msg.match(/^(.+?)\s+(?:is\s+)?(?:done|complete|finished)$/);

  if (completeMatch) {
    const taskId = completeMatch[2] || completeMatch[1];
    return {
      matched: true,
      intent: "complete_task",
      extraction: { task_identifier: taskId?.trim() }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // DELETE TASK
  // ─────────────────────────────────────────────────────────────────
  const deleteMatch =
    msg.match(/^(delete|remove|cancel|drop)\s+(.+)/) ||
    msg.match(/^(.+?)\s+(delete|remove)$/);

  if (deleteMatch) {
    const taskId = deleteMatch[2] || deleteMatch[1];
    return {
      matched: true,
      intent: "delete_task",
      extraction: { task_identifier: taskId?.trim() }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // UPDATE TASK
  // ─────────────────────────────────────────────────────────────────
  const updateMatch = msg.match(/^(update|change|edit|modify)\s+(.+)/);

  if (updateMatch) {
    return {
      matched: true,
      intent: "update_task",
      extraction: { task_identifier: updateMatch[2]?.trim() }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // CREATE TASK
  // ─────────────────────────────────────────────────────────────────
  const createPatterns = [
    /^(create|add|new|make)\s+(?:a\s+)?(?:task|todo|reminder)\s*:?\s*(.+)/,
    /^(remind|schedule)\s+me\s+to\s+(.+)/,
    /^i\s+need\s+to\s+(.+)/,
    /^todo\s*:?\s*(.+)/,
  ];

  for (const pattern of createPatterns) {
    const match = msg.match(pattern);
    if (match) {
      const taskName = match[match.length - 1]?.trim();
      if (taskName && taskName.length > 2) {
        return {
          matched: true,
          intent: "create_task",
          extraction: extractTaskDetails(taskName)
        };
      }
    }
  }

  return { matched: false };
}

function extractTaskDetails(taskName: string): Record<string, unknown> {
  let priority: "low" | "medium" | "high" = "medium";

  if (/\b(urgent|important|critical|asap|high|emergency|!!|!!!)\b/i.test(taskName)) {
    priority = "high";
  } else if (/\b(low|minor|someday|eventually|maybe)\b/i.test(taskName)) {
    priority = "low";
  }

  let due_date: string | undefined;
  const now = new Date();

  if (/\btomorrow\b/i.test(taskName)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    due_date = tomorrow.toISOString();
  } else if (/\btoday\b/i.test(taskName)) {
    const today = new Date(now);
    today.setHours(17, 0, 0, 0);
    due_date = today.toISOString();
  } else if (/\bnext week\b/i.test(taskName)) {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(9, 0, 0, 0);
    due_date = nextWeek.toISOString();
  } else if (/\bin (\d+) (hour|day|week)s?\b/i.test(taskName)) {
    const timeMatch = taskName.match(/\bin (\d+) (hour|day|week)s?\b/i);
    if (timeMatch) {
      const amount = parseInt(timeMatch[1]);
      const unit = timeMatch[2].toLowerCase();
      const future = new Date(now);

      if (unit === "hour") future.setHours(future.getHours() + amount);
      else if (unit === "day") future.setDate(future.getDate() + amount);
      else if (unit === "week") future.setDate(future.getDate() + amount * 7);

      due_date = future.toISOString();
    }
  }

  return {
    task_name: taskName,
    priority,
    ...(due_date && { due_date })
  };
}

// ══════════════════════════════════════════════════════════════════════
// GRAPH NODES
// ══════════════════════════════════════════════════════════════════════

async function extractIntent(
  state: typeof TaskAgentState.State,
): Promise<Partial<typeof TaskAgentState.State>> {
  const startMs = Date.now();

  console.log(`[TASK] 🔍 Message: "${state.message}"`);

  // ═══ CHECK CACHE FIRST ═══
  const cached = getCachedIntent(state.message);
  if (cached) {
    console.log(`[TASK] 💾 CACHE HIT: ${cached.intent} (0ms)`);
    return {
      intent: cached.intent,
      extraction: cached.extraction,
      fastPath: true,
    };
  }

  // ═══ TRY FAST PATH ═══
  const fastResult = tryFastPath(state.message);

  if (fastResult.matched) {
    console.log(`[TASK] ⚡ FAST PATH: ${fastResult.intent} (${Date.now() - startMs}ms)`);

    // Cache for next time
    setCachedIntent(state.message, fastResult.intent!, fastResult.extraction!);

    return {
      intent: fastResult.intent!,
      extraction: fastResult.extraction!,
      fastPath: true,
    };
  }

  // ═══ SLOW PATH: LLM (optimized with shorter prompt) ═══
  console.log(`[TASK] 🐌 SLOW PATH: Using LLM`);
  state.sse.status("Interpreting your request");

  const llmStartMs = Date.now();

  try {
    const extraction = await Promise.race([
      structuredExtractLlm.invoke([
        {
          role: "system",
          content: "You are a smart task extractor. If the user describes a task without a clear title (e.g. 'I should do X'), summarize it into a concise `task_name`. For 'create task' intent, `task_name` is REQUIRED."
        },
        {
          role: "human",
          content: `Time: ${new Date().toISOString()}\nUser: "${state.message}"\n\nExtract intent & params.`
        }
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), 5000)
      )
    ]) as IntentExtraction;

    console.log(`[TASK] ✅ LLM: ${extraction.intent} (${Date.now() - llmStartMs}ms)`);

    // Cache for next time
    setCachedIntent(state.message, extraction.intent, extraction as unknown as Record<string, unknown>);

    return {
      intent: extraction.intent,
      extraction: extraction as unknown as Record<string, unknown>,
      fastPath: false,
    };

  } catch (error) {
    console.error(`[TASK] ❌ LLM failed after ${Date.now() - startMs}ms:`, error);

    // Smart fallback based on message length
    if (state.message.trim().length < 15) {
      return {
        intent: "greeting",
        extraction: {},
        fastPath: false,
      };
    }

    return {
      intent: "general_question",
      extraction: {},
      fastPath: false,
    };
  }
}

/**
 * Prefetch tasks in background (only if needed)
 */
async function prefetchTasks(
  state: typeof TaskAgentState.State,
): Promise<Partial<typeof TaskAgentState.State>> {
  const needsTasks = ["list_tasks", "complete_task", "delete_task", "update_task"];

  if (!needsTasks.includes(state.intent)) {
    return { cachedTasks: [] };
  }

  const startMs = Date.now();

  try {
    const tasks = await Promise.race([
      getTaskStorageService().getTasks(state.userId),
      new Promise<any[]>((resolve) =>
        setTimeout(() => {
          console.warn(`[TASK] ⚠️ DB prefetch timeout, using empty array`);
          resolve([]);
        }, 3000)
      )
    ]);

    console.log(`[TASK] 📦 Prefetched ${tasks.length} tasks (${Date.now() - startMs}ms)`);

    return { cachedTasks: tasks };
  } catch (error) {
    console.error(`[TASK] ❌ Prefetch failed:`, error);
    return { cachedTasks: [] };
  }
}

/**
 * Execute task - INSTANT RESPONSE, background DB save
 */
async function executeTask(
  state: typeof TaskAgentState.State,
): Promise<Partial<typeof TaskAgentState.State>> {
  const ext = state.extraction as unknown as IntentExtraction;

  switch (state.intent) {
    // ═══════════════════════════════════════════════════════════════
    // GREETING - Instant response
    // ═══════════════════════════════════════════════════════════════
    case "greeting": {
      const greetingResponses = [
        "Hey! 👋 I'm your task manager. Want to create a task or see what's on your list?",
        "Hello! Ready to help you stay organized. Try 'list tasks' or 'create task: [your task]'",
        "Hi there! I can help you manage your tasks. What would you like to do?",
      ];

      const randomResponse = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];

      return {
        responseText: randomResponse,
        actionEvent: null,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // CREATE TASK - Respond immediately, save in background
    // ═══════════════════════════════════════════════════════════════
    case "create_task": {
      if (!ext.task_name) {
        return {
          responseText: "I'd like to create a task for you, but I need at least a task name. What would you like to call it?",
          actionEvent: null,
        };
      }

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Queue database save in background
      bgQueue.add({
        type: 'create',
        userId: state.userId,
        data: {
          task_name: ext.task_name,
          description: ext.description,
          due_date: ext.due_date,
          priority: ext.priority || "medium",
          status: "pending",
          tags: ext.tags || [],
          action_type: "reminder",
          action_status: undefined,
        },
        retries: 0
      });

      // Fire-and-forget points tracking
      trackTaskCreation(state.userId).catch(() => { });

      // Format response immediately
      let response = `✅ Task created: **${ext.task_name}**`;

      if (ext.due_date) {
        const d = new Date(ext.due_date);
        response += `\n📅 Due: ${d.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })}`;
      }

      if (ext.priority && ext.priority !== "medium") {
        const emoji = ext.priority === "high" ? "🔴" : "🟢";
        response += `\n${emoji} Priority: ${ext.priority}`;
      }

      if (ext.description) {
        response += `\n📝 ${ext.description}`;
      }

      console.log(`[TASK] ✅ Create response ready (DB saving in background)`);

      return {
        responseText: response,
        actionEvent: { type: "task_created", taskId: tempId },
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // LIST TASKS - Use cached data
    // ═══════════════════════════════════════════════════════════════
    case "list_tasks": {
      const tasks = state.cachedTasks;

      if (tasks.length === 0) {
        return {
          responseText: "You don't have any tasks yet. Tell me what you need to do and I'll create one for you! 📝",
          actionEvent: null,
        };
      }

      const pending = tasks.filter((t) => t.status === "pending");
      const completed = tasks.filter((t) => t.status === "completed");

      let response = `📋 You have **${tasks.length}** task${tasks.length > 1 ? "s" : ""}`;

      if (pending.length > 0 && completed.length > 0) {
        response += ` (${pending.length} pending, ${completed.length} completed)`;
      }
      response += ":\n";

      for (const t of pending.slice(0, 10)) {
        const priority = t.priority === "high" ? " 🔴" : t.priority === "low" ? " 🟢" : "";
        const due = t.due_date
          ? ` — ${new Date(t.due_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
          })}`
          : "";
        response += `\n• ${t.task_name}${priority}${due}`;
      }

      if (pending.length > 10) {
        response += `\n• ...and ${pending.length - 10} more`;
      }

      if (completed.length > 0) {
        response += `\n\n✅ **Completed** (${completed.length}):`;
        for (const t of completed.slice(0, 5)) {
          response += `\n• ~~${t.task_name}~~`;
        }
      }

      return {
        responseText: response,
        actionEvent: { type: "tasks_listed", count: tasks.length },
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPLETE TASK - Respond immediately, update in background
    // ═══════════════════════════════════════════════════════════════
    case "complete_task": {
      if (!ext.task_identifier) {
        return {
          responseText: "Which task would you like to complete?",
          actionEvent: null,
        };
      }

      const tasks = state.cachedTasks;
      const target = findTaskByName(tasks, ext.task_identifier);

      if (!target) {
        return {
          responseText: `I couldn't find a task matching "${ext.task_identifier}". Try "list tasks" to see what you have.`,
          actionEvent: null,
        };
      }

      if (target.status === "completed") {
        return {
          responseText: `**${target.task_name}** is already completed! ✅`,
          actionEvent: null,
        };
      }

      // Queue database update in background
      bgQueue.add({
        type: 'complete',
        userId: state.userId,
        data: { id: target.id },
        retries: 0
      });

      console.log(`[TASK] ✅ Complete response ready (DB updating in background)`);

      return {
        responseText: `✅ Completed: **${target.task_name}**\n\nGreat work! 🎉`,
        actionEvent: { type: "task_completed", taskId: target.id },
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // DELETE TASK - Respond immediately, delete in background
    // ═══════════════════════════════════════════════════════════════
    case "delete_task": {
      if (!ext.task_identifier) {
        return {
          responseText: "Which task would you like to delete?",
          actionEvent: null,
        };
      }

      const tasks = state.cachedTasks;
      const target = findTaskByName(tasks, ext.task_identifier);

      if (!target) {
        return {
          responseText: `I couldn't find a task matching "${ext.task_identifier}".`,
          actionEvent: null,
        };
      }

      // Queue database delete in background
      bgQueue.add({
        type: 'delete',
        userId: state.userId,
        data: { id: target.id },
        retries: 0
      });

      console.log(`[TASK] ✅ Delete response ready (DB deleting in background)`);

      return {
        responseText: `🗑️ Deleted: **${target.task_name}**`,
        actionEvent: { type: "task_deleted", taskId: target.id },
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // UPDATE TASK - Respond immediately, update in background
    // ═══════════════════════════════════════════════════════════════
    case "update_task": {
      if (!ext.task_identifier) {
        return {
          responseText: "Which task would you like to update?",
          actionEvent: null,
        };
      }

      const tasks = state.cachedTasks;
      const target = findTaskByName(tasks, ext.task_identifier);

      if (!target) {
        return {
          responseText: `I couldn't find a task matching "${ext.task_identifier}".`,
          actionEvent: null,
        };
      }

      const updates: Record<string, unknown> = {};
      if (ext.task_name) updates.task_name = ext.task_name;
      if (ext.description) updates.description = ext.description;
      if (ext.due_date) updates.due_date = ext.due_date;
      if (ext.priority) updates.priority = ext.priority;
      if (ext.tags) updates.tags = ext.tags;

      if (Object.keys(updates).length === 0) {
        return {
          responseText: "What would you like to change about this task?",
          actionEvent: null,
        };
      }

      // Queue database update in background
      bgQueue.add({
        type: 'update',
        userId: state.userId,
        data: { id: target.id, updates },
        retries: 0
      });

      console.log(`[TASK] ✅ Update response ready (DB updating in background)`);

      return {
        responseText: `✏️ Updated **${target.task_name}**: ${Object.keys(updates).join(", ")} changed.`,
        actionEvent: { type: "task_updated", taskId: target.id },
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // GENERAL QUESTION - Use faster non-streaming approach
    // ═══════════════════════════════════════════════════════════════
    case "general_question": {
      // For very short messages, provide instant help
      if (state.message.trim().length < 15) {
        return {
          responseText: "I'm your task manager! I can help you:\n\n• Create tasks: 'remind me to [task]'\n• View tasks: 'list my tasks'\n• Complete tasks: 'complete [task name]'\n• Delete tasks: 'delete [task name]'\n\nWhat would you like to do?",
          actionEvent: null,
        };
      }

      state.sse.status("Thinking");

      try {
        // Use non-streaming for faster response
        const response = await Promise.race([
          chatLlm.invoke([
            {
              role: "system",
              content: `You are a helpful Task Manager assistant. Be concise. You CANNOT create or modify tasks directly in this chat mode. If the user wants to create a task, guide them to use the specific syntax or say "Create task: [task name]". Do NOT say you have created a task unless you are sure.`,
            },
            { role: "human", content: state.message },
          ]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Chat timeout")), 5000)
          )
        ]);

        const text = typeof response.content === "string"
          ? response.content
          : Array.isArray(response.content)
            ? response.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
            : "";

        return {
          responseText: text || "I'm here to help you manage tasks! Try 'list tasks' or 'create task: [your task]'",
          actionEvent: null,
        };
      } catch (error) {
        console.error(`[TASK] ❌ Chat failed:`, error);

        // Fallback response if LLM fails
        return {
          responseText: "I'm your task assistant! 📋\n\nI can help you:\n• Create tasks\n• View your task list\n• Mark tasks complete\n• Delete tasks\n\nTry saying 'list my tasks' or 'remind me to [task]'",
          actionEvent: null,
        };
      }
    }

    default:
      return {
        responseText: "I'm not sure what you'd like me to do. Could you rephrase?",
        actionEvent: null,
      };
  }
}

/**
 * Send response
 */
async function respond(
  state: typeof TaskAgentState.State,
): Promise<Partial<typeof TaskAgentState.State>> {
  if (state.responseText === "__streamed__") {
    return {};
  }

  state.sse.chunk(state.responseText);

  if (state.actionEvent) {
    state.sse.action(state.actionEvent);
  }

  state.sse.done();

  return {};
}

// ══════════════════════════════════════════════════════════════════════
// BUILD GRAPH
// ══════════════════════════════════════════════════════════════════════

let compiledGraph: any = null;

function getCompiledGraph() {
  if (!compiledGraph) {
    const compileStart = Date.now();

    compiledGraph = new StateGraph(TaskAgentState)
      .addNode("extractIntent", extractIntent)
      .addNode("prefetchTasks", prefetchTasks)
      .addNode("executeTask", executeTask)
      .addNode("respond", respond)
      .addEdge("__start__", "extractIntent")
      .addEdge("__start__", "prefetchTasks")
      .addEdge(["extractIntent", "prefetchTasks"], "executeTask")
      .addEdge("executeTask", "respond")
      .addEdge("respond", "__end__")
      .compile();

    console.log(`[TASK] 🔧 Graph compiled (${Date.now() - compileStart}ms)`);
  }

  return compiledGraph;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function findTaskByName(
  tasks: Array<{ id: string; task_name: string; status: string }>,
  identifier: string,
) {
  const lower = identifier.toLowerCase();
  const exact = tasks.find((t) => t.task_name.toLowerCase() === lower);
  if (exact) return exact;
  return tasks.find((t) => t.task_name.toLowerCase().includes(lower));
}

async function trackTaskCreation(userId: string): Promise<void> {
  try {
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
    await fetch(`${API_BASE_URL}/api/task-points/track-creation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (error) {
    // Silent fail
  }
}

// ══════════════════════════════════════════════════════════════════════
// AGENT HANDLER
// ══════════════════════════════════════════════════════════════════════

export class TaskManagerAgent {
  async handle(
    req: ChatRequest,
    sse: ReturnType<typeof createSSEWriter>,
  ): Promise<string> {
    const startMs = Date.now();
    console.log(`[TASK] 🚀 Request from ${req.userId.substring(0, 8)}...`);

    let fullResponse = "";

    // Create a wrapper around SSE to accumulate text
    const wrappedSSE = {
      ...sse,
      chunk: (text: string) => {
        fullResponse += text;
        sse.chunk(text);
      },
      status: sse.status,
      action: sse.action,
      done: sse.done,
      conversation: sse.conversation,
      error: sse.error
    };

    try {
      const graph = getCompiledGraph();

      await graph.invoke(
        {
          userId: req.userId,
          message: req.message,
          sse: wrappedSSE,
          intent: "",
          extraction: {},
          cachedTasks: [],
          responseText: "",
          actionEvent: null,
          fastPath: false
        }
      );

      const elapsed = Date.now() - startMs;
      console.log(`[TASK] ✅ Completed in ${elapsed}ms`);

      return fullResponse;
    } catch (error) {
      console.error("[TASK] Error processing request:", error);
      throw error;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ══════════════════════════════════════════════════════════════════════

let taskManagerAgent: TaskManagerAgent | null = null;

export function getTaskManagerAgent(): TaskManagerAgent {
  if (!taskManagerAgent) {
    taskManagerAgent = new TaskManagerAgent();
  }
  return taskManagerAgent;
}