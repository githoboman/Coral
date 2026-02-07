import { NextRequest, NextResponse } from 'next/server';
import { hasClaimed, getBalance } from '@/lib/sui';

/**
 * GET /api/auth/check-claim-status?wallet_address=<addr>
 * Check if the user has already claimed their waitlist bonus
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet_address');

    if (!walletAddress?.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const claimed = await hasClaimed(walletAddress);
    const balance = await getBalance(walletAddress);

    return NextResponse.json({
      claimed,
      balance,
      wallet_address: walletAddress,
    });
  } catch (error) {
    console.error('[API] Error checking claim status:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
