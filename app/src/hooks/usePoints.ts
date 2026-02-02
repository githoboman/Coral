// src/hooks/usePoints.ts - NEW HOOK FOR FETCHING POINTS FROM BLOCKCHAIN
import { useState, useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

export function usePoints() {
  const currentAccount = useCurrentAccount();
  const [points, setPoints] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

  useEffect(() => {
    const fetchPoints = async () => {
      if (!currentAccount?.address) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${apiBaseUrl}/api/account/${encodeURIComponent(currentAccount.address)}`,
        );

        if (!response.ok) {
          throw new Error("Failed to fetch points");
        }

        const data = await response.json();
        setPoints(data.points || 0);
      } catch (err) {
        console.error("Error fetching points:", err);
        setError(err instanceof Error ? err.message : "Failed to load points");
        setPoints(0);
      } finally {
        setLoading(false);
      }
    };

    fetchPoints();
  }, [currentAccount?.address, apiBaseUrl]);

  const refetch = async () => {
    if (!currentAccount?.address) return;

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/account/${encodeURIComponent(currentAccount.address)}`,
      );

      if (response.ok) {
        const data = await response.json();
        setPoints(data.points || 0);
      }
    } catch (err) {
      console.error("Error refetching points:", err);
    }
  };

  return {
    points,
    loading,
    error,
    refetch,
  };
}
