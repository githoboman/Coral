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
  const [status, setStatus] = useState<TelegramStatus>({ is_linked: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await fetch(`${API_BASE}/api/telegram/status?walletAddress=${account.address}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        // Fallback or ignore if endpoint missing (since backend might be gone)
        console.warn("Telegram status check failed:", res.status);
      }
    } catch (e) {
      console.error("Failed to fetch telegram status", e);
    }
  }, [account]);

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
      setStatus({ is_linked: false });
      await fetchStatus();
    } catch (e) {
      console.error(e);
      setError("Failed to disconnect Telegram");
    } finally {
      setLoading(false);
    }
  };

  return { status, connectTelegram, disconnectTelegram, loading, error, refetch: fetchStatus };
}
