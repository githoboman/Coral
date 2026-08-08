import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock BlockVision ────────────────────────────────────────────────

const mockGetTokenHolders = vi.fn();
vi.mock("../blockVisionService", () => ({
  getBlockVisionService: () => ({
    getTokenHolders: mockGetTokenHolders,
  }),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { RedFlagService } from "../redFlagService";

// ── Tests ───────────────────────────────────────────────────────────

describe("RedFlagService", () => {
  let service: RedFlagService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RedFlagService();
  });

  // ── analyzeToken ──────────────────────────────────────────────

  it("skips analysis for well-known safe tokens", async () => {
    const flags = await service.analyzeToken("0x2::sui::SUI", "SUI");
    expect(flags).toHaveLength(0);
    expect(mockGetTokenHolders).not.toHaveBeenCalled();
  });

  it("flags low holder count", async () => {
    mockGetTokenHolders.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        address: `0x${i}`,
        balance: "1000",
        percentage: 10,
      }))
    );

    const flags = await service.analyzeToken("0xabc::module::SCAM", "SCAM");
    const lowHolder = flags.find((f) => f.type === "low_holders");
    expect(lowHolder).toBeDefined();
    expect(lowHolder!.severity).toBe("medium");
  });

  it("flags high concentration (top 5 > 80%)", async () => {
    mockGetTokenHolders.mockResolvedValue([
      { address: "0x1", balance: "500000", percentage: 25 },
      { address: "0x2", balance: "400000", percentage: 20 },
      { address: "0x3", balance: "300000", percentage: 15 },
      { address: "0x4", balance: "200000", percentage: 12 },
      { address: "0x5", balance: "150000", percentage: 10 },
      // top 5 = 82%
      ...Array.from({ length: 45 }, (_, i) => ({
        address: `0x${i + 6}`,
        balance: "1000",
        percentage: 0.36,
      })),
    ]);

    const flags = await service.analyzeToken("0xabc::m::TOKEN", "TOKEN");
    const concentration = flags.find((f) => f.type === "high_concentration");
    expect(concentration).toBeDefined();
    expect(concentration!.severity).toBe("high");
  });

  it("flags single whale dominance (>40%)", async () => {
    mockGetTokenHolders.mockResolvedValue([
      { address: "0xWhale", balance: "9999999", percentage: 55 },
      ...Array.from({ length: 49 }, (_, i) => ({
        address: `0x${i + 1}`,
        balance: "1000",
        percentage: 0.9,
      })),
    ]);

    const flags = await service.analyzeToken("0xabc::m::RUG", "RUG");
    const whale = flags.find((f) => f.type === "whale_dominance");
    expect(whale).toBeDefined();
    expect(whale!.severity).toBe("high");
  });

  it("returns empty flags for a healthy token", async () => {
    mockGetTokenHolders.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        address: `0x${i}`,
        balance: "1000",
        percentage: 1,
      }))
    );

    const flags = await service.analyzeToken("0xabc::m::GOOD", "GOOD");
    expect(flags).toHaveLength(0);
  });

  it("handles BlockVision failure gracefully", async () => {
    mockGetTokenHolders.mockRejectedValue(new Error("API down"));

    const flags = await service.analyzeToken("0xabc::m::FAIL", "FAIL");
    expect(flags).toHaveLength(0); // graceful degradation
  });

  // ── generateWarnings ──────────────────────────────────────────

  it("generates warnings with appropriate severity markers", () => {
    const flags = [
      { severity: "high" as const, type: "whale_dominance", message: "A single wallet holds 55% of supply." },
      { severity: "medium" as const, type: "low_holders", message: "Only 10 holders found." },
    ];

    const result = service.generateWarnings(flags, "moderate");
    expect(result).toContain("[!]"); // high severity
    expect(result).toContain("[i]"); // medium severity
    expect(result).toContain("Risk Warnings");
  });

  it("adds conservative user caution note for high-severity flags", () => {
    const flags = [
      { severity: "high" as const, type: "whale_dominance", message: "Whale risk." },
    ];

    const result = service.generateWarnings(flags, "conservative");
    expect(result).toContain("conservative risk profile");
    expect(result).toContain("extra caution");
  });

  it("returns empty string for no flags", () => {
    const result = service.generateWarnings([], "moderate");
    expect(result).toBe("");
  });
});
