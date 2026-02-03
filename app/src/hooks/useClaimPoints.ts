// src/hooks/useClaimPoints.ts  —  FIXED
//
// Changes from previous version:
//   1. signAndExecute result.digest is captured and forwarded to pollForClaim.
//   2. pollForClaim accepts the digest and appends it as ?tx_digest= on the
//      FIRST poll only.  The backend's check-claim-status fast path picks it
//      up, calls verifyClaimByDigest, and returns the confirmed balance from
//      the actual transaction receipt — no devInspect, no latency.
//   3. The first poll fires IMMEDIATELY (no initial interval delay).  This
//      means the digest-based verification runs as soon as the tx is confirmed,
//      typically resolving on the very first attempt.

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

  // ---------------------------------------------------------------------------
  // pollForClaim  —  accepts the tx digest so the first poll can use it
  // ---------------------------------------------------------------------------
  const pollForClaim = useCallback(
    async (wallet: string, expectedPts: number, txDigest: string) => {
      const maxAttempts = 10;
      let attempt = 0;

      console.log("⏳ Polling for confirmation...");

      const doPoll = async () => {
        attempt++;
        try {
          // First poll: attach digest → backend verifies via receipt (instant).
          // Subsequent polls: omit digest → backend falls back to event scan.
          const digestParam =
            attempt === 1 ? `&tx_digest=${encodeURIComponent(txDigest)}` : "";

          const res = await fetch(
            `${API_BASE}/api/auth/check-claim-status?wallet_address=${encodeURIComponent(wallet)}${digestParam}`,
          );
          const data = await res.json();

          console.log(`📊 Poll attempt ${attempt}:`, data);

          if (data.claimed || data.balance > 0) {
            // ── success ──
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            console.log("✅ Claim confirmed on-chain!");
            setState({
              status: "success",
              ticketObjectId: null,
              pointsAmount: expectedPts,
              error: null,
              balance: data.balance,
            });
            return true; // signal: done
          }
        } catch (_) {
          console.log(`⚠️  Poll attempt ${attempt} failed`);
        }

        if (attempt >= maxAttempts) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          console.log("⏰ Polling timeout - showing optimistic success");
          setState({
            status: "success",
            ticketObjectId: null,
            pointsAmount: expectedPts,
            error: null,
            balance: expectedPts,
          });
          return true; // signal: done
        }

        return false; // signal: keep polling
      };

      // Fire immediately (attempt 1 — digest fast path), then every 1.5 s.
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

  // ---------------------------------------------------------------------------
  // claimPoints  —  orchestrates verify → sign → poll
  // ---------------------------------------------------------------------------
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

      console.log("🎯 Starting claim process for:", currentAccount.address);

      setState({
        status: "verifying",
        ticketObjectId: null,
        pointsAmount: 0,
        error: null,
        balance: 0,
      });

      try {
        // --------------------------------------------------------------
        // Step 1: Verify email & get ticket
        // --------------------------------------------------------------
        console.log("📧 Verifying email:", email);
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
        console.log("✅ Verification response:", verifyData);

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

        console.log("🎟️  Ticket received:", ticketId);

        setState((prev) => ({
          ...prev,
          status: "signing",
          ticketObjectId: ticketId,
          pointsAmount: ptsAmount,
        }));

        // --------------------------------------------------------------
        // Step 2: Build & sign transaction
        // --------------------------------------------------------------
        const tx = new Transaction();
        tx.setGasBudget(10_000_000); // 0.01 SUI

        console.log("🔨 Building transaction with:");
        console.log("  Package:", PACKAGE_ID);
        console.log("  Registry:", POINTS_REGISTRY);
        console.log("  Ticket:", ticketId);
        console.log("  Sender:", currentAccount.address);

        tx.moveCall({
          target: `${PACKAGE_ID}::points::claim_waitlist_points`,
          arguments: [
            tx.object(POINTS_REGISTRY), // &mut PointsRegistry
            tx.object(ticketId), // EligibilityTicket (owned by caller)
            tx.object("0x6"), // Clock
          ],
        });

        console.log("📝 Requesting wallet signature...");

        const result = await signAndExecute(
          { transaction: tx },
          {
            onSuccess: (data) => {
              console.log("✅ Transaction successful:", data);
            },
            onError: (error) => {
              console.error("❌ Transaction failed:", error);
            },
          },
        );

        console.log("✅ Transaction result:", result);
        console.log("📋 Digest:", result.digest);

        setState((prev) => ({ ...prev, status: "confirming" }));

        // --------------------------------------------------------------
        // Step 3: Poll — pass digest so the first poll resolves instantly
        // --------------------------------------------------------------
        await pollForClaim(currentAccount.address, ptsAmount, result.digest);
      } catch (err: any) {
        console.error("❌ Claim error:", err);

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
