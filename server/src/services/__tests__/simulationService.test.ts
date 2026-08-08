// server/src/services/__tests__/simulationService.test.ts
// Unit tests for Phase 4: SimulationService

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock SuiClient
const mockDryRun = vi.fn();
const mockGetCoins = vi.fn();
const mockGetBalance = vi.fn();
const mockBuild = vi.fn();

vi.mock("@mysten/sui/client", () => {
  class MockSuiClient {
    dryRunTransactionBlock = mockDryRun;
    getCoins = mockGetCoins;
    getBalance = mockGetBalance;
  }
  return { SuiClient: MockSuiClient };
});

vi.mock("@mysten/sui/transactions", () => {
  class MockTransaction {
    setSender = vi.fn();
    splitCoins = vi.fn().mockReturnValue(["mockCoin"]);
    transferObjects = vi.fn();
    mergeCoins = vi.fn();
    moveCall = vi.fn();
    object = vi.fn((id: string) => id);
    pure = { address: vi.fn((addr: string) => addr) };
    gas = "gas";
    build = mockBuild;
  }
  return { Transaction: MockTransaction };
});

// Mock Supabase
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSupabaseSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
});
const mockSupabaseUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock("../../config/supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      insert: mockInsert,
      select: mockSupabaseSelect,
      update: mockSupabaseUpdate,
    }),
  }),
}));

// Mock BlockVision
vi.mock("../blockVisionService", () => ({
  getBlockVisionService: () => ({
    getAccountPortfolio: vi.fn().mockResolvedValue({
      totalValue: 500,
      coins: [
        { symbol: "SUI", coinType: "0x2::sui::SUI", balance: "100", price: 4.5, valueUsd: 450 },
        { symbol: "USDC", coinType: "0x..::usdc::USDC", balance: "50", price: 1.0, valueUsd: 50 },
      ],
      nfts: [],
    }),
    getTokenHolders: vi.fn().mockResolvedValue([]),
    getNFTs: vi.fn().mockResolvedValue([]),
  }),
}));

