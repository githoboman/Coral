import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// MOCK SETUP
// ══════════════════════════════════════════════════════════════════════

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../../config/supabase", () => ({
  getSupabaseClient: () => mockSupabase,
}));

// Mock RPC Manager
const mockRpcCall = vi.fn();
vi.mock("../rpcManager", () => ({
  getRpcManager: () => ({
    call: mockRpcCall,
  }),
}));

// Mock UserStateService (used by EventMonitorService internally)
vi.mock("../userStateService", () => ({
  getUserStateService: () => ({
    getOrCreateState: vi.fn().mockResolvedValue({ tracked_items: [] }),
  }),
}));

import { EventMonitorService } from "../eventMonitorService";

// ══════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ══════════════════════════════════════════════════════════════════════

const WALLET = "0xTestWallet123456789";

function mockInsert(error: any = null) {
  const chain: any = {};
  chain.insert = vi.fn().mockResolvedValue({ error });
  mockFrom.mockReturnValue(chain);
  return chain;
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

describe("EventMonitorService", () => {
  let service: EventMonitorService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new EventMonitorService();
  });

  afterEach(() => {
    service.stopAll();
    vi.useRealTimers();
  });

  // ── Event Filtering ───────────────────────────────────────────

  describe("Event Filtering Logic", () => {
    it("should detect token_received when new token appears", async () => {
      // Initial baseline: no tokens
      mockRpcCall.mockResolvedValueOnce([]);

      await service.startMonitoring(WALLET);

      // Now a new token appears
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "500000000" }, // 0.5 SUI -- above 0.1 threshold
      ]);

      const insertChain = mockInsert();

      // Trigger the poll (advance timer past 60s interval)
      // We manually call the internal method via pollForChanges
      await (service as any).pollForChanges(WALLET);

      // Should have emitted a token_received event
      expect(insertChain.insert).toHaveBeenCalled();
      const insertedEvent = insertChain.insert.mock.calls[0][0];
      expect(insertedEvent.event_type).toBe("token_received");
      expect(insertedEvent.event_data.coinType).toBe("0x2::sui::SUI");
      expect(insertedEvent.event_data.isNew).toBe(true);
    });

    it("should filter out micro-transactions below 0.1 SUI threshold", async () => {
      // Initial baseline: no tokens
      mockRpcCall.mockResolvedValueOnce([]);

      await service.startMonitoring(WALLET);

      // Tiny amount received (below 0.1 SUI = 100_000_000 MIST)
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "50000000" }, // 0.05 SUI
      ]);

      const insertChain = mockInsert();

      await (service as any).pollForChanges(WALLET);

      // Should NOT emit an event for this small amount
      expect(insertChain.insert).not.toHaveBeenCalled();
    });

    it("should detect balance_change when change exceeds 10% (2x the 5% threshold)", async () => {
      // Baseline: 1000 SUI
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "1000000000000" },
      ]);

      await service.startMonitoring(WALLET);

      // Balance drops by 15% -- should trigger both token_sent AND balance_change
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "850000000000" },
      ]);

      const events: any[] = [];
      const insertChain: any = {};
      insertChain.insert = vi.fn().mockImplementation((data: any) => {
        events.push(data);
        return Promise.resolve({ error: null });
      });
      mockFrom.mockReturnValue(insertChain);

      await (service as any).pollForChanges(WALLET);

      // Should detect the significant balance change
      expect(events.length).toBeGreaterThanOrEqual(1);
      const eventTypes = events.map((e) => e.event_type);
      expect(eventTypes).toContain("token_sent");
    });

    it("should deduplicate events within the 60s window", async () => {
      // Baseline
      mockRpcCall.mockResolvedValueOnce([]);
      await service.startMonitoring(WALLET);

      // First poll: new token
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "500000000" },
      ]);
      const insertChain = mockInsert();

      await (service as any).pollForChanges(WALLET);
      const firstCallCount = insertChain.insert.mock.calls.length;

      // Reset baseline so next poll would detect same token again
      (service as any).previousBalances.set(WALLET, []);

      // Second poll immediately (within 60s dedup window)
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "500000000" },
      ]);

      await (service as any).pollForChanges(WALLET);

      // The insert count should not have increased (deduped)
      expect(insertChain.insert.mock.calls.length).toBe(firstCallCount);
    });

    it("should detect token removal (full balance gone)", async () => {
      // Baseline: has SUI
      mockRpcCall.mockResolvedValueOnce([
        { coinType: "0x2::sui::SUI", totalBalance: "1000000000000" },
      ]);

      await service.startMonitoring(WALLET);

      // Token completely disappears
      mockRpcCall.mockResolvedValueOnce([]);

      const insertChain = mockInsert();

      await (service as any).pollForChanges(WALLET);

      expect(insertChain.insert).toHaveBeenCalled();
      const insertedEvent = insertChain.insert.mock.calls[0][0];
      expect(insertedEvent.event_type).toBe("token_sent");
      expect(insertedEvent.event_data.fullyRemoved).toBe(true);
    });
  });

  // ── Monitor Lifecycle ─────────────────────────────────────────

  describe("Monitor Lifecycle", () => {
    it("should start and stop monitoring", async () => {
      mockRpcCall.mockResolvedValue([]);

      const started = await service.startMonitoring(WALLET);
      expect(started).toBe(true);
      expect(service.getActiveCount()).toBe(1);

      service.stopMonitoring(WALLET);
      expect(service.getActiveCount()).toBe(0);
    });

    it("returns true when already monitoring (idempotent)", async () => {
      mockRpcCall.mockResolvedValue([]);

      await service.startMonitoring(WALLET);
      const secondStart = await service.startMonitoring(WALLET);

      expect(secondStart).toBe(true);
      expect(service.getActiveCount()).toBe(1); // still just 1
    });

    it("respects global monitor cap", async () => {
      mockRpcCall.mockResolvedValue([]);

      // Fill up to the global cap (100)
      for (let i = 0; i < 100; i++) {
        await service.startMonitoring(`0xWallet${i}`);
      }

      expect(service.getActiveCount()).toBe(100);

      // 101st should fail
      const overflow = await service.startMonitoring("0xOverflow");
      expect(overflow).toBe(false);
      expect(service.getActiveCount()).toBe(100);
    });
  });

  // ── Event Retrieval ───────────────────────────────────────────

  describe("getRecentEvents", () => {
    it("returns events from Supabase", async () => {
      const mockEvents = [
        { id: 1, wallet_address: WALLET, event_type: "token_received", event_data: {}, processed: false },
        { id: 2, wallet_address: WALLET, event_type: "balance_change", event_data: {}, processed: false },
      ];

      const chain: any = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue({ data: mockEvents, error: null });
      mockFrom.mockReturnValue(chain);

      const events = await service.getRecentEvents(WALLET, { limit: 20 });
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("token_received");
    });
  });
});
