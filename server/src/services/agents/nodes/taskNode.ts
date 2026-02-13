import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { getTaskStorageService } from "../../taskStorageService";
import { z } from "zod";

// Schema for task extraction (Reminders only)
const TaskSchema = z.object({
  task_name: z.string().describe("Short, clear name for the task"),
  description: z
    .string()
    .optional()
    .describe("Detailed description of what needs to be done"),
  due_date: z
    .string()
    .optional()
    .describe("ISO 8601 date-time when task is due"),
  priority: z
    .enum(["low", "medium", "high"])
    .default("medium")
    .describe("Task priority level"),
  is_recurring: z
    .boolean()
    .default(false)
    .describe("Whether this is a recurring task"),
  reminder_times: z
    .array(z.string())
    .optional()
    .describe("Array of ISO 8601 date-times for reminders"),
  tags: z.array(z.string()).optional().describe("Tags to categorize the task"),
  should_create: z
    .boolean()
    .describe(
      "Whether to actually create this task or just provide information",
    ),
  missing_info: z
    .string()
    .optional()
    .describe("What critical information is missing, if any"),

  // Action type restricted to reminder only
  action_type: z
    .enum(["reminder"])
    .default("reminder")
    .describe("Type of action: always 'reminder'"),
});

type TaskExtraction = z.infer<typeof TaskSchema>;

export async function taskNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  });

  const extractionPrompt = `Extract task parameters for a Task Manager assistant.
Query: "${state.userQuery}"
Time: ${new Date().toISOString()}

RULES:
- should_create: true ONLY if actionable.
- action_type: ALWAYS "reminder".

EXAMPLES:
- "Remind me in 2h to call Mom" -> {task_name: "Call Mom", due_date: "...", action_type: "reminder", should_create: true}
- "Buy milk tomorrow" -> {task_name: "Buy milk", due_date: "...", action_type: "reminder", should_create: true}
- "Send tokens to friend" -> {should_create: false, missing_info: "I can only help with reminders and tasks, not transactions."} 
`;

  try {
    // Extract task parameters using structured output
    const structuredLlm = llm.withStructuredOutput(TaskSchema);
    const extraction = (await structuredLlm.invoke(
      extractionPrompt,
    )) as TaskExtraction;

    // If missing critical information, ask for it
    if (!extraction.should_create) {
      return {
        finalResponse: `I'd be happy to create that task! However, I need a bit more information: ${extraction.missing_info || "Please provide more details about what you'd like me to do."}`,
      };
    }

    // Use Walrus storage directly
    const taskStorage = getTaskStorageService();

    const result = await taskStorage.createTask(state.userId, {
      task_name: extraction.task_name,
      description: extraction.description,
      due_date: extraction.due_date,
      priority: extraction.priority,
      status: "pending",
      tags: extraction.tags || [],
      action_type: "reminder",
      action_status: undefined,
    });

    if (!result) {
      console.error("Failed to create task in Walrus");
      return {
        finalResponse:
          "I encountered an error while creating your task. Please try again or contact support if the issue persists.",
      };
    }

    const task = await taskStorage.getTask(state.userId, result.taskId);

    // ✅ TRACK TASK CREATION FOR POINTS (fire-and-forget)
    (async () => {
      try {
        const API_BASE_URL =
          process.env.API_BASE_URL || "http://localhost:3000";
        await fetch(`${API_BASE_URL}/api/task-points/track-creation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: state.userId }),
        });
        console.log(
          `[TASK NODE] ✅ Task creation tracked for ${state.userId.substring(0, 10)}...`,
        );

        // ✅ SEND NOTIFICATION (fire-and-forget)
        // Import dynamically to avoid circular dependencies if any
        const { getNotificationService } = await import("../../notificationService");
        const notificationService = getNotificationService();
        if (task) {
          await notificationService.sendTaskCreatedNotification(state.userId, task);
          console.log(`[TASK NODE] 🔔 Notification sent to ${state.userId}`);
        }

      } catch (error) {
        console.warn("[TASK NODE] ⚠️ Failed to track task or send notification:", error);
      }
    })();

    if (!task) {
      return {
        finalResponse:
          "Task was created but could not be retrieved. Please check your tasks page.",
      };
    }

    // Generate confirmation message
    let confirmationMessage = `Task created: **${task.task_name}**`;

    if (task.due_date) {
      const dueDate = new Date(task.due_date);
      confirmationMessage += `\n- Due: ${dueDate.toLocaleString()}`;
    }

    if (task.priority !== "medium") {
      confirmationMessage += `\n- Priority: ${task.priority}`;
    }

    if (task.description) {
      confirmationMessage += `\n- Details: ${task.description}`;
    }

    console.log(
      `Task created: ${task.id} (reminder) for user: ${state.userId}`,
    );

    return {
      finalResponse: confirmationMessage,
    };
  } catch (error) {
    console.error("Task node error:", error);
    return {
      finalResponse:
        "I apologize, but I encountered an error while processing your task request. Please try again.",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
