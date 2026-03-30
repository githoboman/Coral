import axios from 'axios';
import { getRpcManager } from './rpcManager';

// ══════════════════════════════════════════════════════════════════════
// SHARED TYPES (mirrors BlockVisionService for drop-in fallback usage)
// ══════════════════════════════════════════════════════════════════════

export interface IndexerCoin {
  coinType: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  price?: number;
  valueUsd?: number;
}

export interface IndexerNFT {
  objectId: string;
  name: string;
  description: string;
  image: string;
  collectionName?: string;
}

export interface IndexerHolder {
  address: string;
  balance: string;
  percentage?: number;
}

export interface IndexerTransaction {
  digest: string;
  type: 'send' | 'receive' | 'other';
  amount: string;
  counterparty: string;
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════════
// PRICE FETCHING (CoinGecko — free, no key required for basic use)
// ══════════════════════════════════════════════════════════════════════

// Map common Sui coin types to CoinGecko IDs for price lookups
const COINGECKO_ID_MAP: Record<string, string> = {
  '0x2::sui::SUI': 'sui',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': 'usd-coin', // USDC
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': 'tether',    // USDT
};

async function fetchCoinPrices(coinTypes: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const geckoIds = coinTypes
    .map((ct) => ({ ct, id: COINGECKO_ID_MAP[ct] }))
    .filter((x) => x.id);

  if (!geckoIds.length) return prices;

  try {
    const ids = geckoIds.map((x) => x.id).join(',');
    const resp = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 5000 }
    );
    for (const { ct, id } of geckoIds) {
      prices[ct] = resp.data?.[id]?.usd ?? 0;
    }
  } catch {
    // Price enrichment is best-effort — don't fail the whole request
    console.warn('[SuiIndexer] CoinGecko price fetch failed, values will show as $0');
  }
  return prices;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function formatBalance(rawBalance: string, decimals: number): string {
  const num = Number(rawBalance) / Math.pow(10, decimals);
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function isNftObject(obj: any): boolean {
  const type: string = obj?.data?.type ?? '';
  const content = obj?.data?.content;

  // Objects with display metadata containing name/image are NFTs
  if (obj?.data?.display?.data?.name) return true;

  // Common NFT type patterns on Sui
  if (type.includes('::nft::') || type.includes('::NFT') || type.includes('Kiosk')) return true;

  // Has image URL in fields
  const fields = content?.fields ?? {};
  if (fields.url || fields.image_url || fields.img_url) return true;

  return false;
}

// ══════════════════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════════════════

export class SuiIndexerService {
  private rpc = getRpcManager();

  // ── Portfolio ────────────────────────────────────────────────────────

  /**
   * Fetches all coin balances for an address via suix_getAllBalances,
   * then enriches with metadata and prices where available.
   */
  async getAccountPortfolio(
    address: string
  ): Promise<{ coins: IndexerCoin[]; totalValue: number }> {
    console.log(`[SuiIndexer] Fetching portfolio for ${address}`);

    // 1. Get all balances
    const balances: any[] = await this.rpc.call('suix_getAllBalances', [address]);

    if (!balances?.length) {
      return { coins: [], totalValue: 0 };
    }

    // 2. Get metadata for each coin type in parallel
    const metadataResults = await this.rpc.callParallel<any>(
      balances.map((b) => ({
        method: 'suix_getCoinMetadata',
        params: [b.coinType],
      }))
    );

    // 3. Fetch prices
    const coinTypes = balances.map((b) => b.coinType);
    const prices = await fetchCoinPrices(coinTypes);

    // 4. Assemble
    const coins: IndexerCoin[] = balances.map((b, i) => {
      const meta = metadataResults[i];
      const decimals = meta?.decimals ?? 9;
      const rawBalance = b.totalBalance ?? '0';
      const price = prices[b.coinType] ?? 0;
      const numericBalance = Number(rawBalance) / Math.pow(10, decimals);
      const valueUsd = numericBalance * price;

      return {
        coinType: b.coinType,
        name: meta?.name ?? b.coinType.split('::').pop() ?? 'Unknown',
        symbol: meta?.symbol ?? b.coinType.split('::').pop() ?? '???',
        decimals,
        balance: formatBalance(rawBalance, decimals),
        price,
        valueUsd,
      };
    });

    const totalValue = coins.reduce((sum, c) => sum + (c.valueUsd ?? 0), 0);

    return { coins, totalValue };
  }

  // ── NFTs ─────────────────────────────────────────────────────────────

  /**
   * Fetches owned objects and filters to those that appear to be NFTs
   * based on type patterns and display metadata.
   */
  async getNFTs(address: string, limit = 50): Promise<IndexerNFT[]> {
    console.log(`[SuiIndexer] Fetching NFTs for ${address}`);

    const response: any = await this.rpc.call('suix_getOwnedObjects', [
      address,
      {
        options: {
          showType: true,
          showContent: true,
          showDisplay: true,
        },
      },
      null,
      limit,
    ]);

    const objects: any[] = response?.data ?? [];
    const nftObjects = objects.filter(isNftObject);

    return nftObjects.map((obj) => {
      const display = obj?.data?.display?.data ?? {};
      const fields = obj?.data?.content?.fields ?? {};
      return {
        objectId: obj?.data?.objectId ?? '',
        name: display.name ?? fields.name ?? 'Unnamed NFT',
        description: display.description ?? fields.description ?? '',
        image: display.image_url ?? fields.url ?? fields.image_url ?? fields.img_url ?? '',
        collectionName: display.collection ?? fields.collection_name ?? undefined,
      };
    });
  }

  // ── Token Holders ────────────────────────────────────────────────────

  /**
   * NOTE: True holder distribution requires a full indexer — it cannot be
   * derived from the Sui RPC alone without paginating every coin owner.
   * This method fetches the top holders from the DeSuiLabs public API
   * (free, no key required) as a best-effort fallback.
   * If that also fails, it throws with a clear explanation.
   */
  async getTokenHolders(coinType: string, limit = 20): Promise<IndexerHolder[]> {
    console.log(`[SuiIndexer] Fetching holders for ${coinType}`);

    try {
      // DeSuiLabs provides a public holder API for Sui tokens
      const encoded = encodeURIComponent(coinType);
      const resp = await axios.get(
        `https://api.desuilabs.xyz/v1/coin/holders?coinType=${encoded}&limit=${limit}`,
        { timeout: 8000 }
      );
      const data: any[] = resp.data?.data ?? resp.data?.result ?? [];
      return data.map((h: any) => ({
        address: h.address ?? h.owner,
        balance: h.balance ?? h.amount,
        percentage: h.percentage ?? h.percent,
      }));
    } catch (err: any) {
      // If DeSuiLabs also fails, throw a clear message — don't silently return []
      throw new Error(
        `Holder distribution requires an indexer. Both BlockVision and the RPC fallback (DeSuiLabs) ` +
        `failed for ${coinType}: ${err?.message}`
      );
    }
  }

  // ── Metadata ─────────────────────────────────────────────────────────

  async getTokenMetadata(coinType: string): Promise<any> {
    console.log(`[SuiIndexer] Fetching metadata for ${coinType}`);
    try {
      return await this.rpc.call('suix_getCoinMetadata', [coinType]);
    } catch {
      return null;
    }
  }

  // ── Transactions ─────────────────────────────────────────────────────

  /**
   * Fetches recent transactions for an address using suix_queryTransactionBlocks.
   * Focuses on outgoing transactions (sender = address).
   */
  async getRecentTransactions(address: string, limit = 10): Promise<IndexerTransaction[]> {
    console.log(`[SuiIndexer] Querying transactions for ${address}`);
    try {
      const response: any = await this.rpc.call('suix_queryTransactionBlocks', [
        {
          filter: { FromAddress: address },
          options: {
            showInput: true,
            showEffects: true,
            showInternalViewComponents: true,
          }
        },
        null,
        limit,
        true // descending
      ]);

      const data: any[] = response?.data || [];
      return data.map((tx) => {
        // Simplified parsing for RPC fallback
        // In a real scenario, we'd parse balance changes, but for fallback 
        // we'll just indicate it's an outgoing tx.
        return {
          digest: tx.digest,
          type: 'send',
          amount: "Check Dashboard", // RPC fallback is less detailed without heavy parsing
          counterparty: "Multiple/Unknown", 
          timestamp: tx.timestampMs ? parseInt(tx.timestampMs, 10) : Date.now(),
        };
      });
    } catch (err) {
      // Re-throw so the caller (BlockVisionService) knows the fallback actually failed
      throw err;
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────
export const getSuiIndexerService = (() => {
  let instance: SuiIndexerService;
  return () => {
    if (!instance) instance = new SuiIndexerService();
    return instance;
  };
})();