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
    dailyPromptsLimit: 2,
    error: null,
  });

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
          onSuccess: () => {},
          onError: () => {},
        },
      );

      console.log("Subscription transaction:", result.digest);
      console.log("Full transaction result:", JSON.stringify(result, null, 2));

      let isSuccess = false;
      let errorMsg = "";

      const resultAny = result as any;

      console.log("📊 Checking result structure:");
      console.log("  - effects type:", typeof result.effects);
      console.log("  - effects:", result.effects);
      console.log("  - rawEffects present:", !!resultAny.rawEffects);
      console.log("  - objectChanges:", resultAny.objectChanges?.length || 0);

      if (
        resultAny.effects &&
        typeof resultAny.effects === "object" &&
        resultAny.effects.status
      ) {
        if (resultAny.effects.status.status === "success") {
          isSuccess = true;
          console.log(
            "✅ Transaction successful (effects.status.status === 'success')",
          );
        } else if (resultAny.effects.status.status === "failure") {
          isSuccess = false;
          errorMsg = resultAny.effects.status.error || "Transaction failed";
          console.log(
            "❌ Transaction failed (effects.status.status === 'failure')",
          );
          console.log("Error:", errorMsg);
        } else if (typeof resultAny.effects.status === "string") {
          isSuccess = resultAny.effects.status === "success";
          errorMsg = resultAny.effects.error || "";
          console.log(
            "✅ Transaction status (string):",
            resultAny.effects.status,
          );
        }
      } else if (typeof result.effects === "string" && resultAny.rawEffects) {
        console.log("📊 Parsing rawEffects (SDK v1.38 format)");

        if (
          Array.isArray(resultAny.rawEffects) &&
          resultAny.rawEffects.length > 2
        ) {
          const version = resultAny.rawEffects[0];
          const format = resultAny.rawEffects[1];

          console.log("  - Version:", version);
          console.log("  - Format:", format);
          console.log(
            "  - rawEffects[0-15]:",
            resultAny.rawEffects.slice(0, 16),
          );

          if (format === 0) {
            isSuccess = true;
            const gasUsed =
              resultAny.rawEffects[2] + (resultAny.rawEffects[3] << 8);
            console.log(
              "✅ Transaction successful (new format, gas used:",
              gasUsed,
              ")",
            );
          } else if (format === 1) {
            const executionStatus = resultAny.rawEffects[2];
            console.log(
              "  - Execution status (rawEffects[2]):",
              executionStatus,
            );

            if (executionStatus === 0) {
              isSuccess = true;
              console.log(
                "✅ Transaction successful (old format, execution status === 0)",
              );
            } else {
              isSuccess = false;

              const errorMessages: Record<number, string> = {
                7: "Insufficient SUI balance. You need at least 2.01 SUI (2 SUI + gas fees).",
              };

              errorMsg =
                errorMessages[executionStatus] ||
                `Transaction failed with error code ${executionStatus}`;
              console.log(
                "❌ Transaction failed (execution status ===",
                executionStatus,
                ")",
              );
              console.log("Error:", errorMsg);
            }
          } else {
            console.log("⚠️ Unknown format byte:", format);
            isSuccess = !!(
              resultAny.objectChanges && resultAny.objectChanges.length > 0
            );
            if (!isSuccess) {
              errorMsg = "Unknown transaction format";
            }
          }
        } else {
          console.log(
            "⚠️ Unexpected rawEffects format, using objectChanges fallback",
          );
          isSuccess = !!(
            resultAny.objectChanges && resultAny.objectChanges.length > 0
          );
          if (!isSuccess) {
            errorMsg = "Transaction status unclear";
          }
        }
      } else {
        console.log("⚠️ Unknown effects format, using fallback checks");
        if (result.digest && resultAny.objectChanges?.length > 0) {
          isSuccess = true;
          console.log("✅ Transaction successful (digest + objectChanges)");
        } else {
          isSuccess = false;
          errorMsg = "Unable to verify transaction success";
          console.log("❌ Unable to verify transaction status");
        }
      }

      console.log(
        "🎯 Final determination - isSuccess:",
        isSuccess,
        "errorMsg:",
        errorMsg,
      );

      if (!isSuccess) {
        console.error("❌ Transaction failed on-chain");
        console.log("Error details:", errorMsg);

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
        console.log("✅ Subscription transaction succeeded on-chain");

        setState((prev) => ({
          ...prev,
          status: "success",
          error: null,
        }));

        console.log("⏳ Waiting for blockchain to update...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log("🔄 Refreshing subscription status...");
        try {
          await fetchSubscriptionStatus();
          console.log("✅ Subscription status refreshed successfully");
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
