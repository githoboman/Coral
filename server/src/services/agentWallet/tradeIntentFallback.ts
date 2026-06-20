import { TradeIntentSchema, type TradeIntent } from "./tradeIntentSchema.js";

/**
 * Deterministic, dependency-free fallback parser for natural-language trade
 * instructions. Used as a safety net when the Gemini-backed parser is
 * unavailable (missing/invalid GEMINI_API_KEY, network error, rate limit) so the
 * NL command box keeps working in a live demo. Covers the same canonical shapes
 * the LLM is prompted on; returns action="unknown" when it can't read the text.
 *
 * This is intentionally conservative: it never invents amounts or prices the
 * user didn't write, mirroring the LLM system prompt.
 */

const TOKENS = ["SUI", "USDC"];

/** Find a token symbol near a keyword, else null. */
function findTokens(text: string): string[] {
  const found: string[] = [];
  const upper = text.toUpperCase();
  // Preserve textual order so "SUI ... USDC" maps to in→out correctly.
  const re = /\b(SUI|USDC)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) found.push(m[1]);
  return found;
}

/** Resolve in/out from the tokens mentioned and a default pair. */
function resolvePair(tokens: string[], fallbackIn = "SUI", fallbackOut = "USDC"): { tokenIn: string; tokenOut: string } {
  if (tokens.length >= 2) return { tokenIn: tokens[0], tokenOut: tokens[1] };
  if (tokens.length === 1) {
    const t = tokens[0];
    // Single token named: assume they're spending it, default the counter-asset.
    return t === "USDC" ? { tokenIn: "USDC", tokenOut: "SUI" } : { tokenIn: t, tokenOut: t === "SUI" ? "USDC" : "SUI" };
  }
  return { tokenIn: fallbackIn, tokenOut: fallbackOut };
}

function num(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
}

/**
 * Parse a natural-language instruction into a structured TradeIntent without any
 * LLM. Returns a validated TradeIntent (action="unknown" on failure).
 */
export function parseIntentFallback(message: string): TradeIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const tokens = findTokens(text);

  // cancel
  if (/\bcancel\b/.test(lower)) {
    return TradeIntentSchema.parse({ action: "cancel", summary: "Cancel open orders." });
  }

  const percentage = num(text, /(\d+(?:\.\d+)?)\s*%/);
  const priceMatch = text.match(/(?:below|above|at|under|over)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const price = priceMatch ? Number(priceMatch[1]) : undefined;

  // Resolve the trade amount. Prefer a token-qualified number ("100 SUI"); only
  // fall back to a bare number when it isn't the price we already extracted, so
  // "buy if SUI drops below 0.25" doesn't mistake the 0.25 price for an amount.
  const amountFromToken = num(text, /(\d+(?:\.\d+)?)\s*(?:sui|usdc)\b/i);
  // Strip the price phrase and any "N%" so neither is mistaken for the amount.
  const bareText = (priceMatch ? text.replace(priceMatch[0], " ") : text).replace(/\d+(?:\.\d+)?\s*%/g, " ");
  const amount = amountFromToken ?? num(bareText, /\b(\d+(?:\.\d+)?)\b/);
  const condition: "below" | "above" | undefined = /\b(below|under|drops?|less than)\b/i.test(lower)
    ? "below"
    : /\b(above|over|rises?|more than)\b/i.test(lower)
    ? "above"
    : undefined;
  const scheduleMatch =
    text.match(/\b(?:at|@)\s*(\d{1,2}:\d{2}\s*(?:utc|am|pm)?)/i) ||
    text.match(/\b(in\s+\d+\s*(?:min|minute|minutes|hour|hours))\b/i);
  const schedule = scheduleMatch ? scheduleMatch[1].trim() : undefined;

  // conditional: has a direction + price ("buy SUI if it drops below 0.20")
  if (condition && price != null && /\b(if|when|once)\b/i.test(lower)) {
    const { tokenIn, tokenOut } = resolvePair(tokens);
    return TradeIntentSchema.parse({
      action: "conditional_swap",
      tokenIn,
      tokenOut,
      price,
      condition,
      ...(amount != null ? { amount } : {}),
      summary: `Swap ${tokenIn} → ${tokenOut} when price goes ${condition} ${price}.`,
    });
  }

  // limit order: explicit "limit" + a price
  if (/\blimit\b/i.test(lower) && price != null) {
    const { tokenIn, tokenOut } = resolvePair(tokens);
    return TradeIntentSchema.parse({
      action: "limit_order",
      tokenIn,
      tokenOut,
      ...(amount != null ? { amount } : {}),
      price,
      summary: `Limit order ${amount ?? ""} ${tokenIn} @ ${price}.`.replace(/\s+/g, " ").trim(),
    });
  }

  // scheduled: a swap with a time phrase
  if (schedule && /\b(swap|buy|sell|trade)\b/i.test(lower)) {
    const { tokenIn, tokenOut } = resolvePair(tokens);
    return TradeIntentSchema.parse({
      action: "scheduled_swap",
      tokenIn,
      tokenOut,
      ...(amount != null ? { amount } : {}),
      schedule,
      summary: `Scheduled swap ${amount ?? ""} ${tokenIn} → ${tokenOut} at ${schedule}.`.replace(/\s+/g, " ").trim(),
    });
  }

  // percentage swap
  if (percentage != null && /\b(swap|sell|buy|trade|convert)\b/i.test(lower)) {
    const { tokenIn, tokenOut } = resolvePair(tokens);
    return TradeIntentSchema.parse({
      action: "percentage_swap",
      tokenIn,
      tokenOut,
      percentage,
      summary: `Swap ${percentage}% of ${tokenIn} → ${tokenOut}.`,
    });
  }

  // market swap: a swap verb + an amount
  if (amount != null && /\b(swap|sell|buy|trade|convert|exchange)\b/i.test(lower)) {
    const { tokenIn, tokenOut } = resolvePair(tokens);
    return TradeIntentSchema.parse({
      action: "market_swap",
      tokenIn,
      tokenOut,
      amount,
      summary: `Swap ${amount} ${tokenIn} → ${tokenOut}.`,
    });
  }

  return TradeIntentSchema.parse({
    action: "unknown",
    summary: `Couldn't read "${text}" as a trade instruction.`,
  });
}

export const _testing = { findTokens, resolvePair };
export { TOKENS };
