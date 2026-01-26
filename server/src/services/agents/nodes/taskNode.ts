import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { getSupabaseClient } from "../../../config/supabase";
import { z } from "zod";

// Schema for task extraction
const TaskSchema = z.object({
  task_name: z.string().describe("Short, clear name for the task"),
  description: z.string().optional().describe("Detailed description of what needs to be done"),
  due_date: z.string().optional().describe("ISO 8601 date-time when task is due"),
  priority: z.enum(["low", "medium", "high"]).default("medium").describe("Task priority level"),
  is_recurring: z.boolean().default(false).describe("Whether this is a recurring task"),
  reminder_times: z.array(z.string()).optional().describe("Array of ISO 8601 date-times for reminders"),
  tags: z.array(z.string()).optional().describe("Tags to categorize the task"),
  should_create: z.boolean().describe("Whether to actually create this task or just provide information"),
  missing_info: z.string().optional().describe("What critical information is missing, if any"),
});

type TaskExtraction = z.infer<typeof TaskSchema>;

export async function taskNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.0-flash-exp",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  });

  const extractionPrompt = `You are a task extraction agent. Analyze the user's request and extract task parameters.

User Query: "${state.userQuery}"

CRITICAL: Only set should_create=true if you have ALL necessary details to create a meaningful, actionable task.

Required information for tasks:
- WHAT: Clear description of what needs to be done
- WHEN: Specific time/date (or "no deadline" if not time-sensitive)
- For DCA/trading tasks: token, amount, frequency, platform
- For reminders: what to be reminded about AND when

Set should_create=false if ANY critical detail is missing.

Current time: ${new Date().toISOString()}

Examples:
✓ "Remind me to check the market in 2 hours" → should_create=true (has WHAT and WHEN)
✓ "Buy 100 USDC of ETH every Wednesday at 2PM on Uniswap" → should_create=true (complete details)
✗ "Schedule a weekly DCA" → should_create=false, missing_info="What token? How much? Which platform?"
✗ "Set up a reminder" → should_create=false, missing_info="What should I remind you about and when?"
✗ "Remind me about the market" → should_create=false, missing_info="When should I remind you?"`;

  try {
    // Extract task parameters using structured output
    const structuredLlm = llm.withStructuredOutput(TaskSchema);
    const extraction = await structuredLlm.invoke(extractionPrompt) as TaskExtraction;

    // If missing critical information, ask for it
    if (!extraction.should_create) {
      return {
        finalResponse: `I'd be happy to create that task! However, I need a bit more information: ${extraction.missing_info || "Please provide more details about what you'd like me to remind you about and when."}`,
      };
    }

    // Create the task via Supabase
    const supabase = getSupabaseClient();

    const taskRecord = {
      user_id: state.userId,
      task_name: extraction.task_name,
      description: extraction.description || null,
      due_date: extraction.due_date || null,
      priority: extraction.priority,
      status: 'pending',
      tags: extraction.tags || [],
      is_recurring: extraction.is_recurring,
      reminder_times: extraction.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(taskRecord)
      .select()
      .single();

    if (error) {
      console.error('Failed to create task:', error);
      return {
        finalResponse: "I encountered an error while creating your task. Please try again or contact support if the issue persists.",
        error: error.message,
      };
    }

    // Generate confirmation message
    let confirmationMessage = `✓ Task created: **${data.task_name}**`;

    if (data.due_date) {
      const dueDate = new Date(data.due_date);
      confirmationMessage += `\n- Due: ${dueDate.toLocaleString()}`;
    }

    if (data.priority !== 'medium') {
      confirmationMessage += `\n- Priority: ${data.priority}`;
    }

    if (data.is_recurring) {
      confirmationMessage += `\n- Recurring: Yes`;
    }

    if (data.description) {
      confirmationMessage += `\n- Details: ${data.description}`;
    }

    confirmationMessage += `\n\n**What would you like to do next?**\n- Create another task\n- View my task list\n- Update this task`;

    console.log(`Task created: ${data.id} for user: ${state.userId}`);

    return {
      finalResponse: confirmationMessage,
    };
  } catch (error) {
    console.error('Task node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error while processing your task request. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
