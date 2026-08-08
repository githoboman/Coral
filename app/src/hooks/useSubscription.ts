import { useState, useEffect, useCallback } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || "";
const SUBSCRIPTION_REGISTRY =
  import.meta.env.VITE_SUI_SUBSCRIPTION_REGISTRY_ID || "";
const PREMIUM_PRICE = 2_000_000_000;

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

// Module-level cache: fetch once per wallet per app session
const subscriptionCache = new Map<string, SubscriptionState>();

export function useSubscription() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  const walletAddr = currentAccount?.address || "";
  const cached = walletAddr ? subscriptionCache.get(walletAddr) : undefined;

  const [state, setState] = useState<SubscriptionState>(
    cached || {
      status: "idle",
      isPremium: false,
      tier: 0,
      startedAt: null,
      expiresAt: null,
      daysRemaining: null,
      dailyPromptsUsed: 0,
      dailyPromptsLimit: 2,
      error: null,
    },
  );

  const fetchSubscriptionStatus = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({ ...prev, status: "idle", isPremium: false }));
      return;
    }

    setState((prev) => ({ ...prev, status: "loading" }));

    try {
      const API_BASE =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      const response = await fetch(
        `${API_BASE}/api/subscription/status?wallet_address=${encodeURIComponent(currentAccount.address)}`,
        { credentials: 'include' },
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

      const newState: SubscriptionState = {
        status: "idle",
        isPremium,
        tier: data.tier || 0,
        startedAt: data.started_at ? Number(data.started_at) : null,
        expiresAt,
        daysRemaining: isPremium ? daysRemaining : null,
        dailyPromptsUsed: data.daily_prompts_used || 0,
        dailyPromptsLimit: isPremium ? 5 : 2,
        error: null,
      };

      subscriptionCache.set(currentAccount.address, newState);
      setState(newState);
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
    // Only fetch if we don't already have cached data for this wallet
    if (currentAccount?.address && !subscriptionCache.has(currentAccount.address)) {
      fetchSubscriptionStatus();
    }
  }, [currentAccount?.address, fetchSubscriptionStatus]);

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

      const [paymentCoin] = tx.splitCoins(tx.gas, [PREMIUM_PRICE]);

      tx.moveCall({
        target: `${PACKAGE_ID}::subscriptions::subscribe_premium`,
        arguments: [
          tx.object(SUBSCRIPTION_REGISTRY),
          paymentCoin,
          tx.object("0x6"),
        ],
      });

      setState((prev) => ({ ...prev, status: "confirming" }));

      const result = await signAndExecuteTransaction(
        {
          transaction: tx,
        },
        {
          onSuccess: () => { },
          onError: () => { },
        },
      );



      let isSuccess = false;
      let errorMsg = "";

      const resultAny = result as any;



      if (
        resultAny.effects &&
        typeof resultAny.effects === "object" &&
        resultAny.effects.status
      ) {
        if (resultAny.effects.status.status === "success") {
          isSuccess = true;

        } else if (resultAny.effects.status.status === "failure") {
          isSuccess = false;
          errorMsg = resultAny.effects.status.error || "Transaction failed";

        } else if (typeof resultAny.effects.status === "string") {
          isSuccess = resultAny.effects.status === "success";
          errorMsg = resultAny.effects.error || "";

        }
      } else if (typeof result.effects === "string" && resultAny.rawEffects) {


        if (
          Array.isArray(resultAny.rawEffects) &&
          resultAny.rawEffects.length > 2
        ) {
          const format = resultAny.rawEffects[1];



          if (format === 0) {
            isSuccess = true;
          } else if (format === 1) {
            const executionStatus = resultAny.rawEffects[2];


            if (executionStatus === 0) {
              isSuccess = true;

            } else {
              isSuccess = false;

              const errorMessages: Record<number, string> = {
                7: "Insufficient SUI balance. You need at least 2.01 SUI (2 SUI + gas fees).",
              };

              errorMsg =
                errorMessages[executionStatus] ||
                `Transaction failed with error code ${executionStatus}`;

            }
          } else {

            isSuccess = !!(
              resultAny.objectChanges && resultAny.objectChanges.length > 0
            );
            if (!isSuccess) {
              errorMsg = "Unknown transaction format";
            }
          }
        } else {

          isSuccess = !!(
            resultAny.objectChanges && resultAny.objectChanges.length > 0
          );
          if (!isSuccess) {
            errorMsg = "Transaction status unclear";
          }
        }
      } else {

        if (result.digest && resultAny.objectChanges?.length > 0) {
          isSuccess = true;

        } else {
          isSuccess = false;
          errorMsg = "Unable to verify transaction success";

        }
      }



      if (!isSuccess) {
        console.error("❌ Transaction failed on-chain");


        let userFriendlyError = "Subscription failed. Please try again.";
        const errorStr = String(errorMsg).toLowerCase();

        if (
          errorStr.includes("insufficient") &&
          (errorStr.includes("coin") || errorStr.includes("balance"))
        ) {
          userFriendlyError =
            "Insufficient SUI balance. You need at least 2.01 SUI (2 SUI + gas fees).";
        } else if (errorStr.includes("gas")) {
          userFriendlyError =
            "Not enough SUI for gas fees. Please add more SUI to your wallet.";
        } else if (errorStr.includes("insufficient_payment")) {
          userFriendlyError = "Payment amount is insufficient. 2 SUI required.";
        } else if (errorMsg) {
          userFriendlyError = `Transaction failed: ${errorMsg}`;
        }

        setState((prev) => ({
          ...prev,
          status: "error",
          error: userFriendlyError,
        }));

        return;
      }

      try {


        setState((prev) => ({
          ...prev,
          status: "success",
          error: null,
        }));


        await new Promise((resolve) => setTimeout(resolve, 2000));


        try {
          await fetchSubscriptionStatus();

        } catch (refreshError) {
          console.warn(
            "⚠️ Failed to refresh subscription status, but transaction succeeded:",
            refreshError,
          );
        }

        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            status: "idle",
            error: null,
          }));
        }, 3000);
      } catch (postSuccessError) {
        console.error("⚠️ Error in post-success processing:", postSuccessError);
      }
    } catch (error: any) {
      console.error("Subscription failed:", error);

      let errorMsg = "Subscription failed. Please try again.";

      if (error?.message) {
        const msg = error.message.toLowerCase();

        if (
          msg.includes("user rejected") ||
          msg.includes("rejected") ||
          msg.includes("cancelled")
        ) {
          errorMsg = "Transaction was cancelled.";
        } else if (
          msg.includes("insufficient") &&
          (msg.includes("coin") || msg.includes("balance"))
        ) {
          errorMsg =
            "Insufficient SUI balance. You need at least 2.01 SUI (2 SUI + gas fees).";
        } else if (msg.includes("gas")) {
          errorMsg =
            "Not enough SUI for gas fees. Please add more SUI to your wallet.";
        } else if (msg.includes("insufficient_payment")) {
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
