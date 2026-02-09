import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { getSupabaseClient } from "../../../config/supabase";
import { z } from "zod";

// Schema for alert/event extraction
const AlertSchema = z.object({
  event_name: z.string().describe("Short, clear name for the alert/event"),
  description: z.string().optional().describe("Detailed description of the alert condition or event"),
  event_date: z.string().describe("ISO 8601 date-time when alert should trigger or event occurs"),
  event_time: z.string().optional().describe("Time in HH:MM format if specific time is needed"),
  is_all_day: z.boolean().default(false).describe("Whether this is an all-day event"),
  is_recurring: z.boolean().default(false).describe("Whether this alert/event recurs"),
  reminder_times: z.array(z.string()).optional().describe("Array of ISO 8601 date-times for reminders"),
  tags: z.array(z.string()).optional().describe("Tags like 'price-alert', 'wallet-monitor', etc."),
  should_create: z.boolean().describe("Whether to actually create this alert or just provide information"),
  missing_info: z.string().optional().describe("What critical information is missing, if any"),
});

type AlertExtraction = z.infer<typeof AlertSchema>;

export async function alertNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.0-flash-exp",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  });

  const extractionPrompt = `Extract alert parameters for a Web3 assistant.
Query: "${state.userQuery}"
Time: ${new Date().toISOString()}

RULES:
- should_create: true ONLY if all details (WHAT, WHEN, TARGET) are present.
- Price alerts: Need token name AND target price.
- Wallet alerts: Need wallet address AND specifically what to monitor.
- Whale tracking: Need blockchain AND size threshold.

EXAMPLES:
- "Alert me when SUI hits $5" -> {should_create: true, event_name: "SUI Price Alert"}
- "Monitor 0x123... for tx > $10k" -> {should_create: true, event_name: "Wallet Monitor"}
- "Track whale movements" -> {should_create: false, missing_info: "Blockchain and size threshold missing"}
- "Monitor my wallet" -> {should_create: false, missing_info: "Wallet address and monitor criteria missing"}`;

  try {
    // Extract alert parameters using structured output
    const structuredLlm = llm.withStructuredOutput(AlertSchema);
    const extraction = await structuredLlm.invoke(extractionPrompt) as AlertExtraction;

    // If missing critical information, ask for it
    if (!extraction.should_create) {
      return {
        finalResponse: `I'd be happy to set up that alert! However, I need a bit more information: ${extraction.missing_info || "Please provide more details about what you'd like to be alerted about."}`,
      };
    }

    // Create the event/alert via Supabase
    const supabase = getSupabaseClient();

    const eventRecord = {
      user_id: state.userId,
      event_name: extraction.event_name,
      description: extraction.description || null,
      event_date: extraction.event_date,
      event_time: extraction.event_time || null,
      color: 'bg-amber-500', // Alert color (amber for visibility)
      location: null,
      is_all_day: extraction.is_all_day,
      tags: extraction.tags || ['alert'],
      attendees: [],
      is_recurring: extraction.is_recurring,
      reminder_times: extraction.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('events')
      .insert(eventRecord)
      .select()
      .single();

    if (error) {
      console.error('Failed to create alert:', error);
      return {
        finalResponse: "I encountered an error while setting up your alert. Please try again or contact support if the issue persists.",
        error: error.message,
      };
    }

    // Generate confirmation message
    let confirmationMessage = `✓ Alert created: **${data.event_name}**`;

    if (data.event_date) {
      const eventDate = new Date(data.event_date);
      confirmationMessage += `\n- Trigger: ${eventDate.toLocaleString()}`;
    }

    if (data.is_recurring) {
      confirmationMessage += `\n- Recurring: Yes`;
    }

    if (data.description) {
      confirmationMessage += `\n- Details: ${data.description}`;
    }

    confirmationMessage += `\n\n**What would you like to do next?**\n- Set another alert\n- View active alerts\n- Check wallet status`;

    console.log(`Alert created: ${data.id} for user: ${state.userId}`);

    return {
      finalResponse: confirmationMessage,
    };
  } catch (error) {
    console.error('Alert node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error while setting up your alert. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
