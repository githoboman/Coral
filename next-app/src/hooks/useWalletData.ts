'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';

export interface Token {
  symbol: string;
  balance: number;
  price: number;
  value: number;
  change24h: number;
  icon: string;
  decimals: number;
  type: string;
}

export interface WalletData {
  tokens: Token[];
  balanceUSD: string;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; price: number; change24h: number; icon: string }> = {
  '0x2::sui::SUI': {
    symbol: 'SUI',
    decimals: 9,
    price: 1.85,
    change24h: 0,
    icon: '/assets/images/sui-icon.png'
  },
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': {
    symbol: 'USDC',
    decimals: 6,
    price: 1.0,
    change24h: 0,
    icon: '/assets/images/usdc-icon.png'
  }
};

async function fetchSuiPrice(): Promise<{ price: number; change: number }> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await res.json();
    return {
      price: data.sui?.usd || 1.85,
      change: data.sui?.usd_24h_change || 0
    };
  } catch {
    return { price: 1.85, change: 0 };
  }
}

export function useWalletData(): WalletData {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const address = currentAccount?.address || null;

  const [tokens, setTokens] = useState<Token[]>([]);
  const [balanceUSD, setBalanceUSD] = useState<string>('0.00');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);


  const fetchBalance = useCallback(async () => {
    if (!address) {
      setBalanceUSD('0.00');
      setTokens([]);
      return;
    }

    const now = Date.now();
    if (lastFetched && now - lastFetched < 30_000) return;

    setIsLoading(true);
    setError(null);

    try {
      const coins = await suiClient.getAllBalances({ owner: address });
      const suiData = await fetchSuiPrice();

      // Update SUI price in known tokens
      const updatedKnownTokens = {
        ...KNOWN_TOKENS,
        '0x2::sui::SUI': {
          ...KNOWN_TOKENS['0x2::sui::SUI'],
          price: suiData.price,
          change24h: suiData.change
        }
      };

      // Always show SUI and USDC
      const displayTokens: Record<string, Token> = {
        '0x2::sui::SUI': {
          ...updatedKnownTokens['0x2::sui::SUI'],
          balance: 0,
          value: 0,
          type: '0x2::sui::SUI'
        },
        '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': {
          ...KNOWN_TOKENS['0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'],
          balance: 0,
          value: 0,
          type: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
        }
      };

      let totalUsd = 0;

      for (const coin of coins) {
        const type = coin.coinType;
        const meta = updatedKnownTokens[type as keyof typeof updatedKnownTokens] || {
          symbol: type.split('::').pop() || 'UNK',
          decimals: 9,
          price: 0,
          change24h: 0,
          icon: '/assets/images/sui-icon.png'
        };

        const balance = Number(coin.totalBalance) / Math.pow(10, meta.decimals);
        const value = balance * (meta.price || 0);

        if (balance > 0 || displayTokens[type]) {
          displayTokens[type] = { ...meta, balance, value, type };
          totalUsd += value;
        }
      }

      setTokens(Object.values(displayTokens));
      setBalanceUSD(totalUsd.toFixed(2));
      setLastFetched(now);
    } catch (err) {
      console.error('Failed to fetch wallet data:', err);
      setError('Failed to load wallet data');
    } finally {
      setIsLoading(false);
    }
  }, [address, lastFetched, suiClient]);

  // Fetch on mount and when address changes
  useEffect(() => {
    if (address) {
      fetchBalance();
      const interval = setInterval(fetchBalance, 60_000);
      return () => clearInterval(interval);
    }
  }, [address, fetchBalance]);

  return {
    tokens,
    balanceUSD,
    isLoading,
    error,
    refetch: fetchBalance
  };
}
