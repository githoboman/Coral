// src/hooks/usePoints.ts  —  UPDATED
//
// Fetches points balance AND claim status from the backend
// (which reads them from the on-chain PointsRegistry).
//
// Exposes:
//   points        – current balance
//   hasClaimed    – whether waitlist points have been claimed
//   loading / error
//   refetch       – manual re-fetch (call after claim succeeds)

import { useState, useEffect, useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export function usePoints() {
  const currentAccount = useCurrentAccount();
  const [points, setPoints] = useState<number>(0);
  const [hasClaimed, setHasClaimed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Core fetch  — hits /account/:id for balance and /check-claim-status for flag
  // ---------------------------------------------------------------------------
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
        fetch(`${API_BASE}/api/account/${encodeURIComponent(addr)}`),
        fetch(
          `${API_BASE}/api/auth/check-claim-status?wallet_address=${encodeURIComponent(addr)}`,
        ),
      ]);

      // Balance (may 404 if user hasn't been registered yet — that's fine)
      if (accountRes.ok) {
        const data = await accountRes.json();
        setPoints(data.points || 0);
      }

      // Claim status (always 200)
      if (claimRes.ok) {
        const data = await claimRes.json();
        setHasClaimed(data.claimed || false);
        // If claim status shows a balance but account didn't, use it
        if (!accountRes.ok && data.balance) setPoints(data.balance);
      }
    } catch (err) {
      console.error("usePoints fetch error:", err);
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
