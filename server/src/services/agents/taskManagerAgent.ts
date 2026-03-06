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
  clientTime: Annotation<string>,
});

// ══════════════════════════════════════════════════════════════════════
// LLM INSTANCES - OPTIMIZED FOR MAXIMUM SPEED
// ══════════════════════════════════════════════════════════════════════

const fastLlm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY_TASK || process.env.GEMINI_API_KEY,
  temperature: 0,
  maxRetries: 1,
  maxOutputTokens: 2048,
});

const structuredExtractLlm = fastLlm.withStructuredOutput(IntentExtractionSchema);

const chatLlm = new ChatGoogleGenerativeAI({
  model: process.env.LLM_MODEL || "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY_TASK || process.env.GEMINI_API_KEY,
  temperature: 0,
  maxRetries: 1,
  maxOutputTokens: 400, // Slightly more for better descriptive responses
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
    };
  }

  // ═══ SLOW PATH: LLM (optimized with shorter prompt) ═══
  console.log(`[TASK] 🤖 processing with LLM...`);
  state.sse.status("Interpreting your request");

  const llmStartMs = Date.now();

  try {
    const extraction = await Promise.race([
      structuredExtractLlm.invoke([
        {
          role: "system",
          content: `You are a smart task extractor. If the user describes a task without a clear title (e.g. 'I should do X'), summarize it into a concise \`task_name\`. For 'create task' intent, \`task_name\` is REQUIRED.

RULES FOR \`description\`:
- NEVER set description to the raw user message.
- Only set description if the user provides additional context BEYOND the task name itself.
- If the task_name already captures the full intent, leave description empty.
- Example: "remind me to check Solana price in 2 min" -> task_name: "Check Solana Price", description: empty (not needed).

CRITICAL RULES FOR \`due_date\`:
- Current Time includes the user's timezone offset. RESPECT IT.
- due_date MUST be a UTC ISO 8601 string (ending in Z), computed from the user's LOCAL time.
- "at 8pm" when Current Time is 2026-02-21T13:00:00+01:00 means 8pm in +01:00 zone, which is 2026-02-21T19:00:00.000Z in UTC.
- "in 2 minutes" -> Add 2 minutes to Current Time, then convert to UTC.
- "tomorrow" -> Tomorrow at 9:00 AM in user's timezone, converted to UTC.
- "tonight" -> Today at 8:00 PM in user's timezone, converted to UTC.
- If the user says "at [time]", and that time has already passed today, assume they mean TOMORROW.
- NEVER include the time reference (e.g., "at 8pm") in the \`task_name\` if you have successfully parsed it into \`due_date\`.
You MUST always calculate and return due_date when the user specifies any time reference.`
        },
        {
          role: "human",
          content: `Current Time: ${state.clientTime ?? new Date().toISOString()}\nUser: "${state.message}"\n\nExtract intent & params.`,
        }
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), 8000)
      )
    ]) as IntentExtraction;

    console.log(`[TASK] ✅ LLM: ${extraction.intent}(${Date.now() - llmStartMs}ms)`);

    // Cache for next time
    setCachedIntent(state.message, extraction.intent, extraction as unknown as Record<string, unknown>);

    return {
      intent: extraction.intent,
      extraction: extraction as unknown as Record<string, unknown>,
    };

  } catch (error) {
    console.error(`[TASK] ❌ LLM failed after ${Date.now() - startMs}ms: `, error);

    // Fallback based on message content
    if (state.message.trim().toLowerCase().includes("create")) {
      return {
        intent: "create_task",
        extraction: { task_name: state.message.replace(/create/i, '').trim() || "New Task" },
      };
    }

    // Smart fallback based on message length
    if (state.message.trim().length < 15) {
      return {
        intent: "greeting",
        extraction: {},
      };
    }

    return {
      intent: "general_question",
      extraction: {},
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

    console.log(`[TASK] 📦 Prefetched ${tasks.length} tasks(${Date.now() - startMs}ms)`);

    return { cachedTasks: tasks };
  } catch (error) {
    console.error(`[TASK] ❌ Prefetch failed: `, error);
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

      // Try LLM-extracted due_date first, then parse from user message, then default to 24h
      let finalDueDate = ext.due_date;
      if (!finalDueDate) {
        finalDueDate = parseRelativeTime(state.message, state.clientTime) ?? undefined;
      }
      if (!finalDueDate) {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        finalDueDate = tomorrow.toISOString();
      }

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Queue database save in background
      bgQueue.add({
        type: 'create',
        userId: state.userId,
        data: {
          task_name: ext.task_name,
          description: ext.description,
          due_date: finalDueDate,
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

      // Format response immediately using user's timezone
      let response = `✅ Task created: ** ${ext.task_name} ** `;

      if (finalDueDate) {
        response += `\n📅 Due: ${formatDateForUser(finalDueDate, state.clientTime)}`;
      }

      if (ext.priority && ext.priority !== "medium") {
        const emoji = ext.priority === "high" ? "🔴" : "🟢";
        response += `\n${emoji} Priority: ${ext.priority}`;
      }

      if (ext.description && ext.task_name && !ext.description.toLowerCase().includes(ext.task_name.toLowerCase()) && !ext.task_name.toLowerCase().includes(ext.description.toLowerCase())) {
        response += `\n📝 ${ext.description}`;
      }

      console.log(`[TASK] ✅ Create response ready(DB saving in background)`);

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

      let response = `📋 You have ** ${tasks.length} ** task${tasks.length > 1 ? "s" : ""}`;

      if (pending.length > 0 && completed.length > 0) {
        response += ` (${pending.length} pending, ${completed.length} completed)`;
      }
      response += ":\n";

      for (const t of pending.slice(0, 10)) {
        const priority = t.priority === "high" ? " 🔴" : t.priority === "low" ? " 🟢" : "";
        const due = t.due_date
          ? ` — ${formatDateForUser(t.due_date, state.clientTime, true)}`
          : "";
        response += `\n• ${t.task_name}${priority}${due}`;
      }

      if (pending.length > 10) {
        response += `\n• ...and ${pending.length - 10} more`;
      }

      if (completed.length > 0) {
        response += `\n\n✅ ** Completed ** (${completed.length}): `;
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

    // ══════════════════════════════════════════════════════════════════════
    // GENERAL QUESTION - Use faster non-streaming approach with Tool Calling
    // ══════════════════════════════════════════════════════════════════════
    case "general_question": {
      // For very short messages, provide instant help
      if (state.message.trim().length < 5) {
        return {
          responseText: "I'm your task manager! I can help you create, list, completed, and delete tasks. What would you like to do?",
          actionEvent: null,
        };
      }

      state.sse.status("Thinking");

      try {
        // Define tool for task creation
        const createTaskTool = {
          name: "create_task",
          description: "Create a new task when the user explicitly asks to.",
          schema: z.object({
            task_name: z.string().describe("The concise title of the task"),
            description: z.string().describe("A short, encouraging description (generated by you if missing)"),
            due_date: z.string().optional().describe("Calculated ISO 8601 date string based on Current Time (e.g. '2024-01-01T10:00:00.000Z')"),
            priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
          })
        };

        const llmWithTools = chatLlm.bindTools([createTaskTool]);

        // Use non-streaming for faster response
        const response = await Promise.race([
          llmWithTools.invoke([
            {
              role: "system",
              content: `You are a helpful Task Manager assistant.
              Current Time: ${state.clientTime}
              
              PRIVACY & SECRECY (CRITICAL):
              - NEVER reveal the names of your internal tools (like 'create_task', 'list_tasks', etc.).
              - NEVER discuss technical implementation details: no mention of LangChain, Gemini, LLMs, or backend APIs.
              - If asked how you work, explain using a role-based, real-world metaphor: "I'm your personal productivity assistant. You tell me what you need to do, and I'll keep everything organized, remind you of deadlines, and make sure nothing slips through the cracks."
              
              If the user wants to create a task, you MUST use the 'create_task' tool.
              
              RULES FOR 'create_task' (INTERNAL ONLY):
              1. **task_name**: Keep it concise.
              2. **description**: You MUST generate a short, encouraging description if the user didn't provide one.
              3. **due_date**: Output a UTC ISO 8601 string (ending in Z), calculated from the user's local Current Time.
                  - Current Time includes the user's timezone offset. Respect it.
                  - "at 8pm" when Current Time is +01:00 means 8pm local = 7pm UTC.
                  - "in 1 min" -> Add 1 minute to Current Time, convert to UTC.
                  - "tomorrow" -> Tomorrow at 9:00 AM local, convert to UTC.
                  - "tonight" -> Today at 8:00 PM local, convert to UTC.
                  - If the user says "at 8pm" and it is already 9pm, assume they mean tomorrow.
                  - IMPORTANT: Do NOT include the time/date in the \`task_name\` if it is provided in \`due_date\`.
              
              Do not hallucinate tasks.`,
            },
            { role: "human", content: state.message },
          ]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Chat timeout")), 8000)
          )
        ]);

        // Check for tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolCall = response.tool_calls[0];
          if (toolCall.name === "create_task") {
            const args = toolCall.args as any;
            console.log(`[TASK] 🛠️ Tool Call: create_task`, args);

            // Try LLM due_date, then parse from message, then default to 24h
            let finalDueDate = args.due_date;
            if (!finalDueDate) {
              finalDueDate = parseRelativeTime(state.message, state.clientTime) ?? undefined;
            }
            if (!finalDueDate) {
              finalDueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            }

            // Execute creation logic directly
            bgQueue.add({
              type: 'create',
              userId: state.userId,
              data: {
                task_name: args.task_name,
                description: args.description,
                due_date: finalDueDate,
                priority: args.priority || "medium",
                status: "pending",
                tags: [],
                action_type: "reminder",
              },
              retries: 0
            });

            // Fire-and-forget points tracking
            trackTaskCreation(state.userId).catch(() => { });

            return {
              responseText: `✅ Task created: **${args.task_name}**\n📅 Due: ${formatDateForUser(finalDueDate, state.clientTime)}`,
              actionEvent: { type: "task_created", taskId: "temp_tool_created" },
            };
          }
        }

        const text = response && typeof response.content === "string"
          ? response.content
          : response && Array.isArray(response.content)
            ? response.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
            : "";

        return {
          responseText: text || "I'm here to help you manage tasks! Try 'list tasks' or 'create task: [your task]'",
          actionEvent: null,
        };

      } catch (error: any) {
        console.error(`[TASK] ❌ Chat LLM error:`, error);
        
        // Handle specific LangChain/Google SDK crashes gracefully
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("429") || errorMsg.includes("Resource exhausted")) {
          return {
            responseText: "I'm receiving too many requests right now. Please wait a moment and try again.",
            actionEvent: null,
          };
        }

        return {
          responseText: "I'm having a bit of trouble answering right now. Try a different request or check your task list.",
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

/**
 * Parse relative time expressions from user message and return an ISO date string.
 */
function parseRelativeTime(message: string, clientTime?: string): string | null {
  const msg = message.toLowerCase();
  const now = clientTime ? new Date(clientTime) : new Date();
  const userOffset = getUserOffset(clientTime || "");

  // Match "in X minute(s)/min(s)"
  const minuteMatch = msg.match(/in\s+(\d+)\s*(?:minute|minutes|min|mins)/);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  }

  // Match "in X hour(s)/hr(s)"
  const hourMatch = msg.match(/in\s+(\d+)\s*(?:hour|hours|hr|hrs)/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  }

  // Match "in X day(s)"
  const dayMatch = msg.match(/in\s+(\d+)\s*(?:day|days)/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  // Match "in X second(s)/sec(s)"
  const secMatch = msg.match(/in\s+(\d+)\s*(?:second|seconds|sec|secs)/);
  if (secMatch) {
    const secs = parseInt(secMatch[1], 10);
    return new Date(now.getTime() + secs * 1000).toISOString();
  }

  // "tomorrow" -> tomorrow at 9:00 AM user time
  if (msg.includes("tomorrow")) {
    const userNow = new Date(now.getTime() + userOffset * 60_000);
    const targetLocal = new Date(userNow);
    targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    targetLocal.setUTCHours(9, 0, 0, 0);
    return new Date(targetLocal.getTime() - userOffset * 60_000).toISOString();
  }

  // "tonight" -> today at 8:00 PM user time
  if (msg.includes("tonight")) {
    const userNow = new Date(now.getTime() + userOffset * 60_000);
    const targetLocal = new Date(userNow);
    targetLocal.setUTCHours(20, 0, 0, 0);
    return new Date(targetLocal.getTime() - userOffset * 60_000).toISOString();
  }

  // "next week" -> 7 days from now at 9:00 AM user time
  if (msg.includes("next week")) {
    const userNow = new Date(now.getTime() + userOffset * 60_000);
    const targetLocal = new Date(userNow);
    targetLocal.setUTCDate(targetLocal.getUTCDate() + 7);
    targetLocal.setUTCHours(9, 0, 0, 0);
    return new Date(targetLocal.getTime() - userOffset * 60_000).toISOString();
  }

  // Match "at X:XX am/pm" or "at X am/pm" or "at XX:XX"
  const atMatch = msg.match(/at\s+(\d+)(?::(\d+))?\s*(am|pm)?/);
  if (atMatch) {
    let hours = parseInt(atMatch[1], 10);
    const minutes = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
    const ampm = atMatch[3];

    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    const userNow = new Date(now.getTime() + userOffset * 60_000);
    const targetLocal = new Date(userNow);
    targetLocal.setUTCHours(hours, minutes, 0, 0);

    // If target time has already passed today, assume tomorrow
    if (targetLocal.getTime() <= userNow.getTime()) {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    }

    return new Date(targetLocal.getTime() - userOffset * 60_000).toISOString();
  }

  return null;
}

/**
 * Extract timezone offset in minutes from ISO string like "2024-01-01T10:00:00+01:00"
 */
function getUserOffset(clientTime: string): number {
  if (!clientTime) return 0;
  const match = clientTime.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = parseInt(match[3], 10);
  return sign * (hours * 60 + mins);
}

/**
 * Format a UTC date for display in the user's local timezone.
 */
function formatDateForUser(date: Date | string, clientTime: string, dateOnly = false): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const offset = getUserOffset(clientTime);
  const userMs = d.getTime() + offset * 60_000;
  const userDate = new Date(userMs);

  if (dateOnly) {
    return userDate.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC" // We already applied the offset manually
    });
  }

  return userDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC" // We already applied the offset manually
  });
}

export async function trackTaskCreation(userId: string, type: "task" | "research" = "task"): Promise<void> {
  try {
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${API_BASE_URL}/api/task-points/track-creation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, type }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[TASK] trackTaskCreation failed (${res.status}):`, body);
    } else {
      console.log(`[TASK] Task creation tracked for ${userId.substring(0, 10)}...`);
    }
  } catch (error) {
    console.error("[TASK] trackTaskCreation error:", error);
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
          clientTime: req.clientTime || new Date().toISOString(),
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