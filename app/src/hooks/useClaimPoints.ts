import { useState, useCallback, useRef } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export type ClaimStatus =
  | "idle"
  | "verifying"
  | "claiming"
  | "success"
  | "error";

export interface ClaimState {
  status: ClaimStatus;
  pointsAmount: number;
  error: string | null;
  balance: number;
  transactionDigest: string | null;
}

export function useClaimPoints() {
  const currentAccount = useCurrentAccount();

  const [state, setState] = useState<ClaimState>({
    status: "idle",
    pointsAmount: 0,
    error: null,
    balance: 0,
    transactionDigest: null,
  });

  const reset = useCallback(() => {
    setState({
      status: "idle",
      pointsAmount: 0,
      error: null,
      balance: 0,
      transactionDigest: null,
    });
  }, []);

  const claimPoints = useCallback(
    async (email: string) => {
      if (!currentAccount?.address) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: "Wallet not connected",
        }));
        return;
      }

      setState({
        status: "verifying",
        pointsAmount: 0,
        error: null,
        balance: 0,
        transactionDigest: null,
      });

      try {
        console.log(
          `🚀 Claiming waitlist points for ${currentAccount.address}...`,
        );

        // Call the sponsored claim endpoint (backend handles everything)
        const claimRes = await fetch(
          `${API_BASE}/api/auth/claim-waitlist-points`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email.toLowerCase().trim(),
              wallet_address: currentAccount.address,
            }),
          },
        );

        const claimData = await claimRes.json();

        if (!claimRes.ok || !claimData.success) {
          // Handle specific error cases
          if (claimData.already_claimed) {
            setState((prev) => ({
              ...prev,
              status: "error",
              error: "You have already claimed your waitlist points.",
            }));
            return;
          }

          if (!claimData.eligible) {
            setState((prev) => ({
              ...prev,
              status: "error",
              error: claimData.message || "Not eligible for waitlist points.",
            }));
            return;
          }

          setState((prev) => ({
            ...prev,
            status: "error",
            error: claimData.detail || claimData.message || "Claim failed",
          }));
          return;
        }

        // Success! Points have been claimed
        console.log("✅ Points claimed successfully:", claimData);

        setState({
          status: "success",
          pointsAmount: claimData.points_awarded || 100,
          balance: claimData.new_balance || 100,
          error: null,
          transactionDigest: claimData.transaction_digest || null,
        });

        // Notify other components that points were updated
        window.dispatchEvent(new Event("pointsUpdated"));
      } catch (err: any) {
        console.error("❌ Claim error:", err);

        let errorMsg = "Failed to claim points. Please try again.";
        if (err?.message) {
          errorMsg = err.message;
        }

        setState((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
      }
    },
    [currentAccount?.address],
  );

  return { claimPoints, claimState: state, reset };
}
