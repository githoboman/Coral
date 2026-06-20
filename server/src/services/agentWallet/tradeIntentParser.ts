import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";

/**
 * Natural-language trade-intent parser. Turns a user instruction like
 * "swap 30% of my SUI to USDC" or "buy SUI if it drops below 0.20" into a
 * structured TradeIntent the agent engine can validate against policy and execute.
 *
 * Mirrors the codebase's existing pattern (taskManagerAgent): Gemini Flash +
 * Zod `withStructuredOutput`, temperature 0 for deterministic extraction.
 */

export const TradeIntentSchema = z.object({
  // The kind of action the user is asking for.
  action: z
    .enum(["market_swap", "limit_order", "percentage_swap", "conditional_swap", "scheduled_swap", "cancel", "unknown"])
    .describe("The trading action the user wants the agent to perform."),
  // Asset moving OUT of the agent wallet (what they're spending/selling).
  tokenIn: z.string().optional().describe("Symbol of the input token, e.g. SUI or USDC."),
  // Asset moving IN (what they want to receive).
  tokenOut: z.string().optional().describe("Symbol of the output token, e.g. USDC or SUI."),
  // Fixed amount in whole tokens (e.g. 100 for '100 SUI'). Omit for percentage.
  amount: z.number().optional().describe("Fixed amount in whole token units."),
  // Percentage of the agent's balance to trade (e.g. 30 for '30%').
  percentage: z.number().optional().describe("Percentage of balance to trade, 1-100."),
  // Limit / conditional price in quote units (e.g. 0.20 USDC per SUI).
  price: z.number().optional().describe("Target price for limit or conditional orders."),
  // For conditional orders: trigger when price goes below/above this.
  condition: z.enum(["below", "above"]).optional().describe("Price condition direction."),
  // ISO time or natural phrase for scheduled execution (e.g. '15:00 UTC').
  schedule: z.string().optional().describe("When to run a scheduled action."),
  // A short, friendly restatement of what the agent understood.
  summary: z.string().describe("One-sentence plain-language summary of the parsed intent."),
});

export type TradeIntent = z.infer<typeof TradeIntentSchema>;

const SYSTEM_PROMPT = `You translate a user's natural-language crypto instruction into a structured trade intent for an autonomous agent on the Sui blockchain trading via DeepBook.

Rules:
- Supported tokens: SUI, USDC. If a token isn't named, infer from context; default the pair to SUI/USDC.
- "swap 100 SUI to USDC" -> action=market_swap, tokenIn=SUI, tokenOut=USDC, amount=100.
- "swap 30% of my SUI" -> action=percentage_swap, tokenIn=SUI, tokenOut=USDC, percentage=30.
- "buy USDC if SUI drops below 0.25" -> action=conditional_swap, tokenIn=SUI, tokenOut=USDC, price=0.25, condition=below.
- "place a limit order to buy SUI at 0.20" -> action=limit_order, tokenIn=USDC, tokenOut=SUI, price=0.20.
- "swap 50 SUI at 3pm UTC" -> action=scheduled_swap, amount=50, schedule="15:00 UTC".
- "cancel my orders" -> action=cancel.
- If the instruction isn't a trade, action=unknown.
- Always fill 'summary' with a clear one-line restatement.
- Never invent amounts or prices that the user didn't state.`;

export class TradeIntentParser {
  private llm;
  private structured;

  constructor() {
    this.llm = new ChatGoogleGenerativeAI({
      model: process.env.LLM_MODEL || "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY_TASK || process.env.GEMINI_API_KEY,
      temperature: 0,
      maxRetries: 1,
      maxOutputTokens: 512,
    });
    this.structured = this.llm.withStructuredOutput(TradeIntentSchema);
  }

  /** Parse a natural-language instruction into a structured TradeIntent. */
  async parse(message: string): Promise<TradeIntent> {
    return this.structured.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ]);
  }
}

let instance: TradeIntentParser | null = null;
export function getTradeIntentParser(): TradeIntentParser {
  if (!instance) instance = new TradeIntentParser();
  return instance;
}
