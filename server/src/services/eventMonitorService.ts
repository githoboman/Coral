import { getSupabaseClient } from "../config/supabase";
import { getRpcManager } from "./rpcManager";
import { getUserStateService, type TrackedItem } from "./userStateService";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type EventType =
  | "token_received"
  | "balance_change"
  | "nft_transfer"
  | "staking_reward"
  | "token_sent"
  | "other";

export interface WalletEvent {
  id?: number;
  wallet_address: string;
  event_type: EventType;
  event_data: Record<string, any>;
  processed: boolean;
  created_at?: string;
}

interface BalanceRecord {
  coinType: string;
  balance: string;
}

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════

// Minimum SUI value (in MIST) to consider an event meaningful
// 0.1 SUI = 100_000_000 MIST
const MIN_SUI_THRESHOLD = 100_000_000;

// Balance change percentage threshold to trigger an event
const BALANCE_CHANGE_THRESHOLD_PCT = 5;

// Dedup window: ignore identical events within this window (ms)
const DEDUP_WINDOW_MS = 60_000;

// Polling interval for fallback mode (ms)
const POLL_INTERVAL_MS = 60_000;

// Max concurrent wallet monitors (global cap)
const MAX_GLOBAL_MONITORS = 100;

// ══════════════════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════════════════

export class EventMonitorService {
  private supabase = getSupabaseClient();
  private rpc = getRpcManager();
  private userState = getUserStateService();

  // Stores previous balances for change detection
  private previousBalances = new Map<string, BalanceRecord[]>();

  // Active polling intervals per wallet
  private pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // Recent event dedup cache: "wallet:type:key" -> timestamp
  private recentEvents = new Map<string, number>();

  // ── Monitor Lifecycle ─────────────────────────────────────────────

  /**
   * Starts monitoring events for a wallet address.
   * Uses periodic polling against the RPC layer (free-tier friendly).
   * WebSocket upgrade path can be added later for real-time.
   */
  async startMonitoring(walletAddress: string): Promise<boolean> {
    if (this.pollingIntervals.has(walletAddress)) {
      return true; // Already monitoring
    }

    if (this.pollingIntervals.size >= MAX_GLOBAL_MONITORS) {
      console.warn(
        `[EventMonitor] Global monitor cap (${MAX_GLOBAL_MONITORS}) reached, cannot monitor ${walletAddress.slice(0, 10)}...`
      );
      return false;
    }

    // Capture initial state
    await this.captureBaseline(walletAddress);

    // Start polling
    const interval = setInterval(async () => {
      try {
        await this.pollForChanges(walletAddress);
      } catch (err: any) {
        console.warn(
          `[EventMonitor] Poll error for ${walletAddress.slice(0, 10)}...: ${err?.message}`
        );
      }
    }, POLL_INTERVAL_MS);

    this.pollingIntervals.set(walletAddress, interval);
    console.log(
      `[EventMonitor] Started monitoring ${walletAddress.slice(0, 10)}... (${this.pollingIntervals.size} active)`
    );
    return true;
  }

