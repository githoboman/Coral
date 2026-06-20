import { getTradeIntentParser, type TradeIntent } from "./tradeIntentParser.js";
import { getSwapAgent } from "./swapAgent.js";
import { executePercentageSwap, scheduleSwap, watchPriceCondition } from "./strategies.js";
import { getAgentWalletStore } from "./store.js";
import type { AgentWalletRecord } from "./types.js";
import type { DeepBookSetup } from "./deepbookClient.js";
import type { SwapOutcome } from "./swapAgent.js";

/**
 * The agentic entrypoint: take a natural-language instruction, parse it into a
 * structured intent, validate it has what it needs, and route it to the right
 * policy-guarded executor. This is what turns the system from "a DeFi tool with
 * limits" into "an autonomous agent you instruct in plain language."
 */

// Whole-token -> base-unit scalars (must match the on-chain coin decimals).
const DECIMALS: Record<string, number> = { SUI: 9, USDC: 6 };

function toBaseUnits(amount: number, symbol: string): bigint {
  const d = DECIMALS[symbol.toUpperCase()] ?? 9;
  // Avoid float drift: scale via string.
  return BigInt(Math.round(amount * 10 ** d));
}

export interface IntentResult {
  ok: boolean;
  intent: TradeIntent;
  /** Human-readable outcome line for the UI. */
  message: string;
  /** Present when an action actually executed. */
  outcome?: SwapOutcome;
  /** Present for background actions (scheduled / conditional) that are now armed. */
  armed?: "scheduled" | "conditional";
}

export class TradeIntentService {
  /**
   * Parse + route a natural-language instruction for an owner. Resolves the owner's
   * agent wallet and the DeepBook setup, then dispatches by intent.action.
   */
  async handle(ownerAddress: string, message: string, deepbook: DeepBookSetup): Promise<IntentResult> {
    const intent = await getTradeIntentParser().parse(message);

    const wallet = await getAgentWalletStore().getByOwner(ownerAddress);
    if (!wallet) {
      return { ok: false, intent, message: "No agent wallet yet — initialize one first." };
    }
    if (!wallet.policyId || !wallet.capabilityId) {
      return { ok: false, intent, message: "Agent isn't bound to a policy yet. Create a policy first." };
    }

    switch (intent.action) {
      case "market_swap":
        return this.marketSwap(wallet, deepbook, intent);
      case "limit_order":
        return this.limitOrder(wallet, deepbook, intent);
      case "percentage_swap":
        return this.percentageSwap(wallet, deepbook, intent);
      case "conditional_swap":
        return this.conditionalSwap(wallet, deepbook, intent);
      case "scheduled_swap":
        return this.scheduledSwap(wallet, deepbook, intent);
      case "cancel":
        return { ok: false, intent, message: "Cancellation by instruction isn't wired to the demo yet — use the order manager." };
      default:
        return { ok: false, intent, message: `I couldn't read that as a trade. ${intent.summary}` };
    }
  }

  private resolvePair(intent: TradeIntent): { tokenIn: string; tokenOut: string } {
    return { tokenIn: (intent.tokenIn || "SUI").toUpperCase(), tokenOut: (intent.tokenOut || "USDC").toUpperCase() };
  }

  private async marketSwap(wallet: AgentWalletRecord, deepbook: DeepBookSetup, intent: TradeIntent): Promise<IntentResult> {
    const { tokenIn, tokenOut } = this.resolvePair(intent);
    if (intent.amount == null) return { ok: false, intent, message: "How much should I swap? No amount given." };
    const outcome = await getSwapAgent().execute({
      wallet, deepbook, tokenIn, tokenOut,
      amount: toBaseUnits(intent.amount, tokenIn),
      market: true,
    });
    return { ok: outcome.ok, intent, outcome, message: outcome.ok ? `Swapped ${intent.amount} ${tokenIn} → ${tokenOut}.` : (outcome.reason || "Swap rejected.") };
  }

