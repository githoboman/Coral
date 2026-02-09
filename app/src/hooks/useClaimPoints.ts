import { useState, useCallback, useRef } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || "";
const POINTS_REGISTRY = import.meta.env.VITE_POINTS_REGISTRY_ID || "";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export type ClaimStatus =
  | "idle"
  | "verifying"
  | "signing"
  | "confirming"
  | "success"
  | "error";

export interface ClaimState {
  status: ClaimStatus;
  ticketObjectId: string | null;
  pointsAmount: number;
  error: string | null;
  balance: number;
}

export function useClaimPoints() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [state, setState] = useState<ClaimState>({
    status: "idle",
    ticketObjectId: null,
    pointsAmount: 0,
    error: null,
    balance: 0,
  });

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setState({
      status: "idle",
      ticketObjectId: null,
      pointsAmount: 0,
      error: null,
      balance: 0,
    });
  }, []);

  const pollForClaim = useCallback(
    async (wallet: string, expectedPts: number, txDigest: string) => {
      const maxAttempts = 10;
      let attempt = 0;

      const doPoll = async () => {
        attempt++;
        try {
          const digestParam =
            attempt === 1 ? `&tx_digest=${encodeURIComponent(txDigest)}` : "";

          const res = await fetch(
            `${API_BASE}/api/auth/check-claim-status?wallet_address=${encodeURIComponent(wallet)}${digestParam}`,
          );
          const data = await res.json();

          if (data.claimed || data.balance > 0) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setState({
              status: "success",
              ticketObjectId: null,
              pointsAmount: expectedPts,
              error: null,
              balance: data.balance,
            });

            window.dispatchEvent(new Event("pointsUpdated"));

            return true;
          }
        } catch (_) { }

        if (attempt >= maxAttempts) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setState({
            status: "success",
            ticketObjectId: null,
            pointsAmount: expectedPts,
            error: null,
            balance: expectedPts,
          });

          window.dispatchEvent(new Event("pointsUpdated"));

          return true;
        }

        return false;
      };

      const done = await doPoll();
      if (done) return;

      pollRef.current = setInterval(async () => {
        const done = await doPoll();
        if (done && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 1500);
    },
    [],
  );

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
        ticketObjectId: null,
        pointsAmount: 0,
        error: null,
        balance: 0,
      });

      try {
        const verifyRes = await fetch(
          `${API_BASE}/api/auth/verify-and-issue-ticket`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email.toLowerCase().trim(),
              wallet_address: currentAccount.address,
            }),
          },
        );

        const verifyData = await verifyRes.json();

        if (!verifyRes.ok || !verifyData.eligible) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: verifyData.message || verifyData.detail || "Not eligible",
          }));
          return;
        }

        const ticketId = verifyData.ticket_object_id as string;
        const ptsAmount = verifyData.points_amount as number;

        setState((prev) => ({
          ...prev,
          status: "signing",
          ticketObjectId: ticketId,
          pointsAmount: ptsAmount,
        }));

        const tx = new Transaction();
        tx.setGasBudget(10_000_000);

        tx.moveCall({
          target: `${PACKAGE_ID}::points::claim_waitlist_points`,
          arguments: [
            tx.object(POINTS_REGISTRY),
            tx.object(ticketId),
            tx.object("0x6"),
          ],
        });

        const result = await signAndExecute(
          { transaction: tx },
          {
            onSuccess: () => { },
            onError: () => { },
          },
        );

        setState((prev) => ({ ...prev, status: "confirming" }));

        await pollForClaim(currentAccount.address, ptsAmount, result.digest);
      } catch (err: any) {
        let errorMsg = "Transaction failed. Please try again.";
        if (err?.message) {
          if (err.message.includes("User rejected")) {
            errorMsg = "Transaction was cancelled.";
          } else if (err.message.includes("MoveAbort")) {
            errorMsg = "Smart contract error. Please contact support.";
          } else {
            errorMsg = err.message;
          }
        }

        setState((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
      }
    },
    [currentAccount?.address, signAndExecute, pollForClaim],
  );

  return { claimPoints, claimState: state, reset };
}
