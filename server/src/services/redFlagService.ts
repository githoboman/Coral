// server/src/services/redFlagService.ts
// Phase 3: Rule-based risk detection for tokens

import { getBlockVisionService, type BlockVisionHolder } from "./blockVisionService";

// ======================================================================
// TYPES
// ======================================================================

export interface RedFlag {
  severity: "low" | "medium" | "high";
  type: string;
  message: string;
  data?: Record<string, any>;
}

// ======================================================================
// THRESHOLDS
// ======================================================================

const MIN_HOLDER_COUNT = 50;
const HIGH_CONCENTRATION_PCT = 80; // top 5 holders control >80%
const WHALE_SINGLE_HOLDER_PCT = 40; // single holder with >40%

// ======================================================================
// SERVICE
// ======================================================================

export class RedFlagService {
  private blockVision = getBlockVisionService();

  /**
   * Analyzes a token for red flags using on-chain data.
   * Runs holder distribution checks and concentration analysis.
   * Fails gracefully -- returns empty array if data is unavailable.
   */
  async analyzeToken(coinType: string, symbol: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    // Skip analysis for well-known tokens
    const safeTokens = ["SUI", "USDC", "USDT", "WETH", "BTC", "ETH"];
    if (safeTokens.includes(symbol.toUpperCase())) {
      return flags;
    }

    // LEAK FIX: Only analyze tokens with a valid onchain coinType (0x...)
    // This prevents zombie calls for placeholders like "unknown_NAVI"
    if (!coinType || !coinType.startsWith("0x")) {
      return flags;
    }

    try {
      const holders = await this.blockVision.getTokenHolders(coinType, 20);

      if (holders.length === 0) {
        flags.push({
          severity: "medium",
          type: "no_holder_data",
          message: `No holder data available for ${symbol}. This could indicate a very new or untracked token.`,
        });
        return flags;
      }

      // Check 1: Low total holder count
      if (holders.length < MIN_HOLDER_COUNT) {
        flags.push({
          severity: "medium",
          type: "low_holders",
          message: `${symbol} has very few known holders (${holders.length}). Low holder count increases volatility and rug risk.`,
          data: { holderCount: holders.length },
        });
      }

      // Check 2: Top 5 concentration
      const top5 = holders.slice(0, 5);
      const top5Pct = top5.reduce((sum, h) => sum + (h.percentage || 0), 0);
      if (top5Pct > HIGH_CONCENTRATION_PCT) {
        flags.push({
          severity: "high",
          type: "high_concentration",
          message: `Top 5 holders control ${top5Pct.toFixed(1)}% of ${symbol} supply. High concentration means a few wallets can crash the price.`,
          data: { top5Percentage: top5Pct },
        });
      }

      // Check 3: Single whale dominance
      const topHolder = holders[0];
      if (topHolder?.percentage && topHolder.percentage > WHALE_SINGLE_HOLDER_PCT) {
        flags.push({
          severity: "high",
          type: "whale_dominance",
          message: `A single wallet holds ${topHolder.percentage.toFixed(1)}% of ${symbol}. This is a significant centralization risk.`,
          data: {
            address: topHolder.address?.slice(0, 10) + "...",
            percentage: topHolder.percentage,
          },
        });
      }
    } catch (err: any) {
      // Fail gracefully -- don't block the research because red flag checks failed
      console.warn(`[RedFlag] Analysis failed for ${symbol}: ${err?.message}`);
    }

    return flags;
  }

  /**
   * Formats red flag warnings for inclusion in a research report.
   * Adjusts tone based on user's risk tolerance.
   */
  generateWarnings(flags: RedFlag[], riskTolerance: string): string {
    if (flags.length === 0) return "";

    const highFlags = flags.filter((f) => f.severity === "high");
    const mediumFlags = flags.filter((f) => f.severity === "medium");

    let header: string;
    if (riskTolerance === "conservative") {
      header = "**Risk Warnings (Important for Your Profile)**";
    } else if (highFlags.length > 0) {
      header = "**Risk Warnings**";
    } else {
      header = "**Risk Notes**";
    }

    const lines = flags.map((f) => {
      const icon = f.severity === "high" ? "[!]" : "[i]";
      return `- ${icon} ${f.message}`;
    });

    // Extra cautionary note for conservative users
    if (riskTolerance === "conservative" && highFlags.length > 0) {
      lines.push(
        "\n> Given your conservative risk profile, exercise extra caution with this asset."
      );
    }

    return `\n\n${header}\n${lines.join("\n")}`;
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: RedFlagService | null = null;

export function getRedFlagService(): RedFlagService {
  if (!instance) instance = new RedFlagService();
  return instance;
}
