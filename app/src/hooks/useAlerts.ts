import { useState, useEffect, useCallback } from "react";

export interface WalletEvent {
  id: number;
  wallet_address: string;
  event_type: "token_received" | "balance_change" | "nft_transfer" | "staking_reward" | "token_sent" | "other";
  event_data: Record<string, any>;
  processed: boolean;
  created_at: string;
}

export function useAlerts(addresses: string[]) {
  const [events, setEvents] = useState<WalletEvent[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (addresses.length === 0) {
      setEvents([]);
      return;
    }

    setIsFetching(true);
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      
      // Fetch events for each address
      const allEventsPromises = addresses.map(async (addr) => {
        try {
          const res = await fetch(`${baseUrl}/api/proactive/events?wallet_address=${addr}`, {
            credentials: 'include'
          });
          if (!res.ok) return [];
          const data = await res.json();
          return data.events || [];
        } catch (err) {
          console.error(`Failed to fetch events for ${addr}:`, err);
          return [];
        }
      });

      const eventsArrays = await Promise.all(allEventsPromises);
      const mergedEvents = eventsArrays.flat();
      
      // Sort by created_at descending
      mergedEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setEvents(mergedEvents);
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    } finally {
      setIsFetching(false);
    }
  }, [addresses]);

  useEffect(() => {
    fetchAlerts();
    // Refresh every 30 seconds
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  return { events, isFetching, refetch: fetchAlerts };
}
