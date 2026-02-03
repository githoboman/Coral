import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { getSupabaseClient } from "../../../config/supabase";
import { z } from "zod";

// Schema for task extraction with Web3 action support
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

  // Web3 action fields
  action_type: z.enum(["reminder", "token_transfer", "dca_purchase"]).default("reminder")
    .describe("Type of action: reminder (default), token_transfer (send tokens), or dca_purchase (recurring swap)"),
  action_params: z.object({
    // Token transfer params
    recipient_address: z.string().optional().describe("Recipient wallet address for transfers (0x... format)"),
    coin_type: z.string().optional().describe("Token type to transfer, defaults to SUI"),
    amount: z.string().optional().describe("Amount to transfer in human-readable format (e.g., '10' for 10 SUI)"),
    // DCA params
    from_coin: z.string().optional().describe("Source token for DCA swaps"),
    to_coin: z.string().optional().describe("Target token to buy via DCA"),
    amount_per_purchase: z.string().optional().describe("Amount to swap per DCA execution"),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional().describe("How often to execute the DCA"),
  }).optional().describe("Parameters for the action based on action_type"),
});

type TaskExtraction = z.infer<typeof TaskSchema>;

// Helper to convert human-readable amount to MIST (1 SUI = 1e9 MIST)
function toMist(amount: string): string {
  try {
    const num = parseFloat(amount);
    return (BigInt(Math.floor(num * 1e9))).toString();
  } catch {
    return "0";
  }
}

export async function taskNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  });

  const extractionPrompt = `You are a task extraction agent for a Web3 assistant. Analyze the user's request and extract task parameters.

User Query: "${state.userQuery}"

CRITICAL: Only set should_create=true if you have ALL necessary details to create a meaningful, actionable task.

=== ACTION TYPES ===

1. REMINDER (action_type: "reminder")
   - Default type for simple reminders and tasks
   - Required: WHAT to remind and WHEN
   
2. TOKEN_TRANSFER (action_type: "token_transfer")  
   - For sending tokens to a wallet address
   - Required: recipient_address, amount
   - Optional: coin_type (defaults to "0x2::sui::SUI")
   - Amount should be in human-readable format (e.g., "10" for 10 SUI)
   
3. DCA_PURCHASE (action_type: "dca_purchase")
   - For recurring token swaps (Dollar-Cost Averaging)
   - Required: from_coin, to_coin, amount_per_purchase, frequency
   - This is for scheduled recurring purchases

=== VALIDATION ===

For token_transfer:
- recipient_address MUST be a valid Sui address (0x followed by 64 hex chars)
- If address looks invalid, set should_create=false and ask for correct address

For dca_purchase:
- All 4 fields are required: from_coin, to_coin, amount_per_purchase, frequency

Set should_create=false if ANY critical detail is missing.

Current time: ${new Date().toISOString()}

=== EXAMPLES ===

"Send 5 SUI to 0x1234...abcd tomorrow at 3pm"
→ action_type: "token_transfer"
→ action_params: { recipient_address: "0x1234...abcd", amount: "5", coin_type: "0x2::sui::SUI" }
→ due_date: (tomorrow at 3pm ISO format)
→ should_create: true

"Buy 10 USDC worth of SUI every week"  
→ action_type: "dca_purchase"
→ action_params: { from_coin: "USDC", to_coin: "SUI", amount_per_purchase: "10", frequency: "weekly" }
→ is_recurring: true
→ should_create: true

"Remind me to check the market in 2 hours"
→ action_type: "reminder"
→ should_create: true

"Send some tokens to my friend"
→ should_create: false
→ missing_info: "How much? What token? What's your friend's wallet address?"`;

  try {
    // Extract task parameters using structured output
    const structuredLlm = llm.withStructuredOutput(TaskSchema);
    const extraction = await structuredLlm.invoke(extractionPrompt) as TaskExtraction;

    // If missing critical information, ask for it
    if (!extraction.should_create) {
      return {
        finalResponse: `I'd be happy to create that task! However, I need a bit more information: ${extraction.missing_info || "Please provide more details about what you'd like me to do."}`,
      };
    }

    // Build action_params for database storage
    let actionParams = null;
    const actionType = extraction.action_type || 'reminder';

    if (actionType === 'token_transfer' && extraction.action_params) {
      const params = extraction.action_params;
      if (!params.recipient_address) {
        return {
          finalResponse: "I need the recipient's wallet address to set up this transfer. What's the Sui address you want to send to?",
        };
      }
      actionParams = {
        recipientAddress: params.recipient_address,
        coinType: params.coin_type || "0x2::sui::SUI",
        amount: toMist(params.amount || "0"),
      };
    } else if (actionType === 'dca_purchase' && extraction.action_params) {
      const params = extraction.action_params;
      if (!params.from_coin || !params.to_coin || !params.amount_per_purchase || !params.frequency) {
        return {
          finalResponse: "For DCA setup, I need: what token to spend, what token to buy, how much per purchase, and how often (daily/weekly/monthly).",
        };
      }
      actionParams = {
        fromCoin: params.from_coin,
        toCoin: params.to_coin,
        amountPerPurchase: params.amount_per_purchase,
        frequency: params.frequency,
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
      action_type: actionType,
      action_params: actionParams,
      action_status: actionType !== 'reminder' ? 'pending' : null,
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

    // Generate confirmation message based on action type
    let confirmationMessage = '';

    if (actionType === 'token_transfer') {
      const params = actionParams as { recipientAddress: string; amount: string; coinType: string };
      const amountSui = (BigInt(params.amount) / BigInt(1e9)).toString();
      confirmationMessage = `**Token Transfer Scheduled**

- Amount: ${amountSui} SUI
- To: \`${params.recipientAddress.slice(0, 10)}...${params.recipientAddress.slice(-8)}\``;

      if (data.due_date) {
        const dueDate = new Date(data.due_date);
        confirmationMessage += `\n- When: ${dueDate.toLocaleString()}`;
      }
      confirmationMessage += `\n\nWhen it's time, you'll be prompted to sign the transaction with your wallet.`;

    } else if (actionType === 'dca_purchase') {
      const params = actionParams as { fromCoin: string; toCoin: string; amountPerPurchase: string; frequency: string };
      confirmationMessage = `**DCA Schedule Created**

- Buy: ${params.toCoin}
- Spend: ${params.amountPerPurchase} ${params.fromCoin} per ${params.frequency}
- Status: Pending (DCA execution coming soon)

Note: You'll need to approve each swap transaction when it's due.`;

    } else {
      // Regular reminder/task
      confirmationMessage = `Task created: **${data.task_name}**`;

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
    }

    console.log(`Task created: ${data.id} (${actionType}) for user: ${state.userId}`);

    // For token transfers with immediate/near-immediate due date, return pendingAction
    const isImmediate = !data.due_date ||
      (new Date(data.due_date).getTime() - Date.now() < 60000); // Within 1 minute

    console.log(`[TASK NODE] actionType=${actionType}, isImmediate=${isImmediate}, hasActionParams=${!!actionParams}`);

    if (actionType === 'token_transfer' && isImmediate && actionParams) {
      console.log('[TASK NODE] Returning pendingAction for immediate token transfer:', actionParams);
      return {
        finalResponse: confirmationMessage,
        pendingAction: {
          taskId: data.id,
          actionType: actionType,
          actionParams: actionParams,
        },
      };
    }

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