  private async limitOrder(wallet: AgentWalletRecord, deepbook: DeepBookSetup, intent: TradeIntent): Promise<IntentResult> {
    const { tokenIn, tokenOut } = this.resolvePair(intent);
    if (intent.amount == null) return { ok: false, intent, message: "A limit order needs an amount." };
    if (intent.price == null) return { ok: false, intent, message: "A limit order needs a price." };
    const outcome = await getSwapAgent().execute({
      wallet, deepbook, tokenIn, tokenOut,
      amount: toBaseUnits(intent.amount, tokenIn),
      market: false, price: intent.price,
    });
    return { ok: outcome.ok, intent, outcome, message: outcome.ok ? `Placed limit order: ${intent.amount} ${tokenIn} @ ${intent.price}.` : (outcome.reason || "Limit order rejected.") };
  }

  private async percentageSwap(wallet: AgentWalletRecord, deepbook: DeepBookSetup, intent: TradeIntent): Promise<IntentResult> {
    const { tokenIn, tokenOut } = this.resolvePair(intent);
    if (intent.percentage == null) return { ok: false, intent, message: "What percentage should I swap?" };
    const outcome = await executePercentageSwap({ wallet, deepbook, tokenIn, tokenOut, percent: intent.percentage, market: true });
    return { ok: outcome.ok, intent, outcome, message: outcome.ok ? `Swapped ${intent.percentage}% of ${tokenIn} → ${tokenOut}.` : (outcome.reason || "Percentage swap rejected.") };
  }

  private async conditionalSwap(wallet: AgentWalletRecord, deepbook: DeepBookSetup, intent: TradeIntent): Promise<IntentResult> {
    const { tokenIn, tokenOut } = this.resolvePair(intent);
    if (intent.price == null || !intent.condition) {
      return { ok: false, intent, message: "A conditional order needs a price and a direction (above/below)." };
    }
    // Default the conditional size to a small fixed amount if none given; the agent
    // re-validates against policy when the condition fires.
    const amount = toBaseUnits(intent.amount ?? 1, tokenIn);
    watchPriceCondition({
      deepbook,
      condition: intent.condition === "below" ? "below" : "above",
      threshold: intent.price,
      request: { wallet, deepbook, tokenIn, tokenOut, amount, market: true },
    });
    return { ok: true, intent, armed: "conditional", message: `Watching ${tokenIn}/${tokenOut}: will swap when price goes ${intent.condition} ${intent.price}.` };
  }

  private async scheduledSwap(wallet: AgentWalletRecord, deepbook: DeepBookSetup, intent: TradeIntent): Promise<IntentResult> {
    const { tokenIn, tokenOut } = this.resolvePair(intent);
    if (intent.amount == null) return { ok: false, intent, message: "A scheduled swap needs an amount." };
    const atEpochMs = parseScheduleToEpoch(intent.schedule);
    if (!atEpochMs) return { ok: false, intent, message: `I couldn't read the time "${intent.schedule}".` };
    scheduleSwap({
      request: { wallet, deepbook, tokenIn, tokenOut, amount: toBaseUnits(intent.amount, tokenIn), market: true },
      atEpochMs,
    });
    return { ok: true, intent, armed: "scheduled", message: `Scheduled: swap ${intent.amount} ${tokenIn} → ${tokenOut} at ${new Date(atEpochMs).toUTCString()}.` };
  }
}

/**
 * Best-effort parse of a schedule phrase into an absolute epoch ms. Handles
 * "HH:MM UTC" (today/tomorrow), ISO strings, and "in N minutes". Returns null if
 * unparseable.
 */
function parseScheduleToEpoch(schedule?: string): number | null {
  if (!schedule) return null;
  const s = schedule.trim();

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;

  const rel = s.match(/in\s+(\d+)\s*(min|minute|minutes|hour|hours)/i);
  if (rel) {
    const n = Number(rel[1]);
    const mult = /hour/i.test(rel[2]) ? 3_600_000 : 60_000;
    return Date.now() + n * mult;
  }

  const hm = s.match(/(\d{1,2}):(\d{2})/);
  if (hm) {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hm[1]), Number(hm[2]), 0));
    if (target.getTime() <= Date.now()) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime();
  }
  return null;
}

let instance: TradeIntentService | null = null;
export function getTradeIntentService(): TradeIntentService {
  if (!instance) instance = new TradeIntentService();
  return instance;
}
