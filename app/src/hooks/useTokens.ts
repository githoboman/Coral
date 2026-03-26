import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSuiClient } from "@mysten/dapp-kit";

const debounce = (func: (...args: any[]) => void, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const useTokens = (address: string | null) => {
  const suiClient = useSuiClient();

  const [walletBalanceUSD, setWalletBalanceUSD] = useState<string>("0.00");
  const [tokens, setTokens] = useState<any[]>([]);
  const [isFetchingTokens, setIsFetchingTokens] = useState(false);
  const lastFetchedRef = useRef<number | null>(null);

  const fetchSuiPriceUSD = useCallback(async (): Promise<{ price: number; change: number }> => {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true");
      const data = await res.json();
      return {
        price: data.sui?.usd || 1.85,
        change: data.sui?.usd_24h_change || 0,
      };
    } catch {
      return { price: 1.85, change: 0 };
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!address) {
      setWalletBalanceUSD("0.00");
      setTokens([]);
      lastFetchedRef.current = null;
      return;
    }

    const now = Date.now();
    if (lastFetchedRef.current && now - lastFetchedRef.current < 30_000) {
      // If we already have data for this address and it's fresh, don't show skeleton again
      // unless it's a new address.
      return;
    }

    setIsFetchingTokens(true);
    try {
      const coins = await suiClient.getAllBalances({ owner: address });
      const suiData = await fetchSuiPriceUSD();
      let totalUsd = 0;
      const KNOWN_TOKENS = {
        "0x2::sui::SUI": {
          symbol: "SUI",
          decimals: 9,
          price: suiData.price,
          change24h: suiData.change,
          icon: "/assets/images/sui-icon.png",
        },
        "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN": {
          symbol: "USDC",
          decimals: 6,
          price: 1.0,
          change24h: 0,
          icon: "/assets/images/usdc-icon.png",
        },
      };

      const displayTokens: Record<string, any> = {
        "0x2::sui::SUI": {
          ...KNOWN_TOKENS["0x2::sui::SUI"],
          balance: 0,
          value: 0,
          type: "0x2::sui::SUI",
        },
        "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN": {
          ...KNOWN_TOKENS["0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN"],
          balance: 0,
          value: 0,
          type: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
        },
      };

      for (const coin of coins) {
        const type = coin.coinType;
        const meta = KNOWN_TOKENS[type as keyof typeof KNOWN_TOKENS] || {
          symbol: type.split("::").pop() || "UNK",
          decimals: 9,
          price: 0,
          change24h: 0,
          icon: "/assets/images/sui-icon.png",
        };
        const balance = Number(coin.totalBalance) / Math.pow(10, meta.decimals);
        const value = balance * (meta.price || 0);

        if (balance > 0 || displayTokens[type]) {
          displayTokens[type] = { ...meta, balance, value, type };
          totalUsd += value;
        }
      }

      setWalletBalanceUSD(totalUsd.toFixed(2));
      const tokenList = Object.values(displayTokens);
      setTokens(tokenList);
      lastFetchedRef.current = now;
    } finally {
      setIsFetchingTokens(false);
    }
  }, [address, suiClient, fetchSuiPriceUSD]);

  const debouncedFetchBalance = useMemo(() => debounce(fetchBalance, 500), [fetchBalance]);

  useEffect(() => {
    // Clear data and reset fetch timer when address changes
    setWalletBalanceUSD("0.00");
    setTokens([]);
    lastFetchedRef.current = null;
    
    if (address) {
      debouncedFetchBalance();
      const interval = setInterval(fetchBalance, 60_000);
      return () => clearInterval(interval);
    }
  }, [address, debouncedFetchBalance, fetchBalance]);

  return { walletBalanceUSD, tokens, isFetchingTokens, fetchBalance };
};
