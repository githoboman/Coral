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

      // ✅ Check transaction success using Sui SDK response
      let isSuccess = false;
      let errorMsg = "";

      const resultAny = result as any;

      // Log what we actually got to debug
      console.log("📊 Checking result structure:");
      console.log("  - effects type:", typeof result.effects);
      console.log("  - effects:", result.effects);
      console.log("  - rawEffects present:", !!resultAny.rawEffects);
      console.log("  - objectChanges:", resultAny.objectChanges?.length || 0);

      // The Sui SDK response structure varies by version:
      // 1. effects.status.status === "success" (newer parsed format)
      // 2. effects is a base64 string with rawEffects array (your version)
      // 3. Check objectChanges as fallback

      if (
        resultAny.effects &&
        typeof resultAny.effects === "object" &&
        resultAny.effects.status
      ) {
        // Case 1: Parsed effects object (newer SDK versions)
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
        // Case 2: Base64 encoded effects with rawEffects array (SDK v1.38)
        console.log("📊 Parsing rawEffects (SDK v1.38 format)");

        // rawEffects BCS encoding structure:
        // OLD FORMAT: [1, 1, execution_status, ...]
        //   [0] = version (1)
        //   [1] = format (1)
        //   [2] = execution_status: 0 = Success, >0 = Failure
        //
        // NEW FORMAT: [1, 0, gas_low, gas_high, ...]
        //   [0] = version (1)
        //   [1] = format (0) - indicates new format
        //   [2-5] = gas used (little-endian u32)
        //   Execution status is implicit (this format only used for successful txns)

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
            // NEW FORMAT - execution status is implicit success
            isSuccess = true;
            const gasUsed =
              resultAny.rawEffects[2] + (resultAny.rawEffects[3] << 8);
            console.log(
              "✅ Transaction successful (new format, gas used:",
              gasUsed,
              ")",
            );
          } else if (format === 1) {
            // OLD FORMAT - execution status at byte[2]
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

              // Map error codes to user-friendly messages
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
            // Unknown format
            console.log("⚠️ Unknown format byte:", format);
            isSuccess = !!(
              resultAny.objectChanges && resultAny.objectChanges.length > 0
            );
            if (!isSuccess) {
              errorMsg = "Unknown transaction format";
            }
          }
        } else {
          // Fallback if rawEffects format is unexpected
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
        // Case 3: Unknown format - use fallback checks
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

        // Parse common error patterns for user-friendly messages
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

        return; // Exit early, don't show success
      }

      // ✅ Transaction succeeded on-chain - wrap in try-catch to prevent any post-processing errors
      try {
        console.log("✅ Subscription transaction succeeded on-chain");

        // Set success state immediately
        setState((prev) => ({
          ...prev,
          status: "success",
          error: null,
        }));

        // Wait a moment for blockchain to update
        console.log("⏳ Waiting for blockchain to update...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Refresh subscription status
        console.log("🔄 Refreshing subscription status...");
        try {
          await fetchSubscriptionStatus();
          console.log("✅ Subscription status refreshed successfully");
        } catch (refreshError) {
          console.warn(
            "⚠️ Failed to refresh subscription status, but transaction succeeded:",
            refreshError,
          );
          // Don't override success state if refresh fails
        }

        // Keep success state visible for 3 seconds
        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            status: "idle",
            error: null, // Clear any error
          }));
        }, 3000);
      } catch (postSuccessError) {
        console.error("⚠️ Error in post-success processing:", postSuccessError);
        // Transaction already succeeded, so maintain success state
        // Just log the error but don't change the UI state
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