// Mock UserStateService
vi.mock("../userStateService", () => ({
  getUserStateService: () => ({
    getPreferences: vi.fn().mockResolvedValue({
      risk_tolerance: "moderate",
      notification_frequency: "normal",
      tracked_items: [],
    }),
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe("SimulationService", () => {
  let SimulationService: any;
  let getSimulationService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset singleton
    vi.resetModules();

    mockBuild.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockGetBalance.mockResolvedValue({ totalBalance: "50000000000" }); // 50 SUI

    // Default successful dry-run
    mockDryRun.mockResolvedValue({
      effects: {
        status: { status: "success" },
        gasUsed: {
          computationCost: "1000000",
          storageCost: "500000",
          storageRebate: "200000",
        },
      },
    });

    const mod = await import("../simulationService");
    SimulationService = mod.SimulationService;
    getSimulationService = mod.getSimulationService;
  });

  // ── Transfer Tests ──────────────────────────────────────────────

  describe("simulateTransfer", () => {
    it("should simulate a SUI transfer successfully", async () => {
      const service = getSimulationService();
      const result = await service.simulateTransfer(
        "0x" + "a".repeat(64),
        "0x" + "b".repeat(64),
        "10",
        "0x2::sui::SUI"
      );

      expect(result.success).toBe(true);
      expect(result.type).toBe("transfer");
      expect(result.narrative).toContain("Transfer");
      expect(result.narrative).toContain("10");
      expect(result.estimatedGas).toBeDefined();
      expect(result.serializedTx).toBeDefined();
    });

    it("should fail for invalid addresses", async () => {
      const service = getSimulationService();
      const result = await service.simulateTransfer(
        "invalid",
        "0x" + "b".repeat(64),
        "10"
      );

      expect(result.success).toBe(false);
      expect(result.narrative).toContain("Invalid");
    });

    it("should warn when sender equals recipient", async () => {
      const addr = "0x" + "a".repeat(64);
      const service = getSimulationService();
      const result = await service.simulateTransfer(addr, addr, "1");

      expect(result.warnings).toContain("Sender and recipient are the same address.");
    });

    it("should handle dry-run failure gracefully", async () => {
      mockDryRun.mockResolvedValue({
        effects: {
          status: { status: "failure", error: "Insufficient gas" },
          gasUsed: {
            computationCost: "0",
            storageCost: "0",
            storageRebate: "0",
          },
        },
      });

      const service = getSimulationService();
      const result = await service.simulateTransfer(
        "0x" + "a".repeat(64),
        "0x" + "b".repeat(64),
        "10"
      );

      expect(result.success).toBe(false);
      expect(result.narrative).toContain("Dry-run failed");
    });

    it("should generate low-balance warning", async () => {
      // Balance is 50 SUI, transferring 49.99
      const service = getSimulationService();
      const result = await service.simulateTransfer(
        "0x" + "a".repeat(64),
        "0x" + "b".repeat(64),
        "49.99"
      );

      // Should have a balance warning
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // ── Swap Tests ──────────────────────────────────────────────────

  describe("simulateSwap", () => {
    it("should estimate a swap with price data", async () => {
      const service = getSimulationService();
      const result = await service.simulateSwap(
        "0x" + "a".repeat(64),
        "SUI",
        "USDC",
        "10"
      );

      expect(result.success).toBe(true);
      expect(result.type).toBe("swap");
      expect(result.narrative).toContain("Estimated swap");
      expect(result.details.estimatedOutput).toBeDefined();
    });

    it("should fail if source token not in wallet", async () => {
      const service = getSimulationService();
      const result = await service.simulateSwap(
        "0x" + "a".repeat(64),
        "UNKNOWN_TOKEN",
        "SUI",
        "10"
      );

      expect(result.success).toBe(false);
      expect(result.narrative).toContain("not found");
    });

    it("should fail if insufficient balance", async () => {
      const service = getSimulationService();
      const result = await service.simulateSwap(
        "0x" + "a".repeat(64),
        "SUI",
        "USDC",
        "9999" // More than 100 SUI balance
      );

      expect(result.success).toBe(false);
      expect(result.narrative).toContain("Insufficient");
    });
  });

  // ── Stake Tests ──────────────────────────────────────────────────

  describe("simulateStake", () => {
    it("should simulate staking successfully", async () => {
      const service = getSimulationService();
      const result = await service.simulateStake(
        "0x" + "a".repeat(64),
        "0x" + "c".repeat(64),
        "10"
      );

      expect(result.success).toBe(true);
      expect(result.type).toBe("stake");
      expect(result.narrative).toContain("Stake");
      expect(result.narrative).toContain("validator");
    });

    it("should fail for invalid validator address", async () => {
      const service = getSimulationService();
      const result = await service.simulateStake(
        "0x" + "a".repeat(64),
        "bad_validator",
        "10"
      );

      expect(result.success).toBe(false);
      expect(result.narrative).toContain("Invalid");
    });
  });

  // ── Audit Log Tests ──────────────────────────────────────────────

  describe("audit logging", () => {
    it("should record simulation in audit log", async () => {
      const service = getSimulationService();
      await service.simulateTransfer(
        "0x" + "a".repeat(64),
        "0x" + "b".repeat(64),
        "1"
      );

      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── Warning Generation ──────────────────────────────────────────

  describe("warnings", () => {
    it("should warn when balance drops below gas buffer", async () => {
      // Set balance very low
      mockGetBalance.mockResolvedValue({ totalBalance: "200000000" }); // 0.2 SUI

      const service = getSimulationService();
      const result = await service.simulateTransfer(
        "0x" + "a".repeat(64),
        "0x" + "b".repeat(64),
        "0.15"
      );

      const hasGasWarning = result.warnings.some(
        (w: string) => w.includes("insufficient") || w.includes("remaining")
      );
      expect(hasGasWarning).toBe(true);
    });
  });

  // ── Singleton ──────────────────────────────────────────────────────

  describe("singleton", () => {
    it("should return the same instance", () => {
      const s1 = getSimulationService();
      const s2 = getSimulationService();
      expect(s1).toBe(s2);
    });
  });
});
