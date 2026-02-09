import { useState, useEffect, useCallback } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || "";
const SUBSCRIPTION_REGISTRY =
  import.meta.env.VITE_SUI_SUBSCRIPTION_REGISTRY_ID || "";
const PREMIUM_PRICE = 2_000_000_000; // 2 SUI in MIST

export type SubscriptionStatus =
  | "idle"
  | "loading"
  | "signing"
  | "confirming"
  | "success"
  | "error";

export interface SubscriptionState {
  status: SubscriptionStatus;
  isPremium: boolean;
  tier: number;
  startedAt: number | null;
  expiresAt: number | null;
  daysRemaining: number | null;
  dailyPromptsUsed: number;
  dailyPromptsLimit: number;
  error: string | null;
}

export function useSubscription() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  const [state, setState] = useState<SubscriptionState>({
    status: "idle",
    isPremium: false,
    tier: 0,
    startedAt: null,
    expiresAt: null,
    daysRemaining: null,
    dailyPromptsUsed: 0,
    dailyPromptsLimit: 2, // Free tier default
    error: null,
  });

  const fetchSubscriptionStatus = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({ ...prev, status: "idle", isPremium: false }));
      return;
    }

    setState((prev) => ({ ...prev, status: "loading" }));

    try {
      // Fetch subscription status from backend API
      const API_BASE =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      const response = await fetch(
        `${API_BASE}/api/subscription/status?wallet_address=${encodeURIComponent(currentAccount.address)}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch subscription status");
      }

      const data = await response.json();

      const now = Date.now();
      const expiresAt = data.expires_at ? Number(data.expires_at) : null;
      const isPremium = Boolean(
        data.tier === 1 && expiresAt && expiresAt > now,
      );
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
        : null;

      setState({
        status: "idle",
        isPremium,
        tier: data.tier || 0,
        startedAt: data.started_at ? Number(data.started_at) : null,
        expiresAt,
        daysRemaining: isPremium ? daysRemaining : null,
        dailyPromptsUsed: data.daily_prompts_used || 0,
        dailyPromptsLimit: isPremium ? 5 : 2,
        error: null,
      });
    } catch (error: any) {
      console.error("Error fetching subscription:", error);
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error.message || "Failed to fetch subscription status",
      }));
    }
  }, [currentAccount?.address]);

  useEffect(() => {
    fetchSubscriptionStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchSubscriptionStatus, 30000);

    return () => clearInterval(interval);
  }, [fetchSubscriptionStatus]);

  const subscribeToPremium = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Wallet not connected",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: "signing",
      error: null,
    }));

    try {
      const tx = new Transaction();
      tx.setGasBudget(20_000_000);

      // Split coins for subscription payment
      const [paymentCoin] = tx.splitCoins(tx.gas, [PREMIUM_PRICE]);

      tx.moveCall({
        target: `${PACKAGE_ID}::subscriptions::subscribe_premium`,
        arguments: [
          tx.object(SUBSCRIPTION_REGISTRY),
          paymentCoin,
          tx.object("0x6"), // Clock object
        ],
      });

      setState((prev) => ({ ...prev, status: "confirming" }));

      const result = await signAndExecuteTransaction(
        { transaction: tx },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      );

      console.log("Subscription transaction:", result.digest);

      // Wait a moment for blockchain to update
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh subscription status
      await fetchSubscriptionStatus();

      setState((prev) => ({
        ...prev,
        status: "success",
      }));

      // Reset to idle after showing success
      setTimeout(() => {
        setState((prev) => ({ ...prev, status: "idle" }));
      }, 3000);
    } catch (error: any) {
      console.error("Subscription failed:", error);

      let errorMsg = "Subscription failed. Please try again.";

      if (error?.message) {
        if (error.message.includes("User rejected")) {
          errorMsg = "Transaction was cancelled.";
        } else if (
          error.message.includes("Insufficient") ||
          error.message.includes("InsufficientCoinBalance")
        ) {
          errorMsg =
            "Insufficient SUI balance. You need at least 2.01 SUI (2 SUI + gas fees).";
        } else if (error.message.includes("E_INSUFFICIENT_PAYMENT")) {
          errorMsg = "Payment amount is insufficient. 2 SUI required.";
        } else {
          errorMsg = error.message;
        }
      }

      setState((prev) => ({
        ...prev,
        status: "error",
        error: errorMsg,
      }));
    }
  }, [
    currentAccount?.address,
    signAndExecuteTransaction,
    fetchSubscriptionStatus,
  ]);

  return {
    subscriptionState: state,
    subscribeToPremium,
    refreshStatus: fetchSubscriptionStatus,
  };
}
