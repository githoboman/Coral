import { getSupabaseClient } from "../config/supabase";
import { getBlockVisionService } from "./blockVisionService";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface WalletSnapshot {
  coins: Array<{
    coinType: string;
    symbol: string;
    balance: string;
    price?: number;
    valueUsd?: number;
  }>;
  totalValue: number;
  nftCount: number;
  capturedAt: string;
}

export interface InteractionPatterns {
  query_counts: Record<string, number>;   // e.g. { "research": 5, "task_create": 3 }
  tokens_researched: string[];            // tokens the user has asked about
  last_interaction: string | null;
  total_interactions: number;
}

export interface UserPreferences {
  risk_tolerance: "conservative" | "moderate" | "aggressive";
  notification_frequency: "low" | "normal" | "high";
  proactive_suggestions: boolean;
  tracking_opt_in: boolean;
}

export interface TrackedItem {
  id: string;
  type: "token" | "nft" | "address";
  identifier: string;       // coinType, objectId, or address
  label: string;             // human-readable name
  added_at: string;
}

export interface UserState {
  wallet_address: string;
  wallet_snapshot: WalletSnapshot;
  snapshot_updated_at: string;
  interaction_patterns: InteractionPatterns;
  preferences: UserPreferences;
  tracked_items: TrackedItem[];
  created_at: string;
  updated_at: string;
}

// ══════════════════════════════════════════════════════════════════════
// DEFAULTS
// ══════════════════════════════════════════════════════════════════════

const DEFAULT_SNAPSHOT: WalletSnapshot = {
  coins: [],
  totalValue: 0,
  nftCount: 0,
  capturedAt: new Date().toISOString(),
};

const DEFAULT_PATTERNS: InteractionPatterns = {
  query_counts: {},
  tokens_researched: [],
  last_interaction: null,
  total_interactions: 0,
};

const DEFAULT_PREFERENCES: UserPreferences = {
  risk_tolerance: "moderate",
  notification_frequency: "normal",
  proactive_suggestions: true,
  tracking_opt_in: true,
};

const MAX_TRACKED_ITEMS = 10;
const MAX_TOKENS_RESEARCHED = 50; // cap the tokens_researched array

// ══════════════════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════════════════

export class UserStateService {
  private supabase = getSupabaseClient();
  private blockVision = getBlockVisionService();

  // ── State CRUD ────────────────────────────────────────────────────