  /**
   * Stops monitoring a wallet address.
   */
  stopMonitoring(walletAddress: string): void {
    const interval = this.pollingIntervals.get(walletAddress);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(walletAddress);
      this.previousBalances.delete(walletAddress);
      console.log(`[EventMonitor] Stopped monitoring ${walletAddress.slice(0, 10)}...`);
    }
  }

  /**
   * Stops all monitors (for graceful shutdown).
   */
  stopAll(): void {
    for (const [addr] of this.pollingIntervals) {
      this.stopMonitoring(addr);
    }
  }

  getActiveCount(): number {
    return this.pollingIntervals.size;
  }

  // ── Baseline Capture ──────────────────────────────────────────────

  private async captureBaseline(walletAddress: string): Promise<void> {
    try {
      const balances = await this.fetchBalances(walletAddress);
      this.previousBalances.set(walletAddress, balances);
    } catch (err: any) {
      console.warn(
        `[EventMonitor] Baseline capture failed: ${err?.message}`
      );
      this.previousBalances.set(walletAddress, []);
    }
  }

  // ── Polling ───────────────────────────────────────────────────────

  private async pollForChanges(walletAddress: string): Promise<void> {
    const currentBalances = await this.fetchBalances(walletAddress);
    const previous = this.previousBalances.get(walletAddress) || [];

    const prevMap = new Map(previous.map((b) => [b.coinType, b.balance]));
    const currMap = new Map(currentBalances.map((b) => [b.coinType, b.balance]));

    // Detect new tokens received
    for (const [coinType, balance] of currMap) {
      const prevBalance = prevMap.get(coinType);
      const balNum = BigInt(balance);

      if (!prevBalance) {
        // New token appeared
        if (balNum >= BigInt(MIN_SUI_THRESHOLD) || !this.isSuiType(coinType)) {
          await this.emitEvent(walletAddress, "token_received", {
            coinType,
            balance: balance,
            isNew: true,
          });
        }
      } else {
        // Balance changed
        const prevNum = BigInt(prevBalance);
        if (prevNum === 0n) continue;

        const diff = balNum - prevNum;
        const absDiff = diff < 0n ? -diff : diff;
        const pctChange = Number((absDiff * 100n) / prevNum);

        if (pctChange >= BALANCE_CHANGE_THRESHOLD_PCT) {
          if (diff > 0n && absDiff >= BigInt(MIN_SUI_THRESHOLD)) {
            await this.emitEvent(walletAddress, "token_received", {
              coinType,
              previousBalance: prevBalance,
              newBalance: balance,
              changePercent: pctChange,
            });
          } else if (diff < 0n) {
            await this.emitEvent(walletAddress, "token_sent", {
              coinType,
              previousBalance: prevBalance,
              newBalance: balance,
              changePercent: pctChange,
            });
          }

          // Also emit generic balance_change for significant moves
          if (pctChange >= BALANCE_CHANGE_THRESHOLD_PCT * 2) {
            await this.emitEvent(walletAddress, "balance_change", {
              coinType,
              previousBalance: prevBalance,
              newBalance: balance,
              changePercent: pctChange,
              direction: diff > 0n ? "increase" : "decrease",
            });
          }
        }
      }
    }

    // Detect tokens removed (all balance gone)
    for (const [coinType] of prevMap) {
      if (!currMap.has(coinType)) {
        await this.emitEvent(walletAddress, "token_sent", {
          coinType,
          previousBalance: prevMap.get(coinType),
          newBalance: "0",
          fullyRemoved: true,
        });
      }
    }

    // Update baseline
    this.previousBalances.set(walletAddress, currentBalances);
  }

  // ── RPC helpers ───────────────────────────────────────────────────

  private async fetchBalances(walletAddress: string): Promise<BalanceRecord[]> {
    const result = await this.rpc.call<any[]>(
      "suix_getAllBalances",
      [walletAddress]
    );

    return (result || []).map((b: any) => ({
      coinType: b.coinType,
      balance: b.totalBalance,
    }));
  }

  private isSuiType(coinType: string): boolean {
    return coinType === "0x2::sui::SUI";
  }

  // ── Event Emission ────────────────────────────────────────────────

  private async emitEvent(
    walletAddress: string,
    eventType: EventType,
    eventData: Record<string, any>
  ): Promise<void> {
    // Dedup check
    const dedupKey = `${walletAddress}:${eventType}:${eventData.coinType || ""}`;
    const lastSeen = this.recentEvents.get(dedupKey);
    const now = Date.now();

    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      return; // Skip duplicate
    }
    this.recentEvents.set(dedupKey, now);

    // Clean old dedup entries periodically
    if (this.recentEvents.size > 1000) {
      for (const [key, ts] of this.recentEvents) {
        if (now - ts > DEDUP_WINDOW_MS * 5) {
          this.recentEvents.delete(key);
        }
      }
    }

    // Persist to database
    const event: Omit<WalletEvent, "id" | "created_at"> = {
      wallet_address: walletAddress,
      event_type: eventType,
      event_data: eventData,
      processed: false,
    };

    const { error } = await this.supabase
      .from("wallet_events")
      .insert(event);

    if (error) {
      console.error(`[EventMonitor] Failed to store event:`, error.message);
      return;
    }

    console.log(
      `[EventMonitor] Event: ${eventType} for ${walletAddress.slice(0, 10)}... | ${JSON.stringify(eventData).slice(0, 100)}`
    );
  }

  // ── Event Retrieval ───────────────────────────────────────────────

  /**
   * Returns recent events for a wallet, optionally filtered by type.
   */
  async getRecentEvents(
    walletAddress: string,
    options?: {
      limit?: number;
      type?: EventType;
      unprocessedOnly?: boolean;
    }
  ): Promise<WalletEvent[]> {
    let query = this.supabase
      .from("wallet_events")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(options?.limit || 20);

    if (options?.type) {
      query = query.eq("event_type", options.type);
    }
    if (options?.unprocessedOnly) {
      query = query.eq("processed", false);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[EventMonitor] Failed to fetch events:`, error.message);
      return [];
    }

    return (data || []) as WalletEvent[];
  }

  /**
   * Marks events as processed (used by Phase 2 suggestion engine).
   */
  async markEventsProcessed(eventIds: number[]): Promise<void> {
    if (eventIds.length === 0) return;

    await this.supabase
      .from("wallet_events")
      .update({ processed: true })
      .in("id", eventIds);
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: EventMonitorService | null = null;

export function getEventMonitorService(): EventMonitorService {
  if (!instance) instance = new EventMonitorService();
  return instance;
}
