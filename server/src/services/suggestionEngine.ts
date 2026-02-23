import { getEventMonitorService, type WalletEvent, type EventType } from "./eventMonitorService";
import { getUserStateService, type UserState } from "./userStateService";
import { getSuggestionThrottler, type SuggestionRecord } from "./suggestionThrottler";
import { getNotificationService } from "./notificationService";
import { getTaskStorageService } from "./taskStorageService";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface Suggestion {
  type: string;
  text: string;
  data: Record<string, any>;
  /** Optional: pre-filled task fields if user accepts */
  taskTemplate?: {
    task_name: string;
    description: string;
    priority: "low" | "medium" | "high";
    tags: string[];
  };
}

// ══════════════════════════════════════════════════════════════════════
// SUGGESTION RULES
// ══════════════════════════════════════════════════════════════════════

/**
 * Maps a wallet event to a suggestion. Returns null if no suggestion
 * is appropriate for this event.
 */
function eventToSuggestion(event: WalletEvent, state: UserState): Suggestion | null {
  const { event_type, event_data } = event;
  const riskLevel = state.preferences?.risk_tolerance || "moderate";

  switch (event_type) {
    case "token_received": {
      const coinType = event_data.coinType || "unknown";
      const symbol = coinType.split("::").pop() || coinType;

      if (event_data.isNew) {
        return {
          type: "research_new_token",
          text: `You received a new token: ${symbol}. Want me to research it for you?`,
          data: { coinType, symbol, ...event_data },
          taskTemplate: {
            task_name: `Research ${symbol}`,
            description: `New token ${symbol} appeared in your wallet. Auto-generated research task.`,
            priority: "medium",
            tags: ["research", "auto-suggestion"],
          },
        };
      }

      // Significant top-up
      if (symbol === "SUI" && riskLevel !== "conservative") {
        return {
          type: "stake_idle",
          text: `You received more SUI (+${event_data.changePercent || "?"}%). Consider staking idle SUI for rewards?`,
          data: { coinType, ...event_data },
          taskTemplate: {
            task_name: "Review SUI staking options",
            description: "SUI balance increased. Review staking validators for optimal APR.",
            priority: "low",
            tags: ["staking", "auto-suggestion"],
          },
        };
      }

      return null;
    }

    case "token_sent": {
      if (event_data.fullyRemoved) {
        const coinType = event_data.coinType || "unknown";
        const symbol = coinType.split("::").pop() || coinType;
        return {
          type: "price_alert",
          text: `All your ${symbol} has been sent. Want me to set a re-buy alert for when the price dips?`,
          data: { coinType, symbol, ...event_data },
          taskTemplate: {
            task_name: `Set price alert for ${symbol}`,
            description: `Token ${symbol} fully removed from wallet. Monitor for re-entry opportunity.`,
            priority: "low",
            tags: ["alert", "auto-suggestion"],
          },
        };
      }
      return null;
    }

    case "balance_change": {
      const pct = event_data.changePercent || 0;
      const direction = event_data.direction || "change";
      const coinType = event_data.coinType || "unknown";
      const symbol = coinType.split("::").pop() || coinType;

      if (pct >= 10) {
        return {
          type: "portfolio_review",
          text: `Significant ${direction} detected in ${symbol} (${pct}%). Time for a portfolio review?`,
          data: { coinType, symbol, changePercent: pct, direction, ...event_data },
          taskTemplate: {
            task_name: "Portfolio review",
            description: `${symbol} moved ${pct}% (${direction}). Review portfolio allocation and risk exposure.`,
            priority: "medium",
            tags: ["portfolio", "auto-suggestion"],
          },
        };
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Generates a suggestion from a completed research query.
 */
function researchToSuggestion(
  query: string,
  _response: string
): Suggestion | null {
  // Extract token mentions from the query
  const tokenMatch = query.match(/\b([A-Z]{2,10})\b/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (token) {
    return {
      type: "research_followup",
      text: `You researched ${token}. Want me to add it to your watchlist and alert you on price moves?`,
      data: { token, originalQuery: query },
      taskTemplate: {
        task_name: `Track ${token} price`,
        description: `Auto-generated after researching ${token}. Monitor for significant price changes.`,
        priority: "low",
        tags: ["watchlist", "auto-suggestion"],
      },
    };
  }

  return null;
}

/**
 * Generates idle-balance suggestions from wallet state.
 */
function idleBalanceSuggestion(state: UserState): Suggestion | null {
  const snapshot = state.wallet_snapshot;
  if (!snapshot || !snapshot.coins) return null;

  const suiCoin = snapshot.coins.find(
    (c) => c.coinType === "0x2::sui::SUI" || c.symbol === "SUI"
  );

  if (!suiCoin) return null;

  // Check if balance is significant (>10 SUI = 10_000_000_000 MIST)
  const balance = BigInt(suiCoin.balance || "0");
  if (balance < 10_000_000_000n) return null;

  // Only suggest if snapshot hasn't changed much recently (idle)
  const snapshotAge = Date.now() - new Date(snapshot.capturedAt).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (snapshotAge < sevenDays) return null; // Snapshot is recent, balance may still be active

  const suiAmount = Number(balance) / 1_000_000_000;

  return {
    type: "stake_idle",
    text: `You have ${suiAmount.toFixed(1)} SUI sitting idle for over a week. Stake it for validator rewards?`,
    data: { balance: suiCoin.balance, suiAmount, idleDays: Math.floor(snapshotAge / (24 * 60 * 60 * 1000)) },
    taskTemplate: {
      task_name: "Stake idle SUI",
      description: `${suiAmount.toFixed(1)} SUI has been idle. Review staking options for passive income.`,
      priority: "low",
      tags: ["staking", "auto-suggestion"],
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// ENGINE
// ══════════════════════════════════════════════════════════════════════

export class SuggestionEngine {
  private throttler = getSuggestionThrottler();
  private userState = getUserStateService();
  private eventMonitor = getEventMonitorService();
  private notifications = getNotificationService();
  private taskStorage = getTaskStorageService();
  private model: ChatGoogleGenerativeAI;

  constructor() {
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.7,
    });
  }

  // ── Event-Triggered Suggestions ───────────────────────────────────

  /**
   * Processes unprocessed wallet events and generates suggestions.
   * Called by scheduler every 6 hours for active wallets.
   */
  async processEventSuggestions(walletAddress: string): Promise<number> {
    const events = await this.eventMonitor.getRecentEvents(walletAddress, {
      unprocessedOnly: true,
      limit: 10,
    });

    if (events.length === 0) return 0;

    const state = await this.userState.getOrCreateState(walletAddress);
    let suggestionsGenerated = 0;

    for (const event of events) {
      const suggestion = eventToSuggestion(event, state);
      if (!suggestion) continue;

      const delivered = await this.deliverSuggestion(walletAddress, suggestion);
      if (delivered) suggestionsGenerated++;

      // Stop if we hit the throttle
      const check = await this.throttler.canSuggest(walletAddress, suggestion.type);
      if (!check.allowed) break;
    }

    // Mark events as processed regardless of suggestion delivery
    const eventIds = events
      .filter((e) => e.id !== undefined)
      .map((e) => e.id!);
    if (eventIds.length > 0) {
      await this.eventMonitor.markEventsProcessed(eventIds);
    }

    return suggestionsGenerated;
  }

  // ── Post-Research Suggestions ─────────────────────────────────────

  /**
   * Called after research agent completes a query.
   * Generates follow-up suggestions based on what was researched.
   */
  async onResearchComplete(
    walletAddress: string,
    query: string,
    response: string
  ): Promise<void> {
    try {
      // 1. Try LLM for intelligent suggestion
      const prompt = `
        You are a Web3 Personal Assistant. The user just performed this research:
        Query: "${query}"
        Report Summary: "${response.substring(0, 1000)}..."

        Based on this, suggest ONE highly relevant, actionable follow-up task.
        Keep the suggestion text extremely brief and concise (maximum 2 sentences), as it will be sent as a mobile notification.
        Examples: 
        - If they researched a risky token, suggest "Set a price alert for exit" or "Review security warnings".
        - If they researched a solid token, suggest "Add to watchlist" or "Check staking APR".
        - If they asked about a wallet, suggest "Monitor large outflows".

        Return ONLY a JSON object with this structure:
        {
          "text": "The suggestion text to show the user",
          "taskTemplate": {
            "task_name": "Short task title",
            "description": "Task description",
            "priority": "low" | "medium" | "high",
            "tags": ["research", "follow-up"]
          }
        }
      `;

      try {
        const res = await this.model.invoke(prompt);
        const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const intelligentSuggestion = JSON.parse(jsonMatch[0]) as Suggestion;
          if (intelligentSuggestion.text && intelligentSuggestion.taskTemplate) {
            await this.deliverSuggestion(walletAddress, {
              ...intelligentSuggestion,
              type: "intelligent_followup"
            });
            return;
          }
        }
      } catch (llmErr) {
        console.warn(`[SuggestionEngine] LLM suggestion failed, falling back: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}`);
      }

      // 2. Fallback to regex
      const suggestion = researchToSuggestion(query, response);
      if (!suggestion) return;

      await this.deliverSuggestion(walletAddress, suggestion);
    } catch (err: any) {
      console.warn(`[SuggestionEngine] Post-research suggestion failed: ${err?.message}`);
    }
  }

  // ── Daily Scan ────────────────────────────────────────────────────

  /**
   * Runs daily proactive checks for a wallet.
   * Called by scheduler once per day at 09:00 UTC.
   */
  async runDailyScan(walletAddress: string): Promise<number> {
    let suggestionsGenerated = 0;

    try {
      const state = await this.userState.getOrCreateState(walletAddress);

      // 1. Idle balance check
      const idleSuggestion = idleBalanceSuggestion(state);
      if (idleSuggestion) {
        const delivered = await this.deliverSuggestion(walletAddress, idleSuggestion);
        if (delivered) suggestionsGenerated++;
      }

      // Future: 2. Epoch change staking rewards
      // Future: 3. Trending tokens from Tavily matching portfolio

    } catch (err: any) {
      console.warn(`[SuggestionEngine] Daily scan failed for ${walletAddress.slice(0, 10)}...: ${err?.message}`);
    }

    return suggestionsGenerated;
  }

  // ── Suggestion Acceptance ─────────────────────────────────────────

  /**
   * Accepts a suggestion: creates the task and updates the suggestion status.
   * Called when user taps "Accept" on Telegram inline button or web UI.
   */
  async acceptSuggestion(suggestionId: number): Promise<boolean> {
    const suggestion = await this.throttler.getById(suggestionId);
    if (!suggestion || suggestion.status !== "pending") return false;

    // Create task from template if available
    const template = suggestion.suggestion_data?.taskTemplate;
    if (template) {
      await this.taskStorage.createTask(suggestion.wallet_address, {
        task_name: template.task_name,
        description: template.description,
        priority: template.priority || "medium",
        tags: template.tags || ["auto-suggestion"],
        status: "pending",
        due_notification_sent: false,
      });
    }

    await this.throttler.respondToSuggestion(suggestionId, "accepted");
    return true;
  }

  /**
   * Dismisses a suggestion. Used for throttle learning.
   */
  async dismissSuggestion(suggestionId: number): Promise<boolean> {
    return this.throttler.respondToSuggestion(suggestionId, "dismissed");
  }

  // ── Core Delivery ─────────────────────────────────────────────────

  /**
   * Delivers a suggestion to the user if throttle allows.
   * Returns true if the suggestion was successfully delivered.
   */
  private async deliverSuggestion(
    walletAddress: string,
    suggestion: Suggestion
  ): Promise<boolean> {
    // Throttle check
    const check = await this.throttler.canSuggest(walletAddress, suggestion.type);
    if (!check.allowed) {
      console.log(
        `[SuggestionEngine] Throttled for ${walletAddress.slice(0, 10)}...: ${check.reason}`
      );
      return false;
    }

    // Record in database
    const suggestionId = await this.throttler.recordSuggestion({
      wallet_address: walletAddress,
      suggestion_type: suggestion.type,
      suggestion_text: suggestion.text,
      suggestion_data: {
        ...suggestion.data,
        taskTemplate: suggestion.taskTemplate,
      },
      status: "pending",
      delivered_via: "telegram",
    });

    if (!suggestionId) return false;

    // Deliver via notification service
    try {
      await this.notifications.sendSuggestionNotification(
        walletAddress,
        suggestionId,
        suggestion.text,
        suggestion.type
      );

      console.log(
        `[SuggestionEngine] Delivered: "${suggestion.type}" to ${walletAddress.slice(0, 10)}... (id=${suggestionId})`
      );
      return true;
    } catch (err: any) {
      console.warn(`[SuggestionEngine] Delivery failed: ${err?.message}`);
      return false;
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: SuggestionEngine | null = null;

export function getSuggestionEngine(): SuggestionEngine {
  if (!instance) instance = new SuggestionEngine();
  return instance;
}
