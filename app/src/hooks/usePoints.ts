import { useState, useEffect, useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

// Module-level cache: fetch once per wallet per app session
const pointsCache = new Map<string, { points: number; hasClaimed: boolean }>();

export function usePoints() {
  const currentAccount = useCurrentAccount();
  const walletAddr = currentAccount?.address || "";
  const cached = walletAddr ? pointsCache.get(walletAddr) : undefined;

  const [points, setPoints] = useState<number>(cached?.points ?? 0);
  const [hasClaimed, setHasClaimed] = useState<boolean>(cached?.hasClaimed ?? false);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const addr = currentAccount?.address;
    if (!addr) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [accountRes, claimRes] = await Promise.all([
        fetch(`${API_BASE}/api/account/${encodeURIComponent(addr)}`, { credentials: 'include' }),
        fetch(
          `${API_BASE}/api/auth/check-claim-status?wallet_address=${encodeURIComponent(addr)}`,
          { credentials: 'include' }
        ),
      ]);

      let newPoints = 0;
      let newHasClaimed = false;

      if (accountRes.ok) {
        const data = await accountRes.json();
        newPoints = data.points || 0;
      }

      if (claimRes.ok) {
        const data = await claimRes.json();
        newHasClaimed = data.claimed || false;
        if (!accountRes.ok && data.balance) newPoints = data.balance;
      }

      pointsCache.set(addr, { points: newPoints, hasClaimed: newHasClaimed });
      setPoints(newPoints);
      setHasClaimed(newHasClaimed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load points");
    } finally {
      setLoading(false);
    }
  }, [currentAccount?.address]);

  useEffect(() => {
    // Only fetch if we don't already have cached data for this wallet
    if (currentAccount?.address && !pointsCache.has(currentAccount.address)) {
      fetchAll();
    }
  }, [currentAccount?.address, fetchAll]);

  return {
    points,
    hasClaimed,
    loading,
    error,
    refetch: fetchAll,
  };
}
