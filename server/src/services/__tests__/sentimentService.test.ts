import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tavily ─────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@langchain/tavily", () => ({
  TavilySearch: class {
    constructor() { }
    invoke = mockInvoke;
  },
}));

// ── Import after mocks ──────────────────────────────────────────────

import { SentimentService } from "../sentimentService";

// ── Tests ───────────────────────────────────────────────────────────

describe("SentimentService", () => {
  let service: SentimentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SentimentService();
  });

  // ── analyzeSentiment ──────────────────────────────────────────

  it("skips sentiment for stablecoins", async () => {
    const result = await service.analyzeSentiment("USDC");
    expect(result.label).toBe("neutral");
    expect(result.summary).toContain("stablecoin");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("detects positive sentiment from keywords", async () => {
    mockInvoke.mockResolvedValue(
      "CETUS token shows bullish momentum with a major partnership announced. " +
      "Growth in TVL and new listing on major DEX. Source: https://example.com/article"
    );

    const result = await service.analyzeSentiment("CETUS");
    expect(result.label).toBe("positive");
    expect(result.score).toBeGreaterThan(0);
    expect(result.keySignals).toContain("+bullish");
    expect(result.keySignals).toContain("+partnership");
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it("detects negative sentiment from keywords", async () => {
    mockInvoke.mockResolvedValue(
      "Warning: SCAMCOIN exploit detected, users report a possible rugpull. " +
      "Token is under investigation for fraud. Dump ongoing. https://news.example.com"
    );

    const result = await service.analyzeSentiment("SCAMCOIN");
    expect(result.label).toBe("negative");
    expect(result.score).toBeLessThan(0);
    expect(result.keySignals).toContain("-exploit");
    expect(result.keySignals).toContain("-dump");
  });

  it("returns neutral for mixed signals", async () => {
    mockInvoke.mockResolvedValue(
      "TOKEN shows growth potential but some bearish signals remain."
    );

    const result = await service.analyzeSentiment("TOKEN");
    expect(result.label).toBe("neutral");
    expect(result.keySignals).toContain("+growth");
    expect(result.keySignals).toContain("-bearish");
  });

  it("returns neutral when no keywords match", async () => {
    mockInvoke.mockResolvedValue(
      "The project has been around since 2023. It operates on Sui blockchain."
    );

    const result = await service.analyzeSentiment("UNKNOWN");
    expect(result.label).toBe("neutral");
    expect(result.score).toBe(0);
    expect(result.keySignals).toHaveLength(0);
  });

  it("handles Tavily failure gracefully", async () => {
    mockInvoke.mockRejectedValue(new Error("Tavily API error"));

    const result = await service.analyzeSentiment("FAIL");
    expect(result.label).toBe("neutral");
    expect(result.score).toBe(0);
    expect(result.summary).toContain("No recent sentiment data");
  });

  // ── formatForReport ───────────────────────────────────────────

  it("formats positive sentiment for the report", () => {
    const result = service.formatForReport({
      score: 0.6,
      label: "positive",
      summary: "Recent sentiment for CETUS is positive.",
      sources: ["https://example.com/1"],
      keySignals: ["+bullish", "+partnership"],
    });

    expect(result).toContain("Market Sentiment");
    expect(result).toContain("positive");
    expect(result).toContain("Sources:");
  });

  it("returns empty string when no data", () => {
    const result = service.formatForReport({
      score: 0,
      label: "neutral",
      summary: "No data",
      sources: [],
      keySignals: [],
    });
    expect(result).toBe("");
  });
});
