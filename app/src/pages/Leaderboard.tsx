import { useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import { LeaderboardSkeleton } from "@/components/ui/SkeletonLoader";
import { getLevelData, calculateLevel } from "@/utils/levelUtils";

const Leaderboard = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const { entries: leaderboard, loading } = useAppSelector(
    (state) => state.leaderboard,
  );

  useEffect(() => {
    dispatch(fetchLeaderboard(false));

    const pollInterval = setInterval(() => {
      dispatch(fetchLeaderboard(false));
    }, 30000);

    return () => clearInterval(pollInterval);
  }, [dispatch]);

  const truncateAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatRank = (rank: number) => {
    return `#${rank.toString().padStart(3, "0")}`;
  };

  if (loading && leaderboard.length === 0) {
    return <LeaderboardSkeleton />;
  }

  // Find current user's rank and data
  const userEntry = leaderboard.find(e => e.user_id === currentAccount?.address);
  const userRank = userEntry ? formatRank(userEntry.rank) : "#---";
  const userLevelData = getLevelData(userEntry?.points || 0);

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-6">
          <h1 className="text-[28px] font-medium text-white">
            Position on Leaderboard
            <span className="ml-4 text-[#3B82F6]">{userRank}</span>
          </h1>
        </div>
      </div>

      {/* Progress Section */}
      <div className="flex flex-col md:flex-row items-center gap-4 mb-10 w-full mt-6">
        <div className="flex gap-3">
          <div className="px-5 py-2.5 bg-[#3B82F6] rounded-full text-white text-sm font-semibold whitespace-nowrap min-w-[100px] text-center">
            Level {userLevelData.level}
          </div>
          <div className="px-5 py-2.5 bg-[#3B82F6] rounded-full text-white text-sm font-semibold whitespace-nowrap min-w-[120px] text-center">
            {userLevelData.currentXpInLevel}/{userLevelData.xpNeededForNextLevel} XP
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="flex-1 h-8 bg-white/5 rounded-full overflow-hidden relative border border-white/5">
          <div
            className="absolute top-0 left-0 h-full bg-[#B7FC0D] transition-all rounded-full duration-1000 ease-out"
            style={{ width: `${userLevelData.progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Leaderboard Table Container */}
      <div className="bg-[#0A0A0A] border border-white/10 rounded-[40px] overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-transparent border-b border-white/5">
                <th className="px-8 py-6 text-center text-xs font-bold text-white/40 uppercase tracking-[0.2em] border-r border-white/5 last:border-0">
                  Rank
                </th>
                <th className="px-8 py-6 text-center text-xs font-bold text-white/40 uppercase tracking-[0.2em] border-r border-white/5 last:border-0">
                  User
                </th>
                <th className="px-8 py-6 text-center text-xs font-bold text-white/40 uppercase tracking-[0.2em] border-r border-white/5 last:border-0">
                  Level
                </th>
                <th className="px-8 py-6 text-center text-xs font-bold text-white/40 uppercase tracking-[0.2em] border-r border-white/5 last:border-0">
                  XP
                </th>
                <th className="px-8 py-6 text-center text-xs font-bold text-white/40 uppercase tracking-[0.2em] last:border-0">
                  Referral
                </th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {leaderboard.map((entry, idx) => (
                <tr
                  key={entry.user_id}
                  className={`border-b border-white/5 last:border-0 transition-colors ${idx % 2 === 0 ? "bg-[#1A1A1A]" : "bg-[#0D0D0D]"
                    } ${entry.user_id === currentAccount?.address ? "relative z-10 scale-[1.01] shadow-xl" : ""}`}
                >
                  <td className="px-8 py-5 text-center font-mono text-sm">
                    {formatRank(entry.rank)}
                  </td>
                  <td className="px-8 py-5 text-center">
                    <span className="font-medium">
                      {entry.username || truncateAddress(entry.wallet_address)}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-center font-medium">
                    {calculateLevel(entry.points)}
                  </td>
                  <td className="px-8 py-5 text-center font-mono">
                    {entry.points}
                  </td>
                  <td className="px-8 py-5 text-center font-mono">
                    {entry.referral_points ? Math.floor(entry.referral_points / 10) : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {leaderboard.length === 0 && !loading && (
          <div className="text-center py-20 bg-[#0D0D0D]">
            <p className="text-white/20 text-lg">No participants yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;