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

export interface WalletTransaction {
  digest: string;           // Unique transaction ID
  type: 'send' | 'receive' | 'other';
  amount: string;           // Human readable e.g. "10 USDC"
  counterparty: string;     // The other address involved
  timestamp: number;        // Unix ms
}

export interface BlockVisionTokenInfo {
  price: number;
  change24h: number;
  symbol: string;
  name: string;
  decimals: number;
  holders?: number;
  marketCap?: number;
  verified?: boolean;
  logoUrl?: string;
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
    const network = process.env.SUI_NETWORK || "mainnet";
    const rawBaseUrl = process.env.BLOCKVISION_BASE_URL || "https://api.blockvision.org/v2/sui";
    
    // Auto-adjust for testnet if needed
    if (network === "testnet" && !rawBaseUrl.includes("testnet")) {
      this.baseUrl = rawBaseUrl.replace("/sui", "/sui-testnet");
    } else {
      this.baseUrl = rawBaseUrl;
    }

    if (!this.apiKey) {
      console.warn("[BlockVision] API Key is missing! Will fall back to RPC indexer.");
    } else {
      console.info(`[BlockVision] Initialized with API Key: ${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}`);
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
        params: { account: address },
        headers: this.headers,
        timeout: 10000,
      });

      const data = response.data.result?.data || response.data.result || [];
      const coins: BlockVisionCoin[] = (Array.isArray(data) ? data : []).map((c: any) => {
        const balance = typeof c.balance === 'string' ? parseFloat(c.balance) : (c.balance || 0);
        const price = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.usdPrice === 'string' ? parseFloat(c.usdPrice) : (c.price || c.usdPrice || 0));

        // Try all common value field names, fallback to manual calculation if price is known
        let valueUsd = typeof c.value === 'string' ? parseFloat(c.value) :
          (typeof c.usdValue === 'string' ? parseFloat(c.usdValue) :
            (typeof c.usd_value === 'string' ? parseFloat(c.usd_value) :
              (c.value || c.usdValue || c.usd_value || 0)));

        if (valueUsd === 0 && price > 0 && balance > 0) {
          valueUsd = balance * price;
        }

        return {
          coinType: c.coinType,
          name: c.name || c.symbol || "Unknown",
          symbol: c.symbol || "Unknown",
          decimals: c.decimals || 0,
          balance: balance.toString(), // Keep as string for consistent typing in some contexts
          price: price,
          valueUsd: valueUsd,
        };
      });

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
        timeout: 10000,
      });

      const data = response.data.result?.data || response.data.result || [];
      return (Array.isArray(data) ? data : []).map((h: any) => ({
        address: h.address,
        balance: typeof h.balance === 'string' ? parseFloat(h.balance) : (h.balance || 0),
        percentage: typeof h.percentage === 'string' ? parseFloat(h.percentage) : (h.percentage || 0),
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
        params: { account: address, limit },
        headers: this.headers,
        timeout: 10000,
      });

      const data = response.data.result?.data || response.data.result || [];
      return (Array.isArray(data) ? data : []).map((n: any) => ({
        objectId: n.objectId,
        name: n.name || "Unnamed NFT",
        description: n.description || "",
        image: n.image_url || n.url || n.image || (n.metadata as any)?.image_url,
        collectionName: n.collection || n.collection_name || "Unknown Collection",
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
    if (this.shouldBypass()) {
      return this.fallbackTokenInfo(coinType);
    }

    try {
      const url = `${this.baseUrl}/coin/detail`;
      const response = await axios.get(url, {
        params: { coinType },
        headers: this.headers,
        timeout: 10000,
      });

      const result = response.data.result;
      if (result) {
        // Handle price strings or objects
        const parseNum = (val: any) => {
          if (typeof val === 'number') return val;
          if (typeof val === 'string') return parseFloat(val) || 0;
          if (val && typeof val.value !== 'undefined') return parseNum(val.value);
          return 0;
        };

        return {
          price: parseNum(result.price),
          change24h: parseNum(result.priceChangePercentage24H || result.priceChangePercentage24h || result.priceChange24h),
          symbol: result.symbol || "",
          name: result.name || "",
          decimals: result.decimals || 0,
          holders: parseNum(result.holders),
          marketCap: parseNum(result.marketCap),
          verified: !!result.verified,
          logoUrl: result.logo || result.iconUrl,
        };
      }
      return null;
    } catch (error: any) {
      const status = error?.response?.status;
      this.markExhausted(status);
      console.error(`[BlockVision] Token info fetch failed (${error.response?.status || error.message}) for ${coinType}`);
      return this.fallbackTokenInfo(coinType);
    }
  }

  private async fallbackTokenInfo(coinType: string): Promise<BlockVisionTokenInfo | null> {
    console.log(`[BlockVision] Attempting RPC fallback for ${coinType.slice(-10)}`);
    const meta = await getSuiIndexerService().getTokenMetadata(coinType);
    if (!meta) {
      console.warn(`[BlockVision] RPC fallback FAILED - no metadata found for ${coinType.slice(-10)}`);
      return null;
    }

    return {
      name: meta.name,
      symbol: meta.symbol,
      price: 0,
      change24h: 0,
      decimals: meta.decimals,
    };
  }

  // ── Transactions ───────────────────────────────────────────────────

  /**
   * Fetches recent transactions for an account from BlockVision.
   * On any failure, automatically retries via the Sui RPC fallback indexer.
   */
  async getRecentTransactions(
    address: string,
    limit = 10
  ): Promise<WalletTransaction[]> {
    if (this.shouldBypass()) {
      return this.indexer.getRecentTransactions(address, limit);
    }

    try {
      const response = await axios.get(`${this.baseUrl}/account/activities`, {
        params: { address: address, limit },
        headers: this.headers,
        timeout: 10000,
      });

      const data = response.data.result?.data || response.data.result || [];
      
      // Log sample for verification on first successful call -- Remove after Testing
      if (data.length > 0) {
        console.log('[BlockVision DEBUG] Activities response sample:', JSON.stringify(data[0], null, 2));
      }

      return (Array.isArray(data) ? data : []).map((tx: any) => {
        const isSender = tx.from === address;
        const isReceiver = tx.to === address;
        
        // BlockVison /activities usually provides 'amount' and 'symbol' or 'tokenSymbol'
        const amountDisplay = tx.amount && tx.symbol ? `${tx.amount} ${tx.symbol}` : (tx.amount || "0");

        return {
          digest: tx.digest,
          type: isSender ? 'send' : (isReceiver ? 'receive' : 'other'),
          amount: amountDisplay,
          counterparty: isSender ? tx.to : (isReceiver ? tx.from : "Unknown"),
          timestamp: tx.timestamp || Date.now(),
        };
      });
    } catch (bvError: any) {
      const status = bvError?.response?.status;
      this.markExhausted(status);
      console.warn(
        `[BlockVision] Transactions fetch failed (${status ?? bvError?.message}), falling back to RPC indexer...`
      );

      try {
        const txs = await this.indexer.getRecentTransactions(address, limit);
        if (txs && txs.length > 0) {
          console.log(`[BlockVision] RPC fallback succeeded with ${txs.length} transactions for: ${address}`);
        } else {
          console.log(`[BlockVision] RPC fallback executed but no transactions found for: ${address}`);
        }
        return txs;
      } catch (rpcError: any) {
        console.error(`[BlockVision] Both BV and RPC fallback failed for transactions: ${address}`, rpcError.message);
        return [];
      }
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