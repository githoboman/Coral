// src/pages/Account.tsx - FIXED VERSION with default export
//
// Key fixes:
// 1. Handle 404 gracefully (user doesn't exist yet = not onboarded)
// 2. Don't treat 404 as fatal error
// 3. Show proper onboarding prompt
// 4. Export as default

import { useState, useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

interface AccountData {
  user_id: string;
  wallet_address: string;
  email?: string;
  username?: string;
  points: number;
  rank: number | null;
}

export default function Account() {
  const currentAccount = useCurrentAccount();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAccount() {
      const addr = currentAccount?.address;
      if (!addr) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [accountRes, claimRes] = await Promise.all([
          fetch(`${API_BASE}/api/account/${encodeURIComponent(addr)}`),
          fetch(
            `${API_BASE}/api/auth/check-claim-status?wallet_address=${encodeURIComponent(addr)}`,
          ),
        ]);

        // 404 means user hasn't registered yet - this is OK!
        if (accountRes.status === 404) {
          console.log("User not found - needs to complete onboarding");
          setAccount(null);
          setLoading(false);
          return;
        }

        if (!accountRes.ok) {
          throw new Error(`Failed to fetch account: ${accountRes.status}`);
        }

        const data = await accountRes.json();

        // Also get claim status
        if (claimRes.ok) {
          const claimData = await claimRes.json();
          data.points = claimData.balance || data.points || 0;
        }

        setAccount(data);
      } catch (err) {
        console.error("Error fetching account:", err);
        setError(err instanceof Error ? err.message : "Failed to load account");
      } finally {
        setLoading(false);
      }
    }

    fetchAccount();
  }, [currentAccount?.address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!currentAccount) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white">Please connect your wallet</div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-white/60 mb-4">No account found</p>
          <p className="text-white/40 text-sm">
            Complete onboarding to create your account
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-[#0D1117]/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8">
          <h1 className="text-3xl font-bold text-white mb-6">Account</h1>

          <div className="space-y-4">
            <div>
              <p className="text-white/40 text-sm mb-1">Wallet Address</p>
              <p className="text-white font-mono text-sm">
                {account.wallet_address.slice(0, 6)}...
                {account.wallet_address.slice(-4)}
              </p>
            </div>

            {account.email && (
              <div>
                <p className="text-white/40 text-sm mb-1">Email</p>
                <p className="text-white">{account.email}</p>
              </div>
            )}

            {account.username && (
              <div>
                <p className="text-white/40 text-sm mb-1">Username</p>
                <p className="text-white">{account.username}</p>
              </div>
            )}

            <div>
              <p className="text-white/40 text-sm mb-1">Points</p>
              <p className="text-4xl font-bold text-[#8BEE1C]">
                {account.points.toLocaleString()}
              </p>
            </div>

            {account.rank && (
              <div>
                <p className="text-white/40 text-sm mb-1">Rank</p>
                <p className="text-white text-xl font-bold">#{account.rank}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Also export as named export for backwards compatibility
export { Account };
