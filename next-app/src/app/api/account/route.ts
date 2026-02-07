import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/walrus';
import { getBalance, getCurrentBlobId } from '@/lib/sui';

interface AccountResponse {
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
  created_at: string;
}

/**
 * GET /api/account?user_id=<wallet_address>
 * Fetch user account profile with points
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId?.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'User ID cannot be empty' },
        { status: 400 }
      );
    }

    // Get current blob ID from on-chain registry
    const blobId = await getCurrentBlobId();
    if (!blobId) {
      return NextResponse.json(
        { error: 'Not Found', detail: 'User registry not initialized' },
        { status: 404 }
      );
    }

    // Get user profile from Walrus
    const userProfile = await getUserProfile(blobId, userId);
    if (!userProfile) {
      return NextResponse.json(
        { error: 'Not Found', detail: 'User not found' },
        { status: 404 }
      );
    }

    // Get on-chain balance
    const balance = await getBalance(userId);

    const response: AccountResponse = {
      user_id: userId,
      wallet_address: userProfile.wallet_address,
      email: userProfile.email,
      username: userProfile.username,
      first_name: userProfile.first_name,
      last_name: userProfile.last_name,
      points: balance,
      referral_points: 0,
      rank: null,
      is_premium: false,
      created_at: userProfile.joined_at,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[API] Error fetching account:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
