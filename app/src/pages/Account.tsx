import React, { useState, useEffect } from 'react';
import { Trophy, Star, Users, TrendingUp, Award } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeView, setActiveView] = useState<'Account' | 'Leaderboard'>('Account');
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const views = ['Account', 'Leaderboard'];
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  useEffect(() => {
    if (auth.isAuthenticated && auth.pubkeyHex) {
      fetchAccountData();
    }
  }, [auth.isAuthenticated, auth.pubkeyHex]);

  useEffect(() => {
    if (activeView === 'Leaderboard') {
      fetchLeaderboard();
    }
  }, [activeView]);

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

  if (loading && activeView === 'Account') {
    return (
      <div className="w-full max-w-4xl mx-auto flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="sticky top-0 pt-6 z-10 flex w-full gap-6 items-center mb-8 bg-transparent">
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(s => !s)}
            className="cursor-pointer flex items-center px-4 py-2 bg-[#2D2D2D] border border-white/10 rounded-full text-sm font-medium hover:bg-white/10 transition-colors"
          >
            {activeView}
            <svg className={`ml-2 w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 bg-[#2D2D2D] backdrop-blur rounded-md shadow-lg border border-gray-200/50 w-40 z-20">
              {views.map(v => (
                <button
                  key={v}
                  onClick={() => { setActiveView(v as any); setIsDropdownOpen(false); }}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-white/10 rounded-md transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeView === 'Account' && userAccount && (
        <div className="space-y-8">
          {/* Account Info */}
          <div className="bg-[#2D2D2D] border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start w-full mb-6">
              <div className="flex items-start gap-6">
                <div className="rounded-full h-24 w-24 overflow-hidden flex items-center justify-center bg-gwhite/50 flex-shrink-0">
                  <img
                    src="/assets/images/pfp.png"
                    alt="User"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="flex flex-col justify-center gap-2">
                  <h2 className="text-2xl font-bold">
                    {userAccount.username || userAccount.first_name || 'Anonymous'}
                  </h2>
                  <p className="text-gray-400 text-sm">{truncateAddress(userAccount.wallet_address)}</p>
                  {userAccount.email && (
                    <p className="text-gray-400 text-sm">{userAccount.email}</p>
                  )}
                  {userAccount.is_premium && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-yellow-400 to-yellow-600 text-black text-xs font-bold rounded-full w-fit">
                      <Star className="w-3 h-3" /> PREMIUM
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end">
                {userAccount.rank && (
                  <div className={`${getRankBadgeColor(userAccount.rank)} text-white px-4 py-2 rounded-full flex items-center gap-2 font-bold`}>
                    <Trophy className="w-5 h-5" />
                    #{userAccount.rank}
                  </div>
                )}
              </div>
            </div>

            {/* Progress Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-blue-400" />
                  <p className="text-lg font-semibold">Level {userAccount.level}</p>
                </div>
                <p className="text-sm text-gray-400">
                  {userAccount.xp - userAccount.current_level_xp} / {userAccount.next_level_xp - userAccount.current_level_xp} XP
                </p>
              </div>

              <div className="relative w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 rounded-full"
                  style={{ width: `${getProgressPercentage()}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="bg-black/30 rounded-lg p-4 text-center border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Total XP</p>
                <p className="text-2xl font-bold text-blue-400">{userAccount.xp.toLocaleString()}</p>
              </div>
              <div className="bg-black/30 rounded-lg p-4 text-center border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Points</p>
                <p className="text-2xl font-bold text-green-400">{userAccount.points.toLocaleString()}</p>
              </div>
              <div className="bg-black/30 rounded-lg p-4 text-center border border-white/5">
                <p className="text-gray-400 text-sm mb-1">Referrals</p>
                <p className="text-2xl font-bold text-purple-400">{userAccount.referral_points.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === 'Leaderboard' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Top 100 Players</h2>
          </div>

          <div className="bg-[#2D2D2D] border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black/30 border-b border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Rank</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">User</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Level</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">XP</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Points</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-400">Referrals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {leaderboard.map((entry) => (
                    <tr
                      key={entry.user_id}
                      className={`hover:bg-white/5 transition-colors ${entry.user_id === auth.pubkeyHex ? 'bg-blue-500/10' : ''
                        }`}
                    >
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${getRankBadgeColor(entry.rank)} text-white font-bold text-sm`}>
                          {entry.rank}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">
                            {entry.username || entry.email?.split('@')[0] || 'Anonymous'}
                          </p>
                          <p className="text-xs text-gray-400">{truncateAddress(entry.wallet_address)}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Award className="w-4 h-4 text-blue-400" />
                          <span className="font-semibold">{entry.level}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-blue-400 font-mono">{entry.xp.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-green-400 font-mono">{entry.points.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-purple-400 font-mono">{entry.referral_points.toLocaleString()}</span>
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
      )}
    </div>
  );
};

export default Account;