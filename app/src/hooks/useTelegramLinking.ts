import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export interface TelegramStatus {
  is_linked: boolean;
  telegram_username?: string;
  telegram_chat_id?: string;
}

export function useTelegramLinking() {
  const account = useCurrentAccount();

  // Initialize from cache if available
  const [status, setStatus] = useState<TelegramStatus>(() => {
    if (!account?.address) return { is_linked: false };
    const cached = localStorage.getItem(`telegram_status_${account.address}`);
    return cached ? JSON.parse(cached) : { is_linked: false };
  });

  const [loading, setLoading] = useState(false); // Action loading
  const [initialLoading, setInitialLoading] = useState(true); // Initial fetch loading
  const [error, setError] = useState<string | null>(null);

  // Update cache helper
  const updateStatus = useCallback((newStatus: TelegramStatus) => {
    setStatus(newStatus);
    if (account?.address) {
      localStorage.setItem(`telegram_status_${account.address}`, JSON.stringify(newStatus));
    }
  }, [account?.address]);

  const fetchStatus = useCallback(async () => {
    if (!account?.address) return;

    // Only set initial loading if we don't have a cache
    const hasCache = !!localStorage.getItem(`telegram_status_${account.address}`);
    if (!hasCache) setInitialLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/telegram/status?walletAddress=${account.address}`);
      if (res.ok) {
        const data = await res.json();
        const currentCache = localStorage.getItem(`telegram_status_${account.address}`);

        // Only update if changed to avoid renders
        if (JSON.stringify(data) !== currentCache) {
          updateStatus(data);
        }
      } else {
        console.warn("Telegram status check failed:", res.status);
      }
    } catch (e) {
      console.error("Failed to fetch telegram status", e);
    } finally {
      setInitialLoading(false);
    }
  }, [account, updateStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connectTelegram = async (): Promise<{ code: string, botUsername: string } | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/telegram/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: account?.address })
      });

      if (res.ok) {
        const data = await res.json();
        return data;
      } else {
        throw new Error("Failed to generate connection code");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to connect Telegram");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const disconnectTelegram = async () => {
    if (!account?.address) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/telegram/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: account.address })
      });
      updateStatus({ is_linked: false });
    } catch (e) {
      console.error(e);
      setError("Failed to disconnect Telegram");
    } finally {
      setLoading(false);
    }
  };

  return {
    status,
    connectTelegram,
    disconnectTelegram,
    loading: loading || (initialLoading && !status.is_linked), // Show loading if actioning OR (fetching AND no cache/not linked)
    error,
    refetch: fetchStatus
  };
}
