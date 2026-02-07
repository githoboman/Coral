import { NextRequest, NextResponse } from 'next/server';
import { fetchUsersRegistry, decryptProfile } from '@/lib/walrus';
import { getBalance, getCurrentBlobId } from '@/lib/sui';

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  email?: string;
  points: number;
  referral_points: number;
}

/**
 * GET /api/leaderboard - Fetch leaderboard data
 */
export async function GET() {
  try {
    // Get current blob ID from on-chain registry
    const blobId = await getCurrentBlobId();
    if (!blobId) {
      return NextResponse.json({ leaderboard: [] });
    }

    // Fetch users registry from Walrus
    const registry = await fetchUsersRegistry(blobId);
    if (!registry) {
      return NextResponse.json({ leaderboard: [] });
    }

    // Decrypt each profile and get points
    const usersWithPoints = await Promise.all(
      Object.keys(registry.users).map(async (wallet) => {
        try {
          const encryptedProfile = registry.users[wallet];
          const decryptedProfile = decryptProfile(encryptedProfile);

          const balance = await getBalance(wallet);

          return {
            user_id: wallet,
            wallet_address: wallet,
            username: decryptedProfile.username,
            email: decryptedProfile.email,
            points: balance,
            referral_points: 0,
          };
        } catch {
          return null;
        }
      })
    );

    // Filter nulls, sort by points, add rank
    const validUsers = usersWithPoints.filter((u): u is NonNullable<typeof u> => u !== null);
    const leaderboard: LeaderboardEntry[] = validUsers
      .sort((a, b) => b.points - a.points)
      .slice(0, 100)
      .map((user, idx) => ({ ...user, rank: idx + 1 }));

    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error('[API] Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
