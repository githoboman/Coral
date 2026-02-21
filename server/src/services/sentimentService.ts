// server/src/services/sentimentService.ts
// Phase 3: Lightweight sentiment analysis via Tavily search results

import { TavilySearch } from "@langchain/tavily";

// ======================================================================
// TYPES
// ======================================================================

export interface SentimentResult {
  score: number;        // -1.0 (very negative) to 1.0 (very positive)
  label: "positive" | "neutral" | "negative";
  summary: string;      // one-liner for the report
  sources: string[];    // URLs from Tavily results
  keySignals: string[]; // matched keywords
}

// ======================================================================
// KEYWORD LISTS
// ======================================================================

const POSITIVE_KEYWORDS = [
  "bullish", "breakout", "partnership", "listing", "upgrade",
  "mainnet", "ath", "growth", "surge", "rally", "adoption",
  "integration", "milestone", "launch", "tvl increase",
  "ecosystem", "grant", "airdrop", "staking rewards",
];

const NEGATIVE_KEYWORDS = [
  "bearish", "dump", "hack", "exploit", "scam", "rugpull",
  "rug pull", "fud", "lawsuit", "delisting", "crash",
  "vulnerability", "drain", "exit scam", "ponzi", "fraud",
  "sec", "investigation", "tvl drop", "depeg",
];

// ======================================================================
// SERVICE
// ======================================================================

export class SentimentService {
  private tavily: TavilySearch;

  constructor() {
    this.tavily = new TavilySearch({
      maxResults: 5,
      topic: "news",
      searchDepth: "basic",
    });
  }

  /**
   * Analyzes market sentiment for a token by searching recent news/social mentions
   * via Tavily and scoring with keyword matching.
   */
  async analyzeSentiment(tokenSymbol: string): Promise<SentimentResult> {
    const defaultResult: SentimentResult = {
      score: 0,
      label: "neutral",
      summary: `No recent sentiment data found for ${tokenSymbol}.`,
      sources: [],
      keySignals: [],
    };

    // Skip sentiment for stablecoins
    const stables = ["USDC", "USDT", "DAI", "BUSD"];
    if (stables.includes(tokenSymbol.toUpperCase())) {
      return {
        ...defaultResult,
        summary: `${tokenSymbol} is a stablecoin -- sentiment analysis not applicable.`,
      };
    }

    try {
      const rawResult = await this.tavily.invoke({
        query: `${tokenSymbol} crypto latest news sentiment`,
      });

      // Tavily returns a string or structured result
      const text = typeof rawResult === "string"
        ? rawResult
        : JSON.stringify(rawResult);

      const lower = text.toLowerCase();

      // Extract URLs for source citation
      const urlMatches = text.match(/https?:\/\/[^\s"',\]})]+/g) || [];
      const sources = [...new Set(urlMatches)].slice(0, 5);

      // Score sentiment
      const positiveHits: string[] = [];
      const negativeHits: string[] = [];

      for (const kw of POSITIVE_KEYWORDS) {
        if (lower.includes(kw)) positiveHits.push(kw);
      }
      for (const kw of NEGATIVE_KEYWORDS) {
        if (lower.includes(kw)) negativeHits.push(kw);
      }

      const totalHits = positiveHits.length + negativeHits.length;
      if (totalHits === 0) {
        return { ...defaultResult, sources };
      }

      // Normalize to -1..1
      const rawScore = (positiveHits.length - negativeHits.length) / totalHits;
      const score = Math.max(-1, Math.min(1, rawScore));

      const label: SentimentResult["label"] =
        score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral";

      const keySignals = [
        ...positiveHits.map((kw) => `+${kw}`),
        ...negativeHits.map((kw) => `-${kw}`),
      ];

      // Build human summary
      let summary: string;
      if (label === "positive") {
        summary = `Recent sentiment for ${tokenSymbol} is positive (${positiveHits.length} positive signals vs ${negativeHits.length} negative). Key: ${positiveHits.join(", ")}.`;
      } else if (label === "negative") {
        summary = `Recent sentiment for ${tokenSymbol} is negative (${negativeHits.length} negative signals vs ${positiveHits.length} positive). Watch: ${negativeHits.join(", ")}.`;
      } else {
        summary = `Sentiment for ${tokenSymbol} is mixed/neutral (${positiveHits.length} positive, ${negativeHits.length} negative signals).`;
      }

      return { score, label, summary, sources, keySignals };
    } catch (err: any) {
      console.warn(`[Sentiment] Analysis failed for ${tokenSymbol}: ${err?.message}`);
      return defaultResult;
    }
  }

  /**
   * Formats sentiment results for inclusion in a research report.
   */
  formatForReport(result: SentimentResult): string {
    if (result.sources.length === 0 && result.keySignals.length === 0) {
      return "";
    }

    const lines = [
      `\n\n**Market Sentiment**`,
      result.summary,
    ];

    if (result.keySignals.length > 0) {
      lines.push(`Signals: ${result.keySignals.join(", ")}`);
    }

    return lines.join("\n");
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: SentimentService | null = null;

export function getSentimentService(): SentimentService {
  if (!instance) instance = new SentimentService();
  return instance;
}