  /**
   * Returns the user's state, creating a default entry if none exists.
   */
  async getOrCreateState(walletAddress: string): Promise<UserState> {
    const { data, error } = await this.supabase
      .from("user_state")
      .select("*")
      .eq("wallet_address", walletAddress)
      .single();

    if (data && !error) {
      return data as UserState;
    }

    // Create a new state entry
    const newState = {
      wallet_address: walletAddress,
      wallet_snapshot: DEFAULT_SNAPSHOT,
      interaction_patterns: DEFAULT_PATTERNS,
      preferences: DEFAULT_PREFERENCES,
      tracked_items: [],
    };

    const { data: created, error: createError } = await this.supabase
      .from("user_state")
      .insert(newState)
      .select()
      .single();

    if (createError) {
      console.error("[UserState] Failed to create state:", createError.message);
      // Return a transient in-memory default so callers don't break
      return {
        ...newState,
        snapshot_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as UserState;
    }

    return created as UserState;
  }

  // ── Wallet Snapshots ──────────────────────────────────────────────

  /**
   * Refreshes the wallet snapshot by pulling portfolio + NFT data
   * from BlockVision (with RPC fallback). Fire-and-forget safe.
   */
  async updateWalletSnapshot(walletAddress: string): Promise<WalletSnapshot> {
    try {
      const [portfolio, nfts] = await Promise.all([
        this.blockVision.getAccountPortfolio(walletAddress),
        this.blockVision.getNFTs(walletAddress, 50).catch(() => []),
      ]);

      const snapshot: WalletSnapshot = {
        coins: portfolio.coins.map((c) => ({
          coinType: c.coinType,
          symbol: c.symbol,
          balance: c.balance,
          price: c.price,
          valueUsd: c.valueUsd,
        })),
        totalValue: portfolio.totalValue,
        nftCount: nfts.length,
        capturedAt: new Date().toISOString(),
      };

      await this.supabase
        .from("user_state")
        .update({
          wallet_snapshot: snapshot,
          snapshot_updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletAddress);

      console.log(`[UserState] Snapshot updated for ${walletAddress.slice(0, 10)}...`);
      return snapshot;
    } catch (err: any) {
      console.warn(`[UserState] Snapshot update failed for ${walletAddress.slice(0, 10)}...: ${err?.message}`);
      throw err;
    }
  }

  // ── Interaction Tracking ──────────────────────────────────────────

  /**
   * Records a user interaction for pattern analysis.
   * @param type - e.g. "research", "task_create", "price_check", "portfolio_view"
   * @param details - optional metadata, e.g. { token: "SUI" }
   */
  async recordInteraction(
    walletAddress: string,
    type: string,
    details?: { token?: string }
  ): Promise<void> {
    try {
      const state = await this.getOrCreateState(walletAddress);
      const patterns = { ...state.interaction_patterns };

      // Increment query count
      patterns.query_counts[type] = (patterns.query_counts[type] || 0) + 1;
      patterns.total_interactions += 1;
      patterns.last_interaction = new Date().toISOString();

      // Track researched tokens (deduplicated, capped)
      if (details?.token && !patterns.tokens_researched.includes(details.token)) {
        patterns.tokens_researched = [
          details.token,
          ...patterns.tokens_researched,
        ].slice(0, MAX_TOKENS_RESEARCHED);
      }

      await this.supabase
        .from("user_state")
        .update({ interaction_patterns: patterns })
        .eq("wallet_address", walletAddress);
    } catch (err: any) {
      // Non-critical -- log and continue
      console.warn(`[UserState] recordInteraction failed: ${err?.message}`);
    }
  }

  // ── Preferences ───────────────────────────────────────────────────

  /**
   * Merges the given preferences with existing ones.
   * Only provided keys are updated; others remain unchanged.
   */
  async updatePreferences(
    walletAddress: string,
    prefs: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const state = await this.getOrCreateState(walletAddress);
    const merged: UserPreferences = { ...state.preferences, ...prefs };

    await this.supabase
      .from("user_state")
      .update({ preferences: merged })
      .eq("wallet_address", walletAddress);

    return merged;
  }

  async getPreferences(walletAddress: string): Promise<UserPreferences> {
    const state = await this.getOrCreateState(walletAddress);
    return state.preferences;
  }

  // ── Tracked Items ─────────────────────────────────────────────────

  async getTrackedItems(walletAddress: string): Promise<TrackedItem[]> {
    const state = await this.getOrCreateState(walletAddress);
    return state.tracked_items || [];
  }

  /**
   * Adds an item to track. Enforces a cap of 10 items per user.
   * Returns the created item or null if at capacity.
   */
  async addTrackedItem(
    walletAddress: string,
    item: Omit<TrackedItem, "id" | "added_at">
  ): Promise<TrackedItem | null> {
    const state = await this.getOrCreateState(walletAddress);
    const items = state.tracked_items || [];

    if (items.length >= MAX_TRACKED_ITEMS) {
      console.warn(`[UserState] Tracked item cap reached for ${walletAddress.slice(0, 10)}...`);
      return null;
    }

    // Dedup by identifier
    if (items.some((t) => t.identifier === item.identifier)) {
      return items.find((t) => t.identifier === item.identifier)!;
    }

    const newItem: TrackedItem = {
      id: `trk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...item,
      added_at: new Date().toISOString(),
    };

    const updated = [...items, newItem];
    await this.supabase
      .from("user_state")
      .update({ tracked_items: updated })
      .eq("wallet_address", walletAddress);

    return newItem;
  }

  async removeTrackedItem(
    walletAddress: string,
    itemId: string
  ): Promise<boolean> {
    const state = await this.getOrCreateState(walletAddress);
    const items = state.tracked_items || [];
    const filtered = items.filter((t) => t.id !== itemId);

    if (filtered.length === items.length) return false; // not found

    await this.supabase
      .from("user_state")
      .update({ tracked_items: filtered })
      .eq("wallet_address", walletAddress);

    return true;
  }

  // ── Bulk Operations (for scheduler) ───────────────────────────────

  /**
   * Returns wallet addresses of users who interacted within the last N days.
   * Used by the scheduler for batched snapshot refreshes.
   */
  async getActiveWallets(withinDays: number = 7): Promise<string[]> {
    const cutoff = new Date(
      Date.now() - withinDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await this.supabase
      .from("user_state")
      .select("wallet_address")
      .gte("updated_at", cutoff);

    if (error || !data) return [];
    return data.map((row: any) => row.wallet_address);
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: UserStateService | null = null;

export function getUserStateService(): UserStateService {
  if (!instance) instance = new UserStateService();
  return instance;
}
