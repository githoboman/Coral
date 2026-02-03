// src/components/CheckInCard.tsx
//
// Daily check-in card component for the Account page
// Shows status, allows check-in, displays countdown timer
// Updated to match the Account page UI style

import { useEffect, useState } from "react";
import { Calendar, Check, Clock } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useCheckin } from "@/hooks/useCheckIn";

interface CheckInCardProps {
  onPointsUpdated?: (newBalance: number) => void;
}

export const CheckInCard = ({ onPointsUpdated }: CheckInCardProps) => {
  const { checkin, checkinState, refetchStatus } = useCheckin(onPointsUpdated);
  const [timeDisplay, setTimeDisplay] = useState<string>("");

  // Update countdown timer every minute
  useEffect(() => {
    if (
      !checkinState.canCheckin &&
      checkinState.nextAvailableAt &&
      checkinState.status === "cooldown"
    ) {
      const updateTimer = () => {
        const now = Date.now();
        const remaining = checkinState.nextAvailableAt! - now;

        if (remaining <= 0) {
          setTimeDisplay("Ready to check in!");
          refetchStatus();
          return;
        }

        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor(
          (remaining % (1000 * 60 * 60)) / (1000 * 60),
        );

        setTimeDisplay(`${hours}h ${minutes}m`);
      };

      updateTimer();
      const interval = setInterval(updateTimer, 60000); // Update every minute

      return () => clearInterval(interval);
    }
  }, [
    checkinState.canCheckin,
    checkinState.nextAvailableAt,
    checkinState.status,
    refetchStatus,
  ]);

  const handleCheckin = async () => {
    await checkin();
  };

  const getButtonState = () => {
    if (checkinState.status === "checking") {
      return {
        disabled: true,
        text: "Loading...",
        icon: <LoadingSpinner size="sm" />,
      };
    }

    if (
      checkinState.status === "requesting" ||
      checkinState.status === "signing"
    ) {
      return {
        disabled: true,
        text: "Preparing...",
        icon: <LoadingSpinner size="sm" />,
      };
    }

    if (checkinState.status === "confirming") {
      return {
        disabled: true,
        text: "Confirming...",
        icon: <LoadingSpinner size="sm" />,
      };
    }

    if (checkinState.status === "success") {
      return {
        disabled: true,
        text: "Checked In ✓",
        icon: <Check className="w-4 h-4" />,
      };
    }

    if (checkinState.status === "cooldown" || !checkinState.canCheckin) {
      return {
        disabled: true,
        text: timeDisplay || "Come Back Later",
        icon: <Clock className="w-4 h-4" />,
      };
    }

    return {
      disabled: false,
      text: "Check In",
      icon: <Calendar className="w-4 h-4" />,
    };
  };

  const buttonState = getButtonState();

  return (
    <div className="bg-white/5 rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors group/checkin h-full flex flex-col">
      {/* Header */}
      <div className="mb-3">
        <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
          Daily Check-In
        </p>
        <p className="text-sm text-white/60">+2 points every 24h</p>
      </div>

      {/* Status Message - compact */}
      <div className="mb-3 flex-grow">
        {checkinState.status === "success" && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Check className="w-4 h-4" />
            <span className="font-medium">
              +{checkinState.pointsEarned} earned!
            </span>
          </div>
        )}

        {checkinState.status === "error" && checkinState.error && (
          <div className="text-red-400 text-sm">
            <p className="font-medium">{checkinState.error}</p>
          </div>
        )}

        {(checkinState.status === "cooldown" ||
          (!checkinState.canCheckin && checkinState.status === "idle")) &&
          checkinState.hoursRemaining !== null && (
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <Clock className="w-4 h-4" />
              <span>{timeDisplay} remaining</span>
            </div>
          )}

        {checkinState.canCheckin && checkinState.status === "idle" && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Check className="w-4 h-4" />
            <span className="font-medium">Ready!</span>
          </div>
        )}
      </div>

      {/* Check-in Button */}
      <button
        onClick={handleCheckin}
        disabled={buttonState.disabled}
        className={`w-full py-2.5 px-4 rounded-lg font-bold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2 ${
          buttonState.disabled
            ? "bg-white/5 cursor-not-allowed opacity-60"
            : "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 hover:scale-[1.02] active:scale-[0.98] shadow-md hover:shadow-green-500/20"
        }`}
      >
        {buttonState.icon}
        <span>{buttonState.text}</span>
      </button>

      {/* Last check-in info - compact */}
      {checkinState.lastCheckinAt && checkinState.status !== "success" && (
        <div className="mt-2 text-center text-xs text-white/30">
          Last:{" "}
          {new Date(checkinState.lastCheckinAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
};
