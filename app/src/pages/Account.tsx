import { useState, useEffect } from 'react';
import { Trophy, Star, Users, Award } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface UserAccount {
  user_id: string;
  wallet_address: string;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  xp: number;
  level: number;
  current_level_xp: number;
  next_level_xp: number;
  points: number;
  referral_points: number;
  rank: number | null;
  is_premium: boolean;
}

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  email?: string;
  xp: number;
  level: number;
  points: number;
  referral_points: number;
}

const Account = () => {
  const auth = useAuth();
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  useEffect(() => {
    if (auth.isAuthenticated && auth.pubkeyHex) {
      fetchAccountData();
      fetchLeaderboard();
    }
  }, [auth.isAuthenticated, auth.pubkeyHex]);

  const fetchAccountData = async () => {
    if (!auth.pubkeyHex) return;

    try {
      setLoading(true);
      const response = await fetch(
        `${apiBaseUrl}/api/account/${encodeURIComponent(auth.pubkeyHex)}`
      );

      if (!response.ok) throw new Error('Failed to fetch account data');

      const data = await response.json();
      setUserAccount(data);
    } catch (error) {
      console.error('Error fetching account:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/leaderboard`);

      if (!response.ok) throw new Error('Failed to fetch leaderboard');

      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  };

  const truncateAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getProgressPercentage = () => {
    if (!userAccount) return 0;
    const { xp, current_level_xp, next_level_xp } = userAccount;
    const xpInLevel = xp - current_level_xp;
    const xpNeeded = next_level_xp - current_level_xp;
    return (xpInLevel / xpNeeded) * 100;
  };

  const getRankBadgeColor = (rank: number) => {
    if (rank === 1) return 'bg-gradient-to-r from-yellow-400 to-yellow-600';
    if (rank === 2) return 'bg-gradient-to-r from-gray-300 to-gray-500';
    if (rank === 3) return 'bg-gradient-to-r from-orange-400 to-orange-600';
    if (rank <= 10) return 'bg-gradient-to-r from-purple-500 to-purple-700';
    return 'bg-gradient-to-r from-blue-500 to-blue-700';
  };

  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" text="Loading account..." />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Account</h1>
      </div>

      {userAccount && (
        <div className="space-y-8">
          {/* Account Info */}
          <div className="bg-[#151515] border border-white/10 rounded-[30px] p-8 relative overflow-hidden group">
            {/* Background Gradient */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-blue-500/10 to-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 pointer-events-none" />

            <div className="flex justify-between items-start w-full mb-6 relative z-10">
              <div className="flex items-start gap-6">
                <div className="rounded-2xl h-24 w-24 overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#2A2A2A] to-[#1A1A1A] border border-white/10 shadow-xl group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                  <img
                    src="/assets/images/pfp.png"
                    alt="User"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="flex flex-col justify-center gap-2">
                  <h2 className="text-3xl font-bold tracking-tight text-white/90">
                    {userAccount.username || userAccount.email?.split('@')[0] || 'Anonymous'}
                  </h2>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-colors">
                      <span className="font-mono text-sm text-white/40">{truncateAddress(userAccount.wallet_address)}</span>
                    </div>
                  </div>
                  {userAccount.email && (
                    <p className="text-white/40 text-sm hidden">{userAccount.email}</p>
                  )}
                  {userAccount.is_premium && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-yellow-400/20 to-yellow-600/20 text-yellow-400 border border-yellow-500/20 text-xs font-bold rounded-full w-fit mt-2">
                      <Star className="w-3 h-3fill-yellow-400" /> PREMIUM MEMBER
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end">
                {userAccount.rank && (
                  <div className={`${getRankBadgeColor(userAccount.rank)} text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-blue-900/20`}>
                    <Trophy className="w-5 h-5" />
                    Rank #{userAccount.rank}
                  </div>
                )}
              </div>
            </div>

            <div className="h-px bg-white/5 my-6" />

            {/* Progress Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-blue-400" />
                  <p className="text-lg font-bold">Level {userAccount.level}</p>
                </div>
                <p className="text-sm font-mono text-white/40">
                  <span className="text-white/80">{userAccount.xp - userAccount.current_level_xp}</span> / {userAccount.next_level_xp - userAccount.current_level_xp} XP
                </p>
              </div>

              <div className="relative w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                  style={{ width: `${getProgressPercentage()}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="bg-white/5 rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors group/stat">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Total XP</p>
                <p className="text-2xl font-bold font-mono text-white group-hover/stat:text-blue-400 transition-colors">{userAccount.xp.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors group/stat">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Points</p>
                <p className="text-2xl font-bold font-mono text-white group-hover/stat:text-green-400 transition-colors">{userAccount.points.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors group/stat">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Referrals</p>
                <p className="text-2xl font-bold font-mono text-white group-hover/stat:text-purple-400 transition-colors">{userAccount.referral_points.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="pt-8 space-y-4">
        <div className="flex items-center gap-3 mb-6 px-2">
          <h2 className="text-2xl font-bold">Top 100 Accounts</h2>
        </div>

        <div className="bg-[#151515] border border-white/10 rounded-[30px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/5 border-b border-white/5">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Rank</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Level</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Total XP</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Points</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Referrals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {leaderboard.map((entry) => (
                  <tr
                    key={entry.user_id}
                    className={`hover:bg-white/5 transition-colors ${entry.user_id === auth.pubkeyHex ? 'bg-teal-500/10' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${getRankBadgeColor(entry.rank)} text-white font-bold text-sm shadow-lg`}>
                        {entry.rank}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-white">
                          {entry.username || entry.email?.split('@')[0] || 'Anonymous'}
                        </p>
                        <p className="text-xs text-white/40 font-mono">{truncateAddress(entry.wallet_address)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <Award className="w-4 h-4 text-blue-400" />
                        <span className="font-bold">{entry.level}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-white font-mono font-medium">{entry.xp.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-green-400 font-mono font-medium">{entry.points.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-purple-400 font-mono font-medium">{entry.referral_points.toLocaleString()}</span>
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
    </div>
  );
};

export default Account;