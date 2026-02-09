import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { getTaskStorageService } from "../../taskStorageService";
import { autonomyService } from "../../autonomyService";
import { z } from "zod";

// Schema for task extraction with Web3 action support
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

  // Web3 action fields
  action_type: z
    .enum(["reminder", "token_transfer", "dca_purchase", "token_swap"])
    .default("reminder")
    .describe(
      "Type of action: reminder (default), token_transfer, dca_purchase, or token_swap (immediate swap)",
    ),
  action_params: z
    .object({
      recipient_address: z
        .string()
        .optional()
        .describe("Recipient wallet address for transfers (0x... format)"),
      coin_type: z
        .string()
        .optional()
        .describe("Token type to transfer, defaults to SUI"),
      amount: z
        .string()
        .optional()
        .describe(
          "Amount to transfer in human-readable format (e.g., '10' for 10 SUI)",
        ),
      from_coin: z.string().optional().describe("Source token for swaps/DCA"),
      to_coin: z.string().optional().describe("Target token for swaps/DCA"),
      amount_per_purchase: z
        .string()
        .optional()
        .describe("Amount to swap per DCA execution"),
      frequency: z
        .enum(["daily", "weekly", "monthly"])
        .optional()
        .describe("How often to execute the DCA"),
      amount_to_swap: z
        .string()
        .optional()
        .describe("Amount to swap (e.g., 'half', 'all', or '10')"),
    })
    .optional()
    .describe("Parameters for the action based on action_type"),
});

type TaskExtraction = z.infer<typeof TaskSchema>;

// Helper to convert human-readable amount to MIST (1 SUI = 1e9 MIST)
function toMist(amount: string): bigint {
  try {
    const num = parseFloat(amount);
    return BigInt(Math.floor(num * 1e9));
  } catch {
    return BigInt(0);
  }
}

export async function taskNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  });

  const extractionPrompt = `Extract task parameters for a Web3 assistant.
Query: "${state.userQuery}"
Time: ${new Date().toISOString()}

RULES:
- should_create: true ONLY if actionable.
- amount: Use "half"/"all" specifically if user mentions them.
- recipient_address: Must be valid Sui 0x... format.

ACTION TYPES:
1. reminder: Default. Needs WHAT & WHEN.
2. token_transfer: Needs recipient_address, amount. Optional coin_type (def. SUI).
3. dca_purchase: Recurring swaps. Needs from_coin, to_coin, amount_per_purchase, frequency.
4. token_swap: Immediate. Needs from_coin, to_coin, amount_to_swap.

EXAMPLES:
- "Send 5 SUI to 0x123... tomorrow" -> {action_type: "token_transfer", action_params: {recipient_address: "0x123...", amount: "5"}, should_create: true}
- "Buy 10 USDC worth of SUI weekly" -> {action_type: "dca_purchase", action_params: {from_coin: "USDC", to_coin: "SUI", amount_per_purchase: "10", frequency: "weekly"}, should_create: true}
- "Swap half my SUI for USDC" -> {action_type: "token_swap", action_params: {from_coin: "SUI", to_coin: "USDC", amount_to_swap: "half"}, should_create: true}
- "Remind me in 2h" -> {action_type: "reminder", should_create: true}
- "Send tokens to friend" -> {should_create: false, missing_info: "Address and amount missing"} `;

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

    // Build action_params for database storage
    let actionParams = null;
    const actionType = extraction.action_type || "reminder";

    if (actionType === "token_transfer" && extraction.action_params) {
      const params = extraction.action_params;
      if (!params.recipient_address) {
        return {
          finalResponse:
            "I need the recipient's wallet address to set up this transfer. What's the Sui address you want to send to?",
        };
      }
      actionParams = {
        recipientAddress: params.recipient_address,
        coinType: params.coin_type || "0x2::sui::SUI",
        amount: toMist(params.amount || "0").toString(), // Convert bigint to string for storage
      };
    } else if (actionType === "dca_purchase" && extraction.action_params) {
      const params = extraction.action_params;
      if (
        !params.from_coin ||
        !params.to_coin ||
        !params.amount_per_purchase ||
        !params.frequency
      ) {
        return {
          finalResponse:
            "For DCA setup, I need: what token to spend, what token to buy, how much per purchase, and how often (daily/weekly/monthly).",
        };
      }
      actionParams = {
        fromCoin: params.from_coin,
        toCoin: params.to_coin,
        amountPerPurchase: params.amount_per_purchase,
        frequency: params.frequency,
      };
    } else if (actionType === "token_swap" && extraction.action_params) {
      const params = extraction.action_params;
      if (!params.from_coin || !params.to_coin || !params.amount_to_swap) {
        return {
          finalResponse:
            "To swap tokens, I need to know: which token to swap from, which token to get, and the amount.",
        };
      }

      let swapAmount = params.amount_to_swap;
      let calculatedDisplay = swapAmount;

      if (
        (swapAmount === "half" || swapAmount === "all") &&
        state.walletBalance
      ) {
        console.log(
          `[TASK NODE] Resolving relative swap amount '${swapAmount}' for user ${state.userId}`,
        );
        console.log(
          `[TASK NODE] Current balance (MIST): ${state.walletBalance.totalBalanceMist}`,
        );

        const total = BigInt(state.walletBalance.totalBalanceMist);
        let calculatedMist = total;
        if (swapAmount === "half") {
          calculatedMist = total / BigInt(2);
        } else {
          const forGas = BigInt(1e8);
          calculatedMist = total > forGas ? total - forGas : BigInt(0);
        }

        const whole = calculatedMist / BigInt(1e9);
        const frac = calculatedMist % BigInt(1e9);
        swapAmount =
          frac > 0
            ? `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`
            : whole.toString();

        calculatedDisplay = `${swapAmount} (${params.amount_to_swap} balance)`;
        console.log(`[TASK NODE] Resolved to: ${swapAmount}`);
      } else if (swapAmount === "half" || swapAmount === "all") {
        console.warn(
          `[TASK NODE] Could not resolve relative amount '${swapAmount}': No wallet balance in state.`,
        );
      }

      actionParams = {
        fromCoin: params.from_coin,
        toCoin: params.to_coin,
        amountToSwap: swapAmount,
        calculatedDisplay: calculatedDisplay,
      };
    }

    // ✅ OPTIMIZATION: Use Walrus storage directly (no Supabase)
    const taskStorage = getTaskStorageService();

    const result = await taskStorage.createTask(state.userId, {
      task_name: extraction.task_name,
      description: extraction.description,
      due_date: extraction.due_date,
      priority: extraction.priority,
      status: "pending",
      tags: extraction.tags || [],
      action_type: actionType,
      action_params: actionParams,
      action_status: actionType !== "reminder" ? "pending" : undefined,
    });

    if (!result) {
      console.error("Failed to create task in Walrus");
      return {
        finalResponse:
          "I encountered an error while creating your task. Please try again or contact support if the issue persists.",
      };
    }

    const task = await taskStorage.getTask(state.userId, result.taskId);

    if (!task) {
      return {
        finalResponse:
          "Task was created but could not be retrieved. Please check your tasks page.",
      };
    }

    // Generate confirmation message based on action type
    let confirmationMessage = "";

    if (actionType === "token_transfer") {
      const params = actionParams as {
        recipientAddress: string;
        amount: string;
        coinType: string;
      };
      const mist = BigInt(params.amount);
      const whole = mist / BigInt(1e9);
      const frac = mist % BigInt(1e9);
      const amountSui =
        frac > 0
          ? `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`
          : whole.toString();

      confirmationMessage = `**Token Transfer Scheduled**
 
- Amount: ${amountSui} SUI
- To: \`${params.recipientAddress.slice(0, 10)}...${params.recipientAddress.slice(-8)}\``;

      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        confirmationMessage += `\n- When: ${dueDate.toLocaleString()}`;
      }
      confirmationMessage += `\n\nWhen it's time, you'll be prompted to sign the transaction with your wallet.`;
    } else if (actionType === "dca_purchase") {
      const params = actionParams as {
        fromCoin: string;
        toCoin: string;
        amountPerPurchase: string;
        frequency: string;
      };
      confirmationMessage = `**DCA Schedule Created**

- Buy: ${params.toCoin}
- Spend: ${params.amountPerPurchase} ${params.fromCoin} per ${params.frequency}
- Status: Pending (DCA execution coming soon)

Note: You'll need to approve each swap transaction when it's due.`;
    } else if (actionType === "token_swap") {
      const params = actionParams as {
        fromCoin: string;
        toCoin: string;
        amountToSwap: string;
        calculatedDisplay?: string;
      };
      confirmationMessage = `**Token Swap Scheduled**\n\n- Swap: ${params.calculatedDisplay || params.amountToSwap} ${params.fromCoin}\n- Into: ${params.toCoin}\n- Rate: Market Rate\n\nPlease approve the swap transaction when prompted.`;
    } else {
      confirmationMessage = `Task created: **${task.task_name}**`;

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
    }

    console.log(
      `Task created: ${task.id} (${actionType}) for user: ${state.userId}`,
    );

    // For token transfers with immediate/near-immediate due date, return pendingAction
    const isImmediate =
      !task.due_date || new Date(task.due_date).getTime() - Date.now() < 60000;

    console.log(
      `[TASK NODE] actionType=${actionType}, isImmediate=${isImmediate}, hasActionParams=${!!actionParams}`,
    );

    // CHECK FOR AUTONOMY (DELEGATION)
    const isDelegated = state.walletAddress
      ? await autonomyService.isDelegated(state.walletAddress)
      : false;

    if (
      isDelegated &&
      isImmediate &&
      actionParams &&
      (actionType === "token_transfer" || actionType === "token_swap")
    ) {
      console.log(`[TASK NODE] Executing AUTONOMOUSLY: ${actionType}`);

      let digest = "";
      if (actionType === "token_transfer") {
        digest = await autonomyService.executeTokenTransfer(
          Number(task.id),
          state.walletAddress!,
          actionParams as any,
        );
      } else {
        digest = await autonomyService.executeTokenSwap(
          Number(task.id),
          state.walletAddress!,
          actionParams as any,
        );
      }

      return {
        finalResponse: `${confirmationMessage}\n\n✅ **Autonomous Action Complete**\nTransaction executed in background: [View on Explorer](https://suiscan.xyz/${process.env.VITE_SUI_NETWORK || "testnet"}/tx/${digest})`,
      };
    }

    if (
      (actionType === "token_transfer" || actionType === "token_swap") &&
      isImmediate &&
      actionParams
    ) {
      console.log(
        `[TASK NODE] Returning pendingAction for immediate ${actionType}:`,
        actionParams,
      );
      return {
        finalResponse: confirmationMessage,
        pendingAction: {
          taskId: task.id,
          actionType: actionType,
          actionParams: actionParams,
        },
      };
    }

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
