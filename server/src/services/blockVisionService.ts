import axios from 'axios';
import { getSuiIndexerService } from './suiIndexerService';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface BlockVisionCoin {
  coinType: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  price?: number;
  valueUsd?: number;
}

export interface BlockVisionNFT {
  objectId: string;
  name: string;
  description: string;
  image: string;
  collectionName?: string;
}

export interface BlockVisionHolder {
  address: string;
  balance: string;
  percentage?: number;
}

export interface BlockVisionTokenInfo {
  price: number;
  change24h: number;
  symbol: string;
  name: string;
  decimals: number;
}

// ══════════════════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════════════════

export class BlockVisionService {
  private apiKey: string;
  private baseUrl: string;
  private indexer = getSuiIndexerService();

  // Circuit breaker state
  private static isExhausted = false;
  private static lastExhaustionCheck = 0;
  private static readonly COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

  constructor() {
    this.apiKey = process.env.BLOCKVISION_API_KEY || "";
    this.baseUrl =
      process.env.BLOCKVISION_BASE_URL || "https://api.blockvision.org/v1/sui";

    if (!this.apiKey) {
      console.warn("[BlockVision] API Key is missing! Will fall back to RPC indexer.");
    }

    if (process.env.BLOCKVISION_DISABLED === "true") {
      console.info("[BlockVision] Service is manually disabled via environment variable.");
      BlockVisionService.isExhausted = true;
    }
  }

  /**
   * Checks if the service is currently functional or if it should be bypassed.
   */
  private shouldBypass(): boolean {
    if (!this.apiKey) return true;
    if (!BlockVisionService.isExhausted) return false;

    // Reset exhaustion status after cooldown
    const now = Date.now();
    if (now - BlockVisionService.lastExhaustionCheck > BlockVisionService.COOLDOWN_MS) {
      console.info("[BlockVision] Exhaustion cooldown expired, attempting to resume service...");
      BlockVisionService.isExhausted = false;
      return false;
    }

    return true;
  }

  /**
   * Marks the service as exhausted (e.g. on 403 or 429 response).
   */
  private markExhausted(status: number) {
    if (status === 403 || status === 429) {
      console.warn(`[BlockVision] Service exhausted (status ${status}). Activating circuit breaker.`);
      BlockVisionService.isExhausted = true;
      BlockVisionService.lastExhaustionCheck = Date.now();
    }
  }

