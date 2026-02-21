import { useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import { LeaderboardSkeleton } from "@/components/ui/SkeletonLoader";
import { getLevelData, calculateLevel } from "@/utils/levelUtils";

const Leaderboard = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const { entries: leaderboard, userRank, loading } = useAppSelector(
    (state) => state.leaderboard,
  );

  useEffect(() => {
    const addr = currentAccount?.address;
    dispatch(fetchLeaderboard({ walletAddress: addr }));

    const pollInterval = setInterval(() => {
      dispatch(fetchLeaderboard({ walletAddress: addr }));
    }, 30000);

    return () => clearInterval(pollInterval);
  }, [dispatch, currentAccount?.address]);

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

  // Use server-computed rank (works even outside top 100)
  const userRankDisplay = userRank?.rank ? formatRank(userRank.rank) : "#---";
  const userPoints = userRank?.points || 0;
  const userLevelData = getLevelData(userPoints);
  const totalParticipants = userRank?.total_participants || leaderboard.length;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pt-24 pb-6 md:px-6 md:py-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-6">
          <h1 className="text-xl md:text-[28px] font-medium text-white">
            Position on Leaderboard
            <span className="ml-3 md:ml-4 text-[#3B82F6]">{userRankDisplay}</span>
            {totalParticipants > 0 && (
              <span className="ml-2 text-sm text-white/30 font-normal">/ {totalParticipants}</span>
            )}
          </h1>
        </div>
      </div>

      {/* Progress Section */}
      {/* Progress Section */}
      <div className="flex flex-col gap-2 mb-10 w-full mt-6">
        <div className="flex justify-between items-end px-1">
          <span className="text-white font-bold text-sm md:text-base">
            Level {userLevelData.level}
          </span>
          <span className="text-white/60 font-medium text-xs md:text-sm">
            {userLevelData.currentXpInLevel} / {userLevelData.xpNeededForNextLevel} XP
          </span>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-3 md:h-4 bg-white/5 rounded-full overflow-hidden relative border border-white/5">
          <div
            className="absolute top-0 left-0 h-full bg-[#B7FC0D] transition-all rounded-full duration-1000 ease-out shadow-[0_0_10px_rgba(183,252,13,0.3)]"
            style={{ width: `${userLevelData.progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Leaderboard Table Container */}
      <div className="bg-transparent border border-white/10 rounded-[40px] overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-transparent border-b border-white/5">
                <th className="bg-transparent border-b border-white/5 px-2 py-3 md:px-8 md:py-6 text-center text-[10px] md:text-xs font-bold text-white/40 uppercase tracking-wider md:tracking-[0.2em] border-r border-white/5 last:border-r-0">
                  Rank
                </th>
                <th className="bg-transparent border-b border-white/5 px-2 py-3 md:px-8 md:py-6 text-center text-[10px] md:text-xs font-bold text-white/40 uppercase tracking-wider md:tracking-[0.2em] border-r border-white/5 last:border-r-0">
                  User
                </th>
                <th className="bg-transparent border-b border-white/5 px-2 py-3 md:px-8 md:py-6 text-center text-[10px] md:text-xs font-bold text-white/40 uppercase tracking-wider md:tracking-[0.2em] border-r border-white/5 last:border-r-0">
                  Level
                </th>
                <th className="bg-transparent border-b border-white/5 px-2 py-3 md:px-8 md:py-6 text-center text-[10px] md:text-xs font-bold text-white/40 uppercase tracking-wider md:tracking-[0.2em] last:border-r-0">
                  XP
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
                  <td className="px-2 py-3 md:px-8 md:py-5 text-center font-mono text-xs md:text-sm">
                    {formatRank(entry.rank)}
                  </td>
                  <td className="px-2 py-3 md:px-8 md:py-5 text-center">
                    <span className="font-medium text-xs md:text-base">
                      {entry.username || truncateAddress(entry.wallet_address)}
                    </span>
                  </td>
                  <td className="px-2 py-3 md:px-8 md:py-5 text-center font-medium text-xs md:text-base">
                    {calculateLevel(entry.points)}
                  </td>
                  <td className="px-2 py-3 md:px-8 md:py-5 text-center font-mono text-xs md:text-base">
                    {entry.points}
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