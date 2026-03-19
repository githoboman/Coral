import { useState, useCallback, useRef, useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export type CheckinStatus =
  | "idle"
  | "checking"
  | "requesting"
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

  /**
   * Returns the user's timezone offset in minutes (positive = east of UTC).
   * e.g. UTC+1 → 60, UTC-5 → -300
   */
  const getTimezoneOffset = useCallback(() => {
    return new Date().getTimezoneOffset() * -1;
  }, []);

  /**
   * Returns Unix ms of the next local midnight for the user.
   * Mirrors the backend `nextLocalMidnightMs` function exactly so the
   * cooldown timer shown in the UI matches when the server will allow
   * the next check-in.
   */
  const getNextLocalMidnightMs = useCallback((tzOffsetMinutes: number): number => {
    const localMs = Date.now() + tzOffsetMinutes * 60_000;
    const d = new Date(localMs);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1); // roll to tomorrow 00:00 local
    return d.getTime() - tzOffsetMinutes * 60_000; // convert back to UTC ms
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
        { signal: abortControllerRef.current.signal, credentials: 'include' },
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
      if (err.name === "AbortError") return;

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

    setState((prev) => ({ ...prev, status: "requesting", error: null }));

    try {
      const timezoneOffset = getTimezoneOffset();
      const res = await fetch(`${API_BASE}/api/checkin/perform`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: currentAccount.address,
          timezone_offset: timezoneOffset,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setState((prev) => ({
          ...prev,
          status: data.can_checkin === false ? "cooldown" : "error",
          error: data.message || "Failed to perform check-in",
          hoursRemaining: data.hours_remaining || null,
        }));
        return;
      }

      const ptsEarned = data.points_earned as number;
      const tzOffset = getTimezoneOffset();
      const nextAvailableAt = getNextLocalMidnightMs(tzOffset);
      const hoursRemaining = Math.ceil(
        (nextAvailableAt - Date.now()) / (1000 * 60 * 60),
      );

      setState((prev) => ({
        ...prev,
        status: "success",
        canCheckin: false,
        lastCheckinAt: Date.now(),
        nextAvailableAt,
        hoursRemaining,
        pointsEarned: ptsEarned,
        error: null,
        balance: data.balance,
        currentStreak: data.new_streak,
        totalCheckins: prev.totalCheckins + 1,
      }));

      if (onPointsUpdated) {
        onPointsUpdated(data.balance);
      }

      import("sileo").then(({ sileo }) => {
        sileo.success({
          title: "Check-in Successful!",
          description: `Earned ${ptsEarned} point${ptsEarned !== 1 ? "s" : ""}. Keep your streak going!`,
        });
      });

      window.dispatchEvent(new Event("pointsUpdated"));
      setTimeout(fetchStatus, 2000);

    } catch (err: any) {
      let errorMsg = "Check-in failed. Please try again.";

      if (err?.message) {
        if (err.message.includes("AlreadyCheckedInToday")) {
          errorMsg = "You've already checked in today. Next check-in available at midnight.";
        } else {
          errorMsg = err.message;
        }
      }

      console.error("[CHECKIN]", errorMsg);

      if (err.name !== "AbortError") {
        import("sileo").then(({ sileo }) => {
          sileo.error({ title: "Check-in Failed", description: errorMsg });
        });
      }

      setState((prev) => ({ ...prev, status: "error", error: errorMsg }));
      setTimeout(fetchStatus, 1000);
    }
  }, [
    currentAccount?.address,
    state.canCheckin,
    state.status,
    state.hoursRemaining,
    fetchStatus,
    getNextLocalMidnightMs,
    getTimezoneOffset,
    onPointsUpdated,
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