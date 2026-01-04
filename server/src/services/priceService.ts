// src/services/priceService.ts
import axios from 'axios';

interface PriceCache {
  [coinType: string]: {
    price: number;
    change24h: number;
    timestamp: number;
  };
}

interface BlockVisionCoinDetail {
  coinType: string;
  name: string;
  symbol: string;
  decimals: number;
  iconUrl?: string;
  price?: number;
  priceChangePercentage24h?: number;
}

class PriceService {
  private cache: PriceCache = {};
  private CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private BLOCKVISION_API_KEY = process.env.BLOCKVISION_API_KEY;
  private BLOCKVISION_BASE_URL = process.env.BLOCKVISION_BASE_URL || 'https://api.blockvision.org/v1/sui';

  /**
   * Get token price from BlockVision API (primary) or CoinGecko (fallback)
   */
  async getTokenPrice(coinType: string): Promise<{ price: number; change24h: number }> {
    // Check cache first
    const cached = this.cache[coinType];
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return { price: cached.price, change24h: cached.change24h };
    }

    // Try BlockVision first
    try {
      const price = await this.getBlockVisionPrice(coinType);
      if (price) {
        // Update cache
        this.cache[coinType] = {
          ...price,
          timestamp: Date.now(),
        };
        return price;
      }
    } catch (error) {
      console.error(`BlockVision error for ${coinType}:`, error);
    }

    // Fallback to CoinGecko if BlockVision fails
    const coinGeckoId = this.getCoinGeckoId(coinType);
    if (coinGeckoId) {
      try {
        return await this.getCoinGeckoPrice(coinGeckoId);
      } catch (error) {
        console.error(`CoinGecko error for ${coinGeckoId}:`, error);
      }
    }

    // Return cached value if available, even if expired
    if (cached) {
      return { price: cached.price, change24h: cached.change24h };
    }

    return { price: 0, change24h: 0 };
  }

  /**
   * Get price from BlockVision API
   */
  private async getBlockVisionPrice(coinType: string): Promise<{ price: number; change24h: number } | null> {
    if (!this.BLOCKVISION_API_KEY) {
      console.warn('BlockVision API key not configured');
      return null;
    }

    try {
      const response = await axios.get<BlockVisionCoinDetail>(
        `${this.BLOCKVISION_BASE_URL}/coin/info`,
        {
          params: { coinType },
          headers: {
            'X-API-KEY': this.BLOCKVISION_API_KEY,
          },
          timeout: 5000,
        }
      );

      const data = response.data;
      if (data && typeof data.price === 'number') {
        return {
          price: data.price,
          change24h: data.priceChangePercentage24h || 0,
        };
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Token not found in BlockVision, will try CoinGecko
        return null;
      }
      throw error;
    }
  }

  /**
   * Get price from CoinGecko API (fallback)
   */
  private async getCoinGeckoPrice(coinId: string): Promise<{ price: number; change24h: number }> {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: {
          ids: coinId,
          vs_currencies: 'usd',
          include_24hr_change: true,
        },
        timeout: 5000,
      }
    );

    const data = response.data[coinId];
    if (data) {
      return {
        price: data.usd || 0,
        change24h: data.usd_24h_change || 0,
      };
    }

    return { price: 0, change24h: 0 };
  }

  /**
   * Get prices for multiple tokens
   */
  async getMultipleTokenPrices(
    coinTypes: string[]
  ): Promise<Map<string, { price: number; change24h: number }>> {
    const results = new Map<string, { price: number; change24h: number }>();

    // Check cache for all coins
    const uncachedCoins = coinTypes.filter((type) => {
      const cached = this.cache[type];
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        results.set(type, { price: cached.price, change24h: cached.change24h });
        return false;
      }
      return true;
    });

    if (uncachedCoins.length === 0) {
      return results;
    }

    // Fetch prices for uncached coins
    await Promise.all(
      uncachedCoins.map(async (coinType) => {
        try {
          const price = await this.getTokenPrice(coinType);
          results.set(coinType, price);
        } catch (error) {
          console.error(`Error fetching price for ${coinType}:`, error);
          results.set(coinType, { price: 0, change24h: 0 });
        }
      })
    );

    return results;
  }

  /**
   * Map Sui coin type to CoinGecko ID (fallback only)
   */
  private getCoinGeckoId(coinType: string): string | null {
    const mapping: { [key: string]: string } = {
      '0x2::sui::SUI': 'sui',
      '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': 'usd-coin',
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 'usd-coin',
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': 'tether',
      '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS': 'cetus-protocol',
      '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': 'ethereum',
      '0xb231fcda8bbddb31f2ef02e6161444aec64a514e2c89279584ac9806ce9cf037::coin::COIN': 'wrapped-bitcoin',
      '0x9e69acc50ca03bc943c4f7c5304c2a6002d507b51c11913b247159c60422c606::wal::WAL': 'walrus',
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': 'haedal-staked-sui',
      '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA': 'scallop',
    };

    return mapping[coinType] || null;
  }
}

export const priceService = new PriceService();
