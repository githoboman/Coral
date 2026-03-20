import { useState, useEffect, useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export function usePoints() {
  const currentAccount = useCurrentAccount();
  const [points, setPoints] = useState<number>(0);
  const [hasClaimed, setHasClaimed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
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

      if (accountRes.ok) {
        const data = await accountRes.json();
        setPoints(data.points || 0);
      }

      if (claimRes.ok) {
        const data = await claimRes.json();
        setHasClaimed(data.claimed || false);
        if (!accountRes.ok && data.balance) setPoints(data.balance);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load points");
    } finally {
      setLoading(false);
    }
  }, [currentAccount?.address]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    points,
    hasClaimed,
    loading,
    error,
    refetch: fetchAll,
  };
}
