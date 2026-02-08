import { useEffect } from "react";
import { Trophy, Users } from "lucide-react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";

const Leaderboard = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const leaderboard = useAppSelector((state) => state.leaderboard.entries);

  useEffect(() => {
    dispatch(fetchLeaderboard());
  }, [dispatch]);

  const truncateAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getRankBadgeColor = (rank: number) => {
    if (rank === 1) return "bg-gradient-to-r from-yellow-400 to-yellow-600";
    if (rank === 2) return "bg-gradient-to-r from-gray-300 to-gray-500";
    if (rank === 3) return "bg-gradient-to-r from-orange-400 to-orange-600";
    if (rank <= 10) return "bg-gradient-to-r from-purple-500 to-purple-700";
    return "bg-gradient-to-r from-blue-500 to-blue-700";
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-white/60 mt-2">
          Top performers in the Tovira ecosystem
        </p>
      </div>

      <div className="bg-[#151515] border border-white/10 rounded-[30px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/5 border-b border-white/5">
              <tr>
                <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">
                  User
                </th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">
                  Points
                </th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider hidden sm:table-cell">
                  Referrals
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {leaderboard.map((entry) => (
                <tr
                  key={entry.user_id}
                  className={`hover:bg-white/5 transition-colors ${entry.user_id === currentAccount?.address ? "bg-teal-500/10" : ""}`}
                >
                  <td className="px-3 py-3 md:px-6 md:py-4">
                    <div
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${getRankBadgeColor(entry.rank)} text-white font-bold text-sm shadow-lg`}
                    >
                      {entry.rank}
                    </div>
                  </td>
                  <td className="px-3 py-3 md:px-6 md:py-4">
                    <div>
                      <p className="font-bold text-white text-sm md:text-base">
                        {entry.username ||
                          entry.email?.split("@")[0] ||
                          "Anonymous"}
                      </p>
                      <p className="text-xs text-white/40 font-mono hidden sm:block">
                        {truncateAddress(entry.wallet_address)}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-3 md:px-6 md:py-4">
                    <span className="text-green-400 font-mono font-medium">
                      {entry.points.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-3 md:px-6 md:py-4 hidden sm:table-cell">
                    <span className="text-purple-400 font-mono font-medium">
                      {entry.referral_points.toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {leaderboard.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No leaderboard data yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
