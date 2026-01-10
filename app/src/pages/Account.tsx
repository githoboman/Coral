import { useState, useEffect, useCallback } from 'react';
import { Trophy, Star, Users } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchLeaderboard } from '@/store/slices/leaderboardSlice';

interface UserAccount {
  user_id: string;
  wallet_address: string;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  points: number;
  referral_points: number;
  rank: number | null;
  is_premium: boolean;
}

const Account = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const leaderboard = useAppSelector(state => state.leaderboard.entries);

  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

  const fetchAccountData = useCallback(async () => {
    if (!currentAccount?.address) return;

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/account/${encodeURIComponent(currentAccount.address)}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch account data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Account data fetched:', data);
      setUserAccount(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching account:', error);
      setError(error instanceof Error ? error.message : 'Failed to load account data');
    }
  }, [currentAccount?.address, apiBaseUrl]);

  useEffect(() => {
    console.log('Account useEffect triggered:', {
      isAuthenticated: !!currentAccount,
      address: currentAccount?.address
    });

    if (currentAccount?.address) {
      setLoading(true);
      setError(null);
      Promise.all([
        fetchAccountData(),
        dispatch(fetchLeaderboard())
      ]).finally(() => {
        setLoading(false);
      });
    } else {
      setLoading(false);
      setError('Please connect your wallet to view your account');
    }
  }, [currentAccount?.address, dispatch, fetchAccountData]);

  const truncateAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
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

  if (error) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">My Account</h1>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <p className="text-red-400 text-lg">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!userAccount) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">My Account</h1>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-6 text-center">
          <p className="text-white/60">No account data available</p>
        </div>
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
          <div className="bg-[#151515] border border-white/10 rounded-[30px] p-4 md:p-8 relative overflow-hidden group">
            {/* Background Gradient */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-blue-500/10 to-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 pointer-events-none" />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center w-full mb-6 relative z-10 gap-6">
              <div className="flex items-start gap-6">
                <div className="rounded-2xl h-16 w-16 md:h-24 md:w-24 overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#2A2A2A] to-[#1A1A1A] border border-white/10 shadow-xl group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
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
                  {userAccount.is_premium && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-yellow-400/20 to-yellow-600/20 text-yellow-400 border border-yellow-500/20 text-xs font-bold rounded-full w-fit mt-2">
                      <Star className="w-3 h-3 fill-yellow-400" /> PREMIUM MEMBER
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-start md:items-end w-full md:w-auto mt-4 md:mt-0">
                {userAccount.rank && (
                  <div className={`${getRankBadgeColor(userAccount.rank)} text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-blue-900/20`}>
                    <Trophy className="w-5 h-5" />
                    Rank #{userAccount.rank}
                  </div>
                )}
              </div>
            </div>

            <div className="h-px bg-white/5 my-6" />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Rank</th>
                  <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">User</th>
                  <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Points</th>
                  <th className="px-3 py-3 md:px-6 md:py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider hidden sm:table-cell">Referrals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {leaderboard.map((entry) => (
                  <tr
                    key={entry.user_id}
                    className={`hover:bg-white/5 transition-colors ${entry.user_id === currentAccount?.address ? 'bg-teal-500/10' : ''}`}
                  >
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${getRankBadgeColor(entry.rank)} text-white font-bold text-sm shadow-lg`}>
                        {entry.rank}
                      </div>
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div>
                        <p className="font-bold text-white text-sm md:text-base">
                          {entry.username || entry.email?.split('@')[0] || 'Anonymous'}
                        </p>
                        <p className="text-xs text-white/40 font-mono hidden sm:block">{truncateAddress(entry.wallet_address)}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <span className="text-green-400 font-mono font-medium">{entry.points.toLocaleString()}</span>
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4 hidden sm:table-cell">
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