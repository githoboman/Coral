import { useState, useCallback, useRef, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || "";
const POINTS_REGISTRY = import.meta.env.VITE_POINTS_REGISTRY_ID || "";
const FEE_CONFIG = import.meta.env.VITE_FEE_CONFIG_ID || "";
const SUBSCRIPTION_REGISTRY =
  import.meta.env.VITE_SUI_SUBSCRIPTION_REGISTRY_ID || "";

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
  lastCheckinDate: string | null;
  lastCheckinAt: number | null;
  nextAvailableAt: number | null;
  hoursRemaining: number | null;
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
  checkinFee: number;
}

export function useCheckin(onPointsUpdated?: (newBalance: number) => void) {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [state, setState] = useState<CheckinState>({
    status: "checking",
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
    checkinFee: 2_000_000,
  });

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getTimezoneOffset = useCallback(() => {
    return new Date().getTimezoneOffset() * -1;
  }, []);

  const fetchStatus = useCallback(async () => {
    const addr = currentAccount?.address;
    if (!addr) {
      setState((prev) => ({ ...prev, status: "idle" }));
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    setState((prev) => ({ ...prev, status: "checking" }));

    try {
      const timezoneOffset = getTimezoneOffset();
      const res = await fetch(
        `${API_BASE}/api/checkin/status?wallet_address=${encodeURIComponent(addr)}&timezone_offset=${timezoneOffset}`,
        { signal: abortControllerRef.current.signal },
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
        nextAvailableAt: data.next_available_at,
        hoursRemaining: data.hours_remaining,
        balance: data.balance,
        currentStreak: data.current_streak || 0,
        totalCheckins: data.total_checkins || 0,
        nextStreak: data.next_streak || 1,
        streakWillReset: data.streak_will_reset || false,
        nextCheckinPoints: data.next_checkin_points || 1,
        nextIsMilestone: data.next_is_milestone || false,
        nextMilestone: data.next_milestone || 5,
        daysToNextMilestone: data.days_to_next_milestone || 5,
        checkinFee: data.checkin_fee || 2_000_000,
        error: null,
      }));
    } catch (err: any) {
      if (err.name === "AbortError") {
        return;
      }

      setState((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to fetch status",
      }));
    }
  }, [currentAccount?.address, getTimezoneOffset]);

  useEffect(() => {
    fetchStatus();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
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

            const tzOffset = getTimezoneOffset();
            const now = new Date();
            const userMs = now.getTime() + tzOffset * 60_000;
            const d = new Date(userMs);
            d.setUTCHours(0, 0, 0, 0);
            d.setUTCDate(d.getUTCDate() + 1);
            const nextMidnight = d.getTime() - tzOffset * 60_000;
            const hrsRemaining = Math.ceil((nextMidnight - Date.now()) / (1000 * 60 * 60));

            setState((prev) => ({
              ...prev,
              status: "success",
              canCheckin: false,
              lastCheckinAt: Date.now(),
              nextAvailableAt: nextMidnight,
              hoursRemaining: hrsRemaining,
              pointsEarned: expectedPts,
              error: null,
              balance: data.balance,
              currentStreak: prev.nextStreak,
              totalCheckins: prev.totalCheckins + 1,
            }));

            if (onPointsUpdated) {
              onPointsUpdated(data.balance);
            }

            import("sileo").then(({ sileo }) => {
              sileo.success({
                title: "Check-in Successful!",
                description: `Earned ${expectedPts} point${expectedPts !== 1 ? "s" : ""}. Keep your streak going!`,
              });
            });

            window.dispatchEvent(new Event("pointsUpdated"));

            setTimeout(fetchStatus, 2000);

            return true;
          }
        } catch (_) { }

        if (attempt >= maxAttempts) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }

          const tzOffsetFallback = getTimezoneOffset();
          const nowFallback = new Date();
          const userMsFallback = nowFallback.getTime() + tzOffsetFallback * 60_000;
          const dFallback = new Date(userMsFallback);
          dFallback.setUTCHours(0, 0, 0, 0);
          dFallback.setUTCDate(dFallback.getUTCDate() + 1);
          const nextMidnightFallback = dFallback.getTime() - tzOffsetFallback * 60_000;
          const hrsRemainingFallback = Math.ceil((nextMidnightFallback - Date.now()) / (1000 * 60 * 60));

          setState((prev) => ({
            ...prev,
            status: "success",
            canCheckin: false,
            lastCheckinAt: Date.now(),
            nextAvailableAt: nextMidnightFallback,
            hoursRemaining: hrsRemainingFallback,
            pointsEarned: expectedPts,
            error: null,
            balance: prev.balance + expectedPts,
            currentStreak: prev.nextStreak,
            totalCheckins: prev.totalCheckins + 1,
          }));

          if (onPointsUpdated) {
            onPointsUpdated(expectedPts);
          }

          import("sileo").then(({ sileo }) => {
            sileo.success({
              title: "Check-in Successful!",
              description: `Earned ${expectedPts} point${expectedPts !== 1 ? "s" : ""}. Keep your streak going!`,
            });
          });

          window.dispatchEvent(new Event("pointsUpdated"));

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

      const checkinFee = ticketData.checkin_fee as number;

      setState((prev) => ({
        ...prev,
        status: "signing",
      }));

      const tx = new Transaction();
      tx.setGasBudget(10_000_000);

      const [feeCoin] = tx.splitCoins(tx.gas, [checkinFee]);

      tx.moveCall({
        target: `${PACKAGE_ID}::points::checkin`,
        arguments: [
          tx.object(POINTS_REGISTRY),
          tx.object(SUBSCRIPTION_REGISTRY),
          tx.object(ticketId),
          tx.object(FEE_CONFIG),
          feeCoin,
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

      await pollForConfirmation(
        currentAccount.address,
        ptsAmount,
        result.digest,
      );

      if (isMilestone) {
      }
    } catch (err: any) {
      let errorMsg = "Check-in failed. Please try again.";
      if (err?.message) {
        if (err.message.includes("User rejected")) {
          errorMsg = "Transaction was cancelled.";
        } else if (err.message.includes("EAlreadyCheckedInToday")) {
          errorMsg =
            "You've already checked in today. Next check-in available at midnight.";
        } else if (
          err.message.includes("Insufficient") ||
          err.message.includes("InsufficientCoinBalance")
        ) {
          errorMsg = `Insufficient SUI balance. You need at least ${(state.checkinFee / 1_000_000_000).toFixed(3)} SUI for the check-in fee plus gas.`;
        } else if (err.message.includes("EInsufficientPayment")) {
          errorMsg = `Check-in fee payment failed. Required: ${(state.checkinFee / 1_000_000_000).toFixed(3)} SUI`;
        } else {
          errorMsg = err.message;
        }
      }

      console.error(errorMsg);
      // Only show toast checks that are not silent/background if we want, but user asked for "show the toast letting the user know"
      // The error state is also set, but a toast is more visible.
      if (err.name !== "AbortError") {
        import("sileo").then(({ sileo }) => {
          sileo.error({ title: "Check-in Failed", description: errorMsg });
        });
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
    state.checkinFee,
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
