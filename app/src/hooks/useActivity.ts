import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { sileo } from "sileo";

export type TransactionType = "sent" | "received" | "transaction" | "failed";

export interface EnrichedTransaction {
  digest: string;
  timestampMs?: string | null;
  txType: TransactionType;
  netSUI: number;
  effects?: any;
  transaction?: any;
  balanceChanges?: any[] | null;
}

// Module-level cache: keyed by wallet address
const activityCache = new Map<string, EnrichedTransaction[]>();

export function useActivity(address: string | null) {
  const cached = address ? activityCache.get(address) : undefined;
  const [activity, setActivity] = useState<EnrichedTransaction[]>(cached || []);
  const [isFetchingActivity, setIsFetchingActivity] = useState(false);
  const isFetchingActivityRef = useRef(false);

  const suiClient = useMemo(() => {
    const network = (import.meta.env.VITE_SUI_NETWORK || "testnet") as
      | "testnet"
      | "mainnet";
    return new SuiClient({
      url: getFullnodeUrl(network),
    });
  }, []);

  const fetchActivity = useCallback(async () => {
    if (!address || isFetchingActivityRef.current) return;

    isFetchingActivityRef.current = true;
    setIsFetchingActivity(true);

    try {
      const [sentResult, receivedResult] = await Promise.all([
        suiClient.queryTransactionBlocks({
          filter: { FromAddress: address },
          options: {
            showEffects: true,
            showBalanceChanges: true,
            showInput: true,
          },
          limit: 25,
          order: "descending",
        }),
        suiClient.queryTransactionBlocks({
          filter: { ToAddress: address },
          options: {
            showEffects: true,
            showBalanceChanges: true,
            showInput: true,
          },
          limit: 25,
          order: "descending",
        }),
      ]);

      const seen = new Set<string>();
      const merged = [...sentResult.data, ...receivedResult.data].filter(
        (tx) => {
          if (seen.has(tx.digest)) return false;
          seen.add(tx.digest);
          return true;
        },
      );

      merged.sort(
        (a, b) => Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0),
      );

      const enriched: EnrichedTransaction[] = merged.slice(0, 30).map((tx) => {
        const isSuccess = tx.effects?.status?.status === "success";
        const sender = tx.transaction?.data?.sender;
        const isSender = sender === address;

        const suiChange = tx.balanceChanges?.find((change) => {
          const owner = change.owner;
          return (
            owner &&
            typeof owner === "object" &&
            "AddressOwner" in owner &&
            (owner as { AddressOwner: string }).AddressOwner === address &&
            change.coinType === "0x2::sui::SUI"
          );
        });

        const netSUIMIST = suiChange ? Number(suiChange.amount) : 0;
        let netSUI = netSUIMIST / 1_000_000_000;

        if (netSUI === 0 && tx.effects?.gasUsed) {
          const { computationCost, storageCost, storageRebate } =
            tx.effects.gasUsed;
          const gasMIST =
            Number(computationCost) +
            Number(storageCost) -
            Number(storageRebate);
          netSUI = -gasMIST / 1_000_000_000;
        }

        let txType: TransactionType;
        if (!isSuccess) {
          txType = "failed";
        } else if (!isSender && netSUIMIST > 0) {
          txType = "received";
        } else if (isSender) {
          const recipientGotSUI = tx.balanceChanges?.some((change) => {
            const owner = change.owner;
            return (
              owner &&
              typeof owner === "object" &&
              "AddressOwner" in owner &&
              (owner as { AddressOwner: string }).AddressOwner !== address &&
              change.coinType === "0x2::sui::SUI" &&
              Number(change.amount) > 0
            );
          });
          txType = recipientGotSUI ? "sent" : "transaction";
        } else {
          txType = "transaction";
        }

        return { ...tx, txType, netSUI };
      });

      activityCache.set(address, enriched);
      setActivity(enriched);
    } catch (err) {
      console.error("[Activity] Failed to fetch transactions:", err);
      sileo.error({
        title: "Failed to load activity",
        description: "Could not fetch recent transactions.",
      });
    } finally {
      isFetchingActivityRef.current = false;
      setIsFetchingActivity(false);
    }
  }, [address, suiClient]);

  /** Only fetches if no cached data exists for the current address */
  const fetchActivityIfNeeded = useCallback(() => {
    if (address && !activityCache.has(address)) {
      fetchActivity();
    }
  }, [address, fetchActivity]);
  
  const clearActivity = useCallback(() => {
    setActivity([]);
    if (address) activityCache.delete(address);
  }, [address]);

  // Restore cached data when address changes
  useEffect(() => {
    if (address && activityCache.has(address)) {
      setActivity(activityCache.get(address)!);
    } else {
      setActivity([]);
    }
  }, [address]);

  return {
    activity,
    isFetchingActivity,
    fetchActivity,
    fetchActivityIfNeeded,
    clearActivity,
    suiClient
  };
}
