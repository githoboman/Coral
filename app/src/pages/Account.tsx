import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useCheckin } from "@/hooks/useCheckIn";
import { Flame, Trophy, Calendar, Coins } from "lucide-react";
import { SkeletonBox } from "@/components/ui/SkeletonLoader";

const Account = () => {
  const currentAccount = useCurrentAccount();
  const { checkin, checkinState, refetchStatus } = useCheckin();
  const [showMilestoneAnimation, setShowMilestoneAnimation] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (checkinState.status === "success" && checkinState.nextIsMilestone) {
      setShowMilestoneAnimation(true);
      setTimeout(() => setShowMilestoneAnimation(false), 3000);
    }
  }, [checkinState.status, checkinState.nextIsMilestone]);

  useEffect(() => {
    if (checkinState.status !== "checking" && checkinState.status !== "idle") {
      setIsInitialLoad(false);
    } else if (checkinState.balance > 0 || checkinState.totalCheckins > 0) {
      setIsInitialLoad(false);
    }
  }, [checkinState]);

  const getMilestoneProgress = () => {
    const { currentStreak, nextMilestone, daysToNextMilestone } = checkinState;
    const progress = ((currentStreak / nextMilestone) * 100).toFixed(0);
    return { progress, daysRemaining: daysToNextMilestone };
  };

  const getStreakColor = (streak: number) => {
    if (streak >= 80) return "from-purple-500 to-pink-500";
    if (streak >= 50) return "from-orange-500 to-red-500";
    if (streak >= 30) return "from-yellow-500 to-orange-500";
    if (streak >= 10) return "from-green-500 to-emerald-500";
    return "from-blue-500 to-cyan-500";
  };

  const formatSUI = (mist: number) => {
    return (mist / 1_000_000_000).toFixed(3);
  };

  const { progress, daysRemaining } = getMilestoneProgress();

  if (isInitialLoad && checkinState.status === "checking") {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-6">
        {/* Header Skeleton */}
        <div className="mb-8">
          <SkeletonBox className="h-9 w-32 mb-2" />
          <SkeletonBox className="h-5 w-96" />
        </div>

        {/* Daily Check-in Card Skeleton */}
        <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-8 mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div className="flex-1">
              <SkeletonBox className="h-8 w-48 mb-2" />
              <SkeletonBox className="h-5 w-96" />
            </div>
            <SkeletonBox className="h-14 w-40 rounded-full" />
          </div>

          {/* Streak Stats Row Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-2xl p-6"
              >
                <div className="flex items-center gap-3">
                  <SkeletonBox className="w-10 h-10 rounded-full" />
                  <div className="flex-1">
                    <SkeletonBox className="h-3 w-24 mb-2" />
                    <SkeletonBox className="h-7 w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Milestone Progress Skeleton */}
          <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                <SkeletonBox className="h-6 w-40 mb-2" />
                <SkeletonBox className="h-4 w-64" />
              </div>
              <div className="text-right">
                <SkeletonBox className="h-3 w-20 mb-2" />
                <SkeletonBox className="h-7 w-16" />
              </div>
            </div>
            <SkeletonBox className="h-4 w-full rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      {/* Milestone Celebration Animation */}
      {showMilestoneAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-3xl p-8 text-center animate-in zoom-in-95 duration-500">
            <Trophy className="w-20 h-20 mx-auto mb-4 text-white animate-bounce" />
            <h2 className="text-3xl font-bold text-white mb-2">
              🎉 Milestone Reached!
            </h2>
            <p className="text-white/90 text-lg">
              {checkinState.currentStreak} Day Streak - Earned{" "}
              {checkinState.pointsEarned} Points!
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Account</h1>
        <p className="text-white/60 mt-2">
          Manage your daily check-ins and track your progress
        </p>
      </div>

      {/* Daily Check-in Card */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-8 mb-6 relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-500/10 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Daily Check-in
              </h2>
              <p className="text-white/60 text-sm">
                {checkinState.canCheckin
                  ? checkinState.streakWillReset
                    ? "⚠️ Your streak will reset! Check in now to continue."
                    : `Ready to earn ${checkinState.nextCheckinPoints} point${checkinState.nextCheckinPoints > 1 ? "s" : ""}!`
                  : `Next check-in available in ${checkinState.hoursRemaining} hour${checkinState.hoursRemaining !== 1 ? "s" : ""}`}
              </p>
              {/* Show fee */}
              {/* {checkinState.canCheckin && (
                <p className="text-white/40 text-xs mt-1 flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  Check-in fee: {formatSUI(checkinState.checkinFee)} SUI
                </p>
              )} */}
            </div>

            <button
              onClick={checkin}
              disabled={
                !checkinState.canCheckin ||
                checkinState.status === "requesting" ||
                checkinState.status === "signing" ||
                checkinState.status === "confirming"
              }
              className={`
                px-8 py-4 rounded-full font-bold text-sm transition-all
                ${
                  checkinState.canCheckin && checkinState.status === "idle"
                    ? checkinState.nextIsMilestone
                      ? "bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-black shadow-lg shadow-yellow-500/30 animate-pulse"
                      : "bg-[#246AFC] hover:bg-[#1a55cc] text-white shadow-lg shadow-blue-500/20"
                    : "bg-white/10 text-white/40 cursor-not-allowed"
                }
              `}
            >
              {checkinState.status === "requesting" && "Requesting..."}
              {checkinState.status === "signing" && "Sign Transaction..."}
              {checkinState.status === "confirming" && "Confirming..."}
              {checkinState.status === "success" && "✓ Checked In!"}
              {checkinState.status === "idle" && checkinState.canCheckin && (
                <>
                  {checkinState.nextIsMilestone ? "🎯 " : ""}
                  Check In
                  {checkinState.nextIsMilestone && " for Milestone!"}
                </>
              )}
              {checkinState.status === "cooldown" &&
                `Wait ${checkinState.hoursRemaining}h`}
              {checkinState.status === "error" && "Try Again"}
            </button>
          </div>

          {/* Error Message */}
          {checkinState.error && (
            <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
              <p className="text-red-400 text-sm">{checkinState.error}</p>
            </div>
          )}

          {/* Streak Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* Points Balance */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider">
                    Total Points
                  </p>
                  <p className="text-white text-2xl font-bold">
                    {checkinState.balance.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
            {/* Current Streak */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${getStreakColor(checkinState.currentStreak)} flex items-center justify-center`}
                >
                  <Flame className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider">
                    Current Streak
                  </p>
                  <p className="text-white text-2xl font-bold">
                    {checkinState.currentStreak}
                    <span className="text-white/40 text-sm ml-1">days</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Total Check-ins */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider">
                    Total Check-ins
                  </p>
                  <p className="text-white text-2xl font-bold">
                    {checkinState.totalCheckins}
                    <span className="text-white/40 text-sm ml-1">times</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Milestone Progress */}
          <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-white font-bold text-lg">Next Milestone</p>
                  <p className="text-white/60 text-sm">
                    {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} until{" "}
                    {checkinState.nextMilestone}-day milestone
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">
                  Bonus Reward
                </p>
                <p className="text-green-400 text-2xl font-bold">+5 pts</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-4 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`absolute top-0 left-0 h-full bg-gradient-to-r ${getStreakColor(checkinState.currentStreak)} transition-all duration-500 rounded-full`}
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-xs font-bold drop-shadow-lg">
                  {checkinState.currentStreak} / {checkinState.nextMilestone}
                </span>
              </div>
            </div>

            {/* Upcoming Milestones */}
            <div className="mt-6 pt-6 border-t border-white/5">
              <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-3">
                Upcoming Milestones
              </p>
              <div className="flex flex-wrap gap-2">
                {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((milestone) => (
                  <div
                    key={milestone}
                    className={`
                      px-3 py-1.5 rounded-full text-xs font-bold border transition-all
                      ${
                        checkinState.currentStreak >= milestone
                          ? "bg-green-500/20 border-green-500/50 text-green-400"
                          : milestone === checkinState.nextMilestone
                            ? "bg-green-500/20 border-green-500/50 text-green-400 animate-pulse"
                            : "bg-white/5 border-white/10 text-white/40"
                      }
                    `}
                  >
                    {checkinState.currentStreak >= milestone && "✓ "}
                    {milestone} days
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Streak Reset Warning */}
          {checkinState.streakWillReset && checkinState.canCheckin && (
            <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-red-400 text-xl">⚠️</span>
              </div>
              <div>
                <p className="text-red-400 font-bold text-sm">
                  Streak at Risk!
                </p>
                <p className="text-red-400/80 text-xs">
                  You haven't checked in for more than 24 hours. Check in now to
                  prevent losing your {checkinState.currentStreak}-day streak!
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Account;
