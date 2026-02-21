import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ──────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockIn = vi.fn();

const chain = {
  select: mockSelect,
  eq: mockEq,
  gte: mockGte,
  order: mockOrder,
  limit: mockLimit,
  insert: mockInsert,
  update: mockUpdate,
  single: mockSingle,
  in: mockIn,
};

// Each mock returns the chain for chaining
for (const fn of Object.values(chain)) {
  (fn as any).mockReturnValue(chain);
}

const mockFrom = vi.fn().mockReturnValue(chain);

vi.mock("../../config/supabase", () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

const mockGetPreferences = vi.fn();
vi.mock("../userStateService", () => ({
  getUserStateService: () => ({
    getPreferences: mockGetPreferences,
  }),
}));

import { SuggestionThrottler } from "../suggestionThrottler";

// ── Tests ───────────────────────────────────────────────────────────

describe("SuggestionThrottler", () => {
  let throttler: SuggestionThrottler;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain returns
    for (const fn of Object.values(chain)) {
      (fn as any).mockReturnValue(chain);
    }
    mockFrom.mockReturnValue(chain);
    throttler = new SuggestionThrottler();
    mockGetPreferences.mockResolvedValue({
      risk_tolerance: "moderate",
      notification_frequency: "normal",
      proactive_suggestions: true,
      tracking_opt_in: true,
    });
  });

  // ── canSuggest ──────────────────────────────────────────────────

  it("blocks when proactive_suggestions is disabled", async () => {
    mockGetPreferences.mockResolvedValue({
      proactive_suggestions: false,
      notification_frequency: "normal",
    });

    const result = await throttler.canSuggest("0xWallet", "stake_idle");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("proactive_disabled");
  });

  // ── recordSuggestion ──────────────────────────────────────────

  it("records a suggestion and returns its ID", async () => {
    mockSingle.mockResolvedValue({ data: { id: 42 }, error: null });

    const id = await throttler.recordSuggestion({
      wallet_address: "0xWallet",
      suggestion_type: "stake_idle",
      suggestion_text: "Stake your SUI",
      suggestion_data: {},
      status: "pending",
      delivered_via: "telegram",
    });

    expect(id).toBe(42);
    expect(mockFrom).toHaveBeenCalledWith("suggestion_history");
    expect(mockInsert).toHaveBeenCalled();
  });

  it("returns null on DB error when recording", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "DB error" } });

    const id = await throttler.recordSuggestion({
      wallet_address: "0xWallet",
      suggestion_type: "stake_idle",
      suggestion_text: "test",
      suggestion_data: {},
      status: "pending",
      delivered_via: "telegram",
    });

    expect(id).toBeNull();
  });

  // ── respondToSuggestion ───────────────────────────────────────

  it("updates suggestion status to accepted", async () => {
    mockEq.mockResolvedValueOnce({ error: null });

    const result = await throttler.respondToSuggestion(42, "accepted");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" })
    );
  });

  it("updates suggestion status to dismissed", async () => {
    mockEq.mockResolvedValueOnce({ error: null });

    const result = await throttler.respondToSuggestion(99, "dismissed");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dismissed" })
    );
  });

  // ── getRecent ─────────────────────────────────────────────────

  it("returns recent suggestions for a wallet", async () => {
    const suggestions = [
      { id: 1, suggestion_type: "stake_idle", status: "pending" },
      { id: 2, suggestion_type: "price_alert", status: "dismissed" },
    ];
    mockLimit.mockResolvedValueOnce({ data: suggestions, error: null });

    const result = await throttler.getRecent("0xWallet", 10);
    expect(result).toHaveLength(2);
    expect(result[0].suggestion_type).toBe("stake_idle");
  });

  it("returns empty array on error", async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: { message: "fail" } });

    const result = await throttler.getRecent("0xWallet");
    expect(result).toEqual([]);
  });

  // ── getById ───────────────────────────────────────────────────

  it("returns a single suggestion by ID", async () => {
    mockSingle.mockResolvedValue({
      data: { id: 42, suggestion_type: "stake_idle", status: "pending" },
      error: null,
    });

    const result = await throttler.getById(42);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(42);
  });
});
