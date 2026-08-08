import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ──────────────────────────────────────────────────────

// Mock Supabase
vi.mock("../../config/supabase", () => ({
  getSupabaseClient: () => ({ from: vi.fn() }),
}));

// Mock event monitor
const mockGetRecentEvents = vi.fn();
const mockMarkEventsProcessed = vi.fn();
vi.mock("../eventMonitorService", () => ({
  getEventMonitorService: () => ({
    getRecentEvents: mockGetRecentEvents,
    markEventsProcessed: mockMarkEventsProcessed,
  }),
}));

// Mock user state
const mockGetOrCreateState = vi.fn();
vi.mock("../userStateService", () => ({
  getUserStateService: () => ({
    getOrCreateState: mockGetOrCreateState,
    getPreferences: vi.fn().mockResolvedValue({
      proactive_suggestions: true,
      notification_frequency: "normal",
    }),
  }),
}));

// Mock throttler
const mockCanSuggest = vi.fn();
const mockRecordSuggestion = vi.fn();
const mockGetById = vi.fn();
const mockRespondToSuggestion = vi.fn();
vi.mock("../suggestionThrottler", () => ({
  getSuggestionThrottler: () => ({
    canSuggest: mockCanSuggest,
    recordSuggestion: mockRecordSuggestion,
    getById: mockGetById,
    respondToSuggestion: mockRespondToSuggestion,
  }),
}));

// Mock notification service
const mockSendSuggestionNotification = vi.fn();
vi.mock("../notificationService", () => ({
  getNotificationService: () => ({
    sendSuggestionNotification: mockSendSuggestionNotification,
  }),
}));

// Mock task storage
const mockCreateTask = vi.fn();
vi.mock("../taskStorageService", () => ({
  getTaskStorageService: () => ({
    createTask: mockCreateTask,
  }),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { SuggestionEngine } from "../suggestionEngine";

// ── Tests ───────────────────────────────────────────────────────────

describe("SuggestionEngine", () => {
  let engine: SuggestionEngine;

  const defaultState = {
    wallet_address: "0xWallet",
    preferences: {
      risk_tolerance: "moderate",
      proactive_suggestions: true,
    },
    wallet_snapshot: {
      coins: [],
      nfts: [],
      capturedAt: new Date().toISOString(),
    },
    interaction_patterns: {
      query_counts: {},
      total_interactions: 0,
      tokens_researched: [],
    },
    tracked_items: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SuggestionEngine();
    mockGetOrCreateState.mockResolvedValue(defaultState);
    mockCanSuggest.mockResolvedValue({ allowed: true });
    mockRecordSuggestion.mockResolvedValue(1);
    mockSendSuggestionNotification.mockResolvedValue(true);
  });

  // ── Event-Triggered Suggestions ─────────────────────────────────

  it("should generate suggestion for new token received (isNew)", async () => {
    mockGetRecentEvents.mockResolvedValue([
      {
        id: 10,
        wallet_address: "0xWallet",
        event_type: "token_received",
        event_data: { coinType: "0xabc::module::TOKEN", isNew: true },
        processed: false,
      },
    ]);

    const count = await engine.processEventSuggestions("0xWallet");

    expect(count).toBe(1);
    expect(mockRecordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_type: "research_new_token",
        wallet_address: "0xWallet",
      })
    );
    expect(mockMarkEventsProcessed).toHaveBeenCalledWith([10]);
  });

  it("should generate portfolio_review for large balance_change", async () => {
    mockGetRecentEvents.mockResolvedValue([
      {
        id: 20,
        wallet_address: "0xWallet",
        event_type: "balance_change",
        event_data: {
          coinType: "0x2::sui::SUI",
          changePercent: 15,
          direction: "decrease",
        },
        processed: false,
      },
    ]);

    const count = await engine.processEventSuggestions("0xWallet");

    expect(count).toBe(1);
    expect(mockRecordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_type: "portfolio_review",
      })
    );
  });

  it("should generate price_alert for fully removed token", async () => {
    mockGetRecentEvents.mockResolvedValue([
      {
        id: 30,
        wallet_address: "0xWallet",
        event_type: "token_sent",
        event_data: {
          coinType: "0xdef::module::COIN",
          fullyRemoved: true,
        },
        processed: false,
      },
    ]);

    const count = await engine.processEventSuggestions("0xWallet");

    expect(count).toBe(1);
    expect(mockRecordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_type: "price_alert",
      })
    );
  });

  it("should skip suggestions when throttled", async () => {
    mockCanSuggest.mockResolvedValue({ allowed: false, reason: "daily_cap_3" });
    mockGetRecentEvents.mockResolvedValue([
      {
        id: 40,
        wallet_address: "0xWallet",
        event_type: "token_received",
        event_data: { coinType: "0xabc::module::TOKEN", isNew: true },
        processed: false,
      },
    ]);

    const count = await engine.processEventSuggestions("0xWallet");

    expect(count).toBe(0);
    expect(mockRecordSuggestion).not.toHaveBeenCalled();
    // Events should still be marked processed
    expect(mockMarkEventsProcessed).toHaveBeenCalled();
  });

  it("should return 0 when no unprocessed events exist", async () => {
    mockGetRecentEvents.mockResolvedValue([]);

    const count = await engine.processEventSuggestions("0xWallet");
    expect(count).toBe(0);
    expect(mockRecordSuggestion).not.toHaveBeenCalled();
  });

  // ── Post-Research Suggestions ─────────────────────────────────

  it("should generate research_followup when query mentions a token", async () => {
    await engine.onResearchComplete("0xWallet", "What is SUI staking?", "SUI staking info...");

    expect(mockRecordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_type: "research_followup",
      })
    );
  });

  it("should not generate suggestion when query has no token mention", async () => {
    await engine.onResearchComplete("0xWallet", "how does blockchain work?", "Blockchain info...");

    expect(mockRecordSuggestion).not.toHaveBeenCalled();
  });

  // ── Suggestion Acceptance ──────────────────────────────────────

  it("should create task when accepting a suggestion with taskTemplate", async () => {
    mockGetById.mockResolvedValue({
      id: 100,
      wallet_address: "0xWallet",
      status: "pending",
      suggestion_type: "stake_idle",
      suggestion_data: {
        taskTemplate: {
          task_name: "Stake idle SUI",
          description: "Review staking options",
          priority: "low",
          tags: ["staking"],
        },
      },
    });
    mockRespondToSuggestion.mockResolvedValue(true);
    mockCreateTask.mockResolvedValue({ taskId: "t1", registryBlobId: "supabase-managed" });

    const result = await engine.acceptSuggestion(100);

    expect(result).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledWith(
      "0xWallet",
      expect.objectContaining({
        task_name: "Stake idle SUI",
        priority: "low",
      })
    );
    expect(mockRespondToSuggestion).toHaveBeenCalledWith(100, "accepted");
  });

  it("should return false when accepting an already-responded suggestion", async () => {
    mockGetById.mockResolvedValue({
      id: 200,
      status: "dismissed",
    });

    const result = await engine.acceptSuggestion(200);
    expect(result).toBe(false);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  // ── Dismissal ──────────────────────────────────────────────────

  it("should dismiss a suggestion via throttler", async () => {
    mockRespondToSuggestion.mockResolvedValue(true);

    const result = await engine.dismissSuggestion(300);

    expect(result).toBe(true);
    expect(mockRespondToSuggestion).toHaveBeenCalledWith(300, "dismissed");
  });
});