  private get headers() {
    return {
      'X-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // ── Portfolio ──────────────────────────────────────────────────────

  /**
   * Fetches the account portfolio from BlockVision.
   * On any failure, automatically retries via the Sui RPC fallback indexer.
   */
  async getAccountPortfolio(
    address: string
  ): Promise<{ coins: BlockVisionCoin[]; totalValue: number }> {
    // Validation: Ensure this is a wallet address, not a coin type
    if (address.includes('::')) {
      throw new Error(`Invalid wallet address: ${address}. Portfolio analysis requires a 0x hex address, not a coin type.`);
    }

    if (this.shouldBypass()) {
      return this.indexer.getAccountPortfolio(address);
    }

    try {
      const response = await axios.get(`${this.baseUrl}/account/coins`, {
        params: { address },
        headers: this.headers,
        timeout: 5000,
      });

      const data = response.data.result || [];
      const coins: BlockVisionCoin[] = data.map((c: any) => ({
        coinType: c.coinType,
        name: c.name,
        symbol: c.symbol,
        decimals: c.decimals,
        balance: c.balance,
        price: c.price || 0,
        valueUsd: c.value || 0,
      }));

      const totalValue = coins.reduce(
        (sum: number, c: BlockVisionCoin) => sum + (c.valueUsd || 0),
        0
      );

      return { coins, totalValue };
    } catch (bvError: any) {
      const status = bvError?.response?.status;
      this.markExhausted(status);
      console.warn(
        `[BlockVision] Portfolio fetch failed (${status ?? bvError?.message}), falling back to RPC indexer...`
      );

      try {
        const result = await this.indexer.getAccountPortfolio(address);
        console.log(`[BlockVision] RPC fallback succeeded for portfolio: ${address}`);
        return result;
      } catch (rpcError: any) {
        throw new Error(
          `Portfolio unavailable for ${address}. ` +
          `BlockVision: ${status ?? bvError?.message}. ` +
          `RPC fallback: ${rpcError?.message}`
        );
      }
    }
  }

  // ── Token Holders ──────────────────────────────────────────────────

  /**
   * Fetches token holders from BlockVision.
   * On any failure, automatically retries via the Sui RPC fallback indexer.
   */
  async getTokenHolders(
    coinType: string,
    limit = 20
  ): Promise<BlockVisionHolder[]> {
    if (this.shouldBypass()) {
      return this.indexer.getTokenHolders(coinType, limit);
    }

    try {
      const response = await axios.get(`${this.baseUrl}/coin/holders`, {
        params: { coinType, limit },
        headers: this.headers,
        timeout: 5000,
      });

      return (response.data.result || []).map((h: any) => ({
        address: h.address,
        balance: h.balance,
        percentage: h.percentage,
      }));
    } catch (bvError: any) {
      const status = bvError?.response?.status;
      this.markExhausted(status);
      console.warn(
        `[BlockVision] Holders fetch failed (${status ?? bvError?.message}), falling back to RPC indexer...`
      );

      try {
        const holders = await this.indexer.getTokenHolders(coinType, limit);
        console.log(`[BlockVision] RPC fallback succeeded for holders: ${coinType}`);
        return holders;
      } catch (rpcError: any) {
        throw new Error(
          `Holder data unavailable for ${coinType}. ` +
          `BlockVision: ${status ?? bvError?.message}. ` +
          `RPC fallback: ${rpcError?.message}`
        );
      }
    }
  }

  // ── NFTs ───────────────────────────────────────────────────────────

  /**
   * Fetches NFTs from BlockVision.
   * On any failure, automatically retries via the Sui RPC fallback indexer.
   */
  async getNFTs(address: string, limit = 50): Promise<BlockVisionNFT[]> {
    // Validation: Ensure this is a wallet address, not a coin type
    if (address.includes('::')) {
      throw new Error(`Invalid wallet address: ${address}. NFT analysis requires a 0x hex address, not a coin type.`);
    }

    if (this.shouldBypass()) {
      return this.indexer.getNFTs(address, limit);
    }

    try {
      const response = await axios.get(`${this.baseUrl}/account/nfts`, {
        params: { address, limit },
        headers: this.headers,
        timeout: 5000,
      });

      return (response.data.result || []).map((n: any) => ({
        objectId: n.objectId,
        name: n.name,
        description: n.description,
        image: n.image_url || n.url,
        collectionName: n.collection,
      }));
    } catch (bvError: any) {
      const status = bvError?.response?.status;
      this.markExhausted(status);
      console.warn(
        `[BlockVision] NFT fetch failed (${status ?? bvError?.message}), falling back to RPC indexer...`
      );

      try {
        const nfts = await this.indexer.getNFTs(address, limit);
        console.log(`[BlockVision] RPC fallback succeeded for NFTs: ${address}`);
        return nfts;
      } catch (rpcError: any) {
        throw new Error(
          `NFT data unavailable for ${address}. ` +
          `BlockVision: ${status ?? bvError?.message}. ` +
          `RPC fallback: ${rpcError?.message}`
        );
      }
    }
  }

  // ── Token Info & Price ─────────────────────────────────────────────

  /**
   * Fetches token information (price, metadata) from BlockVision.
   * Centralized here to respect use the circuit breaker.
   */
  async getTokenInfo(coinType: string): Promise<BlockVisionTokenInfo | null> {
    if (this.shouldBypass()) return null;

    try {
      const response = await axios.get(`${this.baseUrl}/coin/info`, {
        params: { coinType },
        headers: this.headers,
        timeout: 5000,
      });

      const data = response.data.result || response.data;
      if (data && typeof data.price === 'number') {
        return {
          price: data.price,
          change24h: data.priceChangePercentage24h || 0,
          symbol: data.symbol || "",
          name: data.name || "",
          decimals: data.decimals || 0,
        };
      }
      return null;
    } catch (bvError: any) {
      const status = bvError?.response?.status;
      this.markExhausted(status);
      console.warn(
        `[BlockVision] Token info fetch failed (${status ?? bvError?.message}) for ${coinType}`
      );
      return null;
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────
export const getBlockVisionService = (() => {
  let instance: BlockVisionService;
  return () => {
    if (!instance) instance = new BlockVisionService();
    return instance;
  };
})();