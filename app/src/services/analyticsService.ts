// src/services/analyticsService.ts
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface TokenBalance {
  coinType: string;
  symbol: string;
  decimals: number;
  totalBalance: number;
  amount: number;
  price_usd: number;
  value_usd: number;
  price_change_24h: number;
}

export interface WalletOverview {
  balances: TokenBalance[];
  total_value_usd: number;
  num_tokens: number;
  timestamp: string;
}

export interface Transaction {
  digest: string;
  timestamp: string;
  checkpoint: string;
}

export interface TransactionHistory {
  transactions: Transaction[];
  nextCursor: string | null;
  hasNextPage: boolean;
  total: number;
}

export interface WalletStats {
  total_transactions: number;
  total_volume: number;
  realized_pnl: number;
  win_rate: number;
  note?: string;
}

export interface NFT {
  objectId: string;
  type: string;
  name: string;
  description: string;
  image_url: string;
  link: string;
  project_url: string;
}

export interface NFTData {
  nfts: NFT[];
  total: number;
}

class AnalyticsService {
  /**
   * Fetch wallet overview with balances and prices
   */
  async fetchWalletOverview(address: string): Promise<WalletOverview> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/analytics/wallet/${address}/overview`);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching wallet overview:', error);
      throw new Error(error.response?.data?.detail || 'Failed to fetch wallet overview');
    }
  }

  /**
   * Fetch transaction history for a wallet
   */
  async fetchTransactionHistory(
    address: string,
    limit: number = 50,
    cursor?: string
  ): Promise<TransactionHistory> {
    try {
      const params: any = { limit };
      if (cursor) params.cursor = cursor;

      const response = await axios.get(
        `${API_BASE_URL}/api/analytics/wallet/${address}/transactions`,
        { params }
      );
      return response.data;
    } catch (error: any) {
      console.error('Error fetching transaction history:', error);
      throw new Error(error.response?.data?.detail || 'Failed to fetch transactions');
    }
  }

  /**
   * Fetch basic wallet statistics
   */
  async fetchWalletStats(address: string): Promise<WalletStats> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/analytics/wallet/${address}/stats`);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching wallet stats:', error);
      throw new Error(error.response?.data?.detail || 'Failed to fetch wallet stats');
    }
  }

  /**
   * Fetch NFTs owned by wallet
   */
  async fetchWalletNFTs(address: string, limit: number = 50): Promise<NFTData> {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/analytics/wallet/${address}/nfts`,
        { params: { limit } }
      );
      return response.data;
    } catch (error: any) {
      console.error('Error fetching wallet NFTs:', error);
      throw new Error(error.response?.data?.detail || 'Failed to fetch NFTs');
    }
  }
}

export const analyticsService = new AnalyticsService();
