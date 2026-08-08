import { describe, it, expect, vi, beforeEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// MOCK SETUP
// ══════════════════════════════════════════════════════════════════════

// Mock Supabase client
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock("../../config/supabase", () => ({
  getSupabaseClient: () => mockSupabase,
}));

// Mock BlockVision service
const mockGetAccountPortfolio = vi.fn();
const mockGetNFTs = vi.fn();

vi.mock("../blockVisionService", () => ({
  getBlockVisionService: () => ({
    getAccountPortfolio: mockGetAccountPortfolio,
    getNFTs: mockGetNFTs,
  }),
}));

import { UserStateService } from "../userStateService";

// ══════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ══════════════════════════════════════════════════════════════════════

const WALLET = "0xTestWallet123456789";

function mockSupabaseChain(returnData: any, error: any = null) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: returnData, error });
  mockFrom.mockReturnValue(chain);
  return chain;
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

describe("UserStateService", () => {
  let service: UserStateService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserStateService();
  });

  // ── getOrCreateState ────────────────────────────────────────────

  describe("getOrCreateState", () => {
    it("returns existing state when found", async () => {
      const existingState = {
        wallet_address: WALLET,
        wallet_snapshot: { coins: [], totalValue: 0, nftCount: 0, capturedAt: "2026-01-01" },
        interaction_patterns: { query_counts: {}, tokens_researched: [], last_interaction: null, total_interactions: 0 },
        preferences: { risk_tolerance: "moderate", notification_frequency: "normal", proactive_suggestions: true, tracking_opt_in: true },
        tracked_items: [],
      };

      mockSupabaseChain(existingState);
      const result = await service.getOrCreateState(WALLET);

      expect(result.wallet_address).toBe(WALLET);
      expect(result.preferences.risk_tolerance).toBe("moderate");
    });

    it("creates a new state when not found", async () => {
      // First call (select) returns nothing
      const selectChain: any = {};
      selectChain.select = vi.fn().mockReturnValue(selectChain);
      selectChain.eq = vi.fn().mockReturnValue(selectChain);
      selectChain.single = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });

      // Second call (insert) returns the created state
      const insertChain: any = {};
      insertChain.insert = vi.fn().mockReturnValue(insertChain);
      insertChain.select = vi.fn().mockReturnValue(insertChain);
      insertChain.single = vi.fn().mockResolvedValue({
        data: {
          wallet_address: WALLET,
          wallet_snapshot: {},
          interaction_patterns: { query_counts: {}, tokens_researched: [], last_interaction: null, total_interactions: 0 },
          preferences: { risk_tolerance: "moderate", notification_frequency: "normal", proactive_suggestions: true, tracking_opt_in: true },
          tracked_items: [],
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        error: null,
      });

      mockFrom
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(insertChain);

      const result = await service.getOrCreateState(WALLET);
      expect(result.wallet_address).toBe(WALLET);
      expect(result.preferences.proactive_suggestions).toBe(true);
    });
  });

  // ── recordInteraction ───────────────────────────────────────────

  describe("recordInteraction", () => {
    it("increments query counts correctly", async () => {
      const existingState = {
        wallet_address: WALLET,
        interaction_patterns: {
          query_counts: { research: 2 },
          tokens_researched: [],
          last_interaction: null,
          total_interactions: 2,
        },
        preferences: {},
        tracked_items: [],
      };

      const selectChain: any = {};
      selectChain.select = vi.fn().mockReturnValue(selectChain);
      selectChain.eq = vi.fn().mockReturnValue(selectChain);
      selectChain.single = vi.fn().mockResolvedValue({ data: existingState, error: null });

      const updateChain: any = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      mockFrom
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain);

      await service.recordInteraction(WALLET, "research", { token: "SUI" });

      // Verify update was called
      expect(updateChain.update).toHaveBeenCalled();
      const updateArg = updateChain.update.mock.calls[0][0];
      expect(updateArg.interaction_patterns.query_counts.research).toBe(3);
      expect(updateArg.interaction_patterns.total_interactions).toBe(3);
      expect(updateArg.interaction_patterns.tokens_researched).toContain("SUI");
    });

    it("deduplicates tokens_researched", async () => {
      const existingState = {
        wallet_address: WALLET,
        interaction_patterns: {
          query_counts: {},
          tokens_researched: ["SUI", "USDC"],
          last_interaction: null,
          total_interactions: 5,
        },
        preferences: {},
        tracked_items: [],
      };

      const selectChain: any = {};
      selectChain.select = vi.fn().mockReturnValue(selectChain);
      selectChain.eq = vi.fn().mockReturnValue(selectChain);
      selectChain.single = vi.fn().mockResolvedValue({ data: existingState, error: null });

      const updateChain: any = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      mockFrom
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain);

      await service.recordInteraction(WALLET, "research", { token: "SUI" });

      const updateArg = updateChain.update.mock.calls[0][0];
      // SUI should not be duplicated
      const suiCount = updateArg.interaction_patterns.tokens_researched.filter(
        (t: string) => t === "SUI"
      ).length;
      expect(suiCount).toBe(1);
    });
  });

  // ── updatePreferences ─────────────────────────────────────────

  describe("updatePreferences", () => {
    it("merges new preferences without overwriting existing ones", async () => {
      const existingState = {
        wallet_address: WALLET,
        interaction_patterns: { query_counts: {}, tokens_researched: [], last_interaction: null, total_interactions: 0 },
        preferences: {
          risk_tolerance: "moderate",
          notification_frequency: "normal",
          proactive_suggestions: true,
          tracking_opt_in: true,
        },
        tracked_items: [],
      };

      const selectChain: any = {};
      selectChain.select = vi.fn().mockReturnValue(selectChain);
      selectChain.eq = vi.fn().mockReturnValue(selectChain);
      selectChain.single = vi.fn().mockResolvedValue({ data: existingState, error: null });

      const updateChain: any = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      mockFrom
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.updatePreferences(WALLET, {
        risk_tolerance: "conservative",
      });

      expect(result.risk_tolerance).toBe("conservative");
      expect(result.notification_frequency).toBe("normal"); // unchanged
      expect(result.proactive_suggestions).toBe(true); // unchanged
    });
  });

  // ── Tracked Items ─────────────────────────────────────────────

  describe("Tracked Items", () => {
    it("enforces 10-item cap", async () => {
      const tenItems = Array.from({ length: 10 }, (_, i) => ({
        id: `trk_${i}`,
        type: "token" as const,
        identifier: `0x${i}`,
        label: `Token ${i}`,
        added_at: "2026-01-01",
      }));

      const existingState = {
        wallet_address: WALLET,
        interaction_patterns: { query_counts: {}, tokens_researched: [], last_interaction: null, total_interactions: 0 },
        preferences: {},
        tracked_items: tenItems,
      };

      mockSupabaseChain(existingState);

      const result = await service.addTrackedItem(WALLET, {
        type: "token",
        identifier: "0xNew",
        label: "New Token",
      });

      expect(result).toBeNull();
    });

    it("deduplicates by identifier", async () => {
      const existingItems = [
        { id: "trk_1", type: "token", identifier: "0xABC", label: "Token ABC", added_at: "2026-01-01" },
      ];

      const existingState = {
        wallet_address: WALLET,
        interaction_patterns: { query_counts: {}, tokens_researched: [], last_interaction: null, total_interactions: 0 },
        preferences: {},
        tracked_items: existingItems,
      };

      mockSupabaseChain(existingState);

      const result = await service.addTrackedItem(WALLET, {
        type: "token",
        identifier: "0xABC",
        label: "Different Label",
      });

      // Should return existing item, not create a new one
      expect(result).not.toBeNull();
      expect(result!.id).toBe("trk_1");
    });
  });
});
