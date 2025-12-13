// src/hooks/useAnalytics.ts
import { useState, useEffect } from 'react';
import {
  analyticsService,
  WalletOverview,
  TransactionHistory,
  WalletStats,
  NFTData
} from '@/services/analyticsService';

/**
 * Hook for fetching wallet overview data
 */
export function useWalletOverview(address: string | null) {
  const [data, setData] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const overview = await analyticsService.fetchWalletOverview(address);
        setData(overview);
      } catch (err: any) {
        setError(err.message);
        console.error('useWalletOverview error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address]);

  return { data, loading, error };
}

/**
 * Hook for fetching transaction history
 */
export function useTransactionHistory(address: string | null, limit: number = 50) {
  const [data, setData] = useState<TransactionHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const history = await analyticsService.fetchTransactionHistory(address, limit);
        setData(history);
      } catch (err: any) {
        setError(err.message);
        console.error('useTransactionHistory error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address, limit]);

  return { data, loading, error };
}

/**
 * Hook for fetching wallet statistics
 */
export function useWalletStats(address: string | null) {
  const [data, setData] = useState<WalletStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const stats = await analyticsService.fetchWalletStats(address);
        setData(stats);
      } catch (err: any) {
        setError(err.message);
        console.error('useWalletStats error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address]);

  return { data, loading, error };
}

/**
 * Hook for fetching wallet NFTs
 */
export function useWalletNFTs(address: string | null, limit: number = 50) {
  const [data, setData] = useState<NFTData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const nfts = await analyticsService.fetchWalletNFTs(address, limit);
        setData(nfts);
      } catch (err: any) {
        setError(err.message);
        console.error('useWalletNFTs error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address, limit]);

  return { data, loading, error };
}
