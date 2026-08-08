import { getSupabaseClient } from "../config/supabase";
import { getUserStateService, type UserPreferences } from "./userStateService";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface SuggestionRecord {
  id?: number;
  wallet_address: string;
  suggestion_type: string;
  suggestion_text: string;
  suggestion_data: Record<string, any>;
  status: "pending" | "accepted" | "dismissed" | "expired";
  delivered_via: "telegram" | "web" | "both";
  created_at?: string;
  responded_at?: string;
}

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════

// Default daily cap (overridden by notification_frequency preference)
const DAILY_CAPS: Record<string, number> = {
  low: 1,
  normal: 3,
  high: 5,
};

// Minimum gap between any two suggestions (ms)
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

// After N dismissals of the same type, suppress for SUPPRESS_DAYS
const DISMISS_THRESHOLD = 3;
const SUPPRESS_DAYS = 7;

// ══════════════════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════════════════

export class SuggestionThrottler {
  private supabase = getSupabaseClient();
  private userState = getUserStateService();

  // ── Can we send? ──────────────────────────────────────────────────

  /**
   * Returns true if we're allowed to send a suggestion of `type` to this wallet.
   * Checks: proactive opt-in, daily cap, cooldown, dismissal suppression.
   */
  async canSuggest(
    walletAddress: string,
    suggestionType: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1. Check proactive opt-in
    const prefs = await this.userState.getPreferences(walletAddress);
    if (!prefs.proactive_suggestions) {
      return { allowed: false, reason: "proactive_disabled" };
    }

    // 2. Daily cap
    const dailyCap = DAILY_CAPS[prefs.notification_frequency] || DAILY_CAPS.normal;
    const todayCount = await this.getTodayCount(walletAddress);
    if (todayCount >= dailyCap) {
      return { allowed: false, reason: `daily_cap_${dailyCap}` };
    }

    // 3. Cooldown between suggestions
    const lastSuggestionTime = await this.getLastSuggestionTime(walletAddress);
    if (lastSuggestionTime) {
      const elapsed = Date.now() - new Date(lastSuggestionTime).getTime();
      if (elapsed < COOLDOWN_MS) {
        const remainingMin = Math.ceil((COOLDOWN_MS - elapsed) / 60_000);
        return { allowed: false, reason: `cooldown_${remainingMin}min` };
      }
    }

    // 4. Dismissal suppression
    const isSuppressed = await this.isTypeSuppressed(walletAddress, suggestionType);
    if (isSuppressed) {
      return { allowed: false, reason: `type_suppressed_${suggestionType}` };
    }

    return { allowed: true };
  }

  // ── Recording ─────────────────────────────────────────────────────

  /**
   * Records a new suggestion delivery.
   * Returns the suggestion ID for later status updates.
   */
  async recordSuggestion(
    suggestion: Omit<SuggestionRecord, "id" | "created_at" | "responded_at">
  ): Promise<number | null> {
    const { data, error } = await this.supabase
      .from("suggestion_history")
      .insert(suggestion)
      .select("id")
      .single();

    if (error) {
      console.error("[Throttler] Failed to record suggestion:", error.message);
      return null;
    }

    return data.id;
  }

  /**
   * Updates a suggestion's status (accepted or dismissed).
   */
  async respondToSuggestion(
    suggestionId: number,
    status: "accepted" | "dismissed"
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from("suggestion_history")
      .update({
        status,
        responded_at: new Date().toISOString(),
      })
      .eq("id", suggestionId);

    if (error) {
      console.error("[Throttler] Failed to update suggestion:", error.message);
      return false;
    }

    return true;
  }

  // ── Queries ───────────────────────────────────────────────────────

  /**
   * Returns recent suggestions for a wallet.
   */
  async getRecent(
    walletAddress: string,
    limit: number = 20
  ): Promise<SuggestionRecord[]> {
    const { data, error } = await this.supabase
      .from("suggestion_history")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as SuggestionRecord[];
  }

  /**
   * Gets a single suggestion by ID.
   */
  async getById(suggestionId: number): Promise<SuggestionRecord | null> {
    const { data, error } = await this.supabase
      .from("suggestion_history")
      .select("*")
      .eq("id", suggestionId)
      .single();

    if (error || !data) return null;
    return data as SuggestionRecord;
  }

  // ── Internal checks ───────────────────────────────────────────────

  private async getTodayCount(walletAddress: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count, error } = await this.supabase
      .from("suggestion_history")
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", walletAddress)
      .gte("created_at", todayStart.toISOString());

    return error ? 0 : (count || 0);
  }

  private async getLastSuggestionTime(
    walletAddress: string
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("suggestion_history")
      .select("created_at")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.created_at;
  }

  private async isTypeSuppressed(
    walletAddress: string,
    suggestionType: string
  ): Promise<boolean> {
    const cutoff = new Date(
      Date.now() - SUPPRESS_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { count, error } = await this.supabase
      .from("suggestion_history")
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", walletAddress)
      .eq("suggestion_type", suggestionType)
      .eq("status", "dismissed")
      .gte("created_at", cutoff);

    return !error && (count || 0) >= DISMISS_THRESHOLD;
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: SuggestionThrottler | null = null;

export function getSuggestionThrottler(): SuggestionThrottler {
  if (!instance) instance = new SuggestionThrottler();
  return instance;
}
