import { useState, useCallback, useRef, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || "";
const POINTS_REGISTRY = import.meta.env.VITE_POINTS_REGISTRY_ID || "";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export type CheckinStatus =
  | "idle"
  | "checking"
  | "requesting"
  | "signing"
  | "confirming"
  | "success"
  | "error"
  | "cooldown";

export interface CheckinState {
  status: CheckinStatus;
  canCheckin: boolean;
  lastCheckinDate: string | null; // YYYY-MM-DD
  lastCheckinAt: number | null; // Timestamp (for backward compat)
  nextAvailableAt: number | null; // Midnight timestamp
  hoursRemaining: number | null; // Hours until midnight
  pointsEarned: number;
  error: string | null;
  balance: number;
  currentStreak: number;
  totalCheckins: number;
  nextStreak: number;
  streakWillReset: boolean;
  nextCheckinPoints: number;
  nextIsMilestone: boolean;
  nextMilestone: number;
  daysToNextMilestone: number;
}

export function useCheckin(onPointsUpdated?: (newBalance: number) => void) {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [state, setState] = useState<CheckinState>({
    status: "idle",
    canCheckin: false,
    lastCheckinDate: null,
    lastCheckinAt: null,
    nextAvailableAt: null,
    hoursRemaining: null,
    pointsEarned: 0,
    error: null,
    balance: 0,
    currentStreak: 0,
    totalCheckins: 0,
    nextStreak: 1,
    streakWillReset: false,
    nextCheckinPoints: 1,
    nextIsMilestone: false,
    nextMilestone: 5,
    daysToNextMilestone: 5,
  });

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Get timezone offset in minutes
  const getTimezoneOffset = useCallback(() => {
    return new Date().getTimezoneOffset() * -1; // Convert to positive offset
  }, []);

  const fetchStatus = useCallback(async () => {
    const addr = currentAccount?.address;
    if (!addr) return;

    setState((prev) => ({ ...prev, status: "checking" }));

    try {
      const timezoneOffset = getTimezoneOffset();
      const res = await fetch(
        `${API_BASE}/api/checkin/status?wallet_address=${encodeURIComponent(addr)}&timezone_offset=${timezoneOffset}`,
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch status: ${res.statusText}`);
      }

      const data = await res.json();

      setState((prev) => ({
        ...prev,
        status: data.can_checkin ? "idle" : "cooldown",
        canCheckin: data.can_checkin,
        lastCheckinDate: data.last_checkin_date,
        lastCheckinAt: data.last_checkin_at,
        nextAvailableAt: data.next_available_at, // This is midnight timestamp
        hoursRemaining: data.hours_remaining, // Hours until midnight
        balance: data.balance,
        currentStreak: data.current_streak || 0,
        totalCheckins: data.total_checkins || 0,
        nextStreak: data.next_streak || 1,
        streakWillReset: data.streak_will_reset || false,
        nextCheckinPoints: data.next_checkin_points || 1,
        nextIsMilestone: data.next_is_milestone || false,
        nextMilestone: data.next_milestone || 5,
        daysToNextMilestone: data.days_to_next_milestone || 5,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to fetch status",
      }));
    }
  }, [currentAccount?.address, getTimezoneOffset]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const pollForConfirmation = useCallback(
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

          if (data.balance > 0) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            setState((prev) => ({
              ...prev,
              status: "success",
              canCheckin: false,
              lastCheckinAt: Date.now(),
              nextAvailableAt: Date.now() + 24 * 60 * 60 * 1000, // Approximate
              hoursRemaining: 24,
              pointsEarned: expectedPts,
              error: null,
              balance: data.balance,
              currentStreak: prev.nextStreak,
            }));

            if (onPointsUpdated) {
              onPointsUpdated(data.balance);
            }

            setTimeout(fetchStatus, 2000);

            return true;
          }
        } catch (_) {}

        if (attempt >= maxAttempts) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }

          setState((prev) => ({
            ...prev,
            status: "success",
            canCheckin: false,
            pointsEarned: expectedPts,
            error: null,
            balance: prev.balance + expectedPts,
            currentStreak: prev.nextStreak,
          }));

          if (onPointsUpdated) {
            onPointsUpdated(expectedPts);
          }

          setTimeout(fetchStatus, 2000);

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
    [fetchStatus, onPointsUpdated],
  );

  const checkin = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Wallet not connected",
      }));
      return;
    }

    if (!state.canCheckin && state.status !== "idle") {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `You've already checked in today. Next check-in available at midnight (in ${state.hoursRemaining}h).`,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: "requesting",
      error: null,
    }));

    try {
      const timezoneOffset = getTimezoneOffset();
      const ticketRes = await fetch(`${API_BASE}/api/checkin/request-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: currentAccount.address,
          timezone_offset: timezoneOffset,
        }),
      });

      const ticketData = await ticketRes.json();

      if (!ticketRes.ok || !ticketData.success) {
        setState((prev) => ({
          ...prev,
          status: ticketData.can_checkin === false ? "cooldown" : "error",
          error: ticketData.message || "Failed to get check-in ticket",
          hoursRemaining: ticketData.hours_remaining || null,
        }));
        return;
      }

      const ticketId = ticketData.ticket_object_id as string;
      const ptsAmount = ticketData.points_amount as number;
      const isMilestone = ticketData.is_milestone as boolean;
      const milestoneBonus = ticketData.milestone_bonus as number;

      setState((prev) => ({
        ...prev,
        status: "signing",
      }));

      const tx = new Transaction();
      tx.setGasBudget(10_000_000);

      tx.moveCall({
        target: `${PACKAGE_ID}::points::checkin`,
        arguments: [
          tx.object(POINTS_REGISTRY),
          tx.object(ticketId),
          tx.object("0x6"),
        ],
      });

      const result = await signAndExecute(
        { transaction: tx },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      );

      setState((prev) => ({ ...prev, status: "confirming" }));

      await pollForConfirmation(
        currentAccount.address,
        ptsAmount,
        result.digest,
      );

      // Show milestone celebration if applicable
      if (isMilestone) {
        console.log(
          `🎉 Milestone reached! Earned ${ptsAmount} points (${ptsAmount - milestoneBonus} base + ${milestoneBonus} bonus)`,
        );
      }
    } catch (err: any) {
      let errorMsg = "Check-in failed. Please try again.";
      if (err?.message) {
        if (err.message.includes("User rejected")) {
          errorMsg = "Transaction was cancelled.";
        } else if (err.message.includes("EAlreadyCheckedInToday")) {
          errorMsg =
            "You've already checked in today. Next check-in available at midnight.";
        } else {
          errorMsg = err.message;
        }
      }

      setState((prev) => ({
        ...prev,
        status: "error",
        error: errorMsg,
      }));

      setTimeout(fetchStatus, 1000);
    }
  }, [
    currentAccount?.address,
    state.canCheckin,
    state.status,
    state.hoursRemaining,
    signAndExecute,
    pollForConfirmation,
    fetchStatus,
    getTimezoneOffset,
  ]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchStatus();
  }, [fetchStatus]);

  return {
    checkin,
    checkinState: state,
    refetchStatus: fetchStatus,
    reset,
  };
}
