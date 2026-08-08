import { z } from "zod";

/**
 * Structured shape of a parsed natural-language trade instruction. Shared by the
 * Gemini-backed parser and the deterministic fallback so both produce identical,
 * validated output the agent engine can route on.
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
