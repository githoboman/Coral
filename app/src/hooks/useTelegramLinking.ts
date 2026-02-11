import { useState, useEffect, useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export interface TelegramStatus {
  is_linked: boolean;
  telegram_chat_id?: string;
  telegram_username?: string;
}

export function useTelegramLinking() {
  const currentAccount = useCurrentAccount();
  const [status, setStatus] = useState<TelegramStatus>({ is_linked: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const addr = currentAccount?.address;
    if (!addr) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/telegram/status/${encodeURIComponent(addr)}`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error("Error fetching Telegram status:", err);
    } finally {
      setLoading(false);
    }
  }, [currentAccount?.address]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connectTelegram = async () => {
    const addr = currentAccount?.address;
    if (!addr) {
      setError("Wallet not connected");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/telegram/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: addr }),
      });

      if (!response.ok) throw new Error("Failed to generate linking token");

      const { deep_link } = await response.json();

      // Open Telegram in a new tab
      window.open(deep_link, "_blank");

      // Start polling for status update
      const pollInterval = setInterval(async () => {
        const checkRes = await fetch(`${API_BASE}/api/telegram/status/${encodeURIComponent(addr)}`);
        if (checkRes.ok) {
          const data = await checkRes.json();
          if (data.is_linked) {
            setStatus(data);
            clearInterval(pollInterval);
          }
        }
      }, 3000);

      // Stop polling after 2 minutes
      setTimeout(() => clearInterval(pollInterval), 120000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setLoading(false);
    }
  };

  const disconnectTelegram = async () => {
    const addr = currentAccount?.address;
    if (!addr) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/telegram/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: addr }),
      });

      if (response.ok) {
        setStatus({ is_linked: false });
      }
    } catch (err) {
      console.error("Disconnect failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return {
    status,
    loading,
    error,
    connectTelegram,
    disconnectTelegram,
    refreshStatus: fetchStatus,
  };
}