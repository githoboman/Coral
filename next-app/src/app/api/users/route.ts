import { NextRequest, NextResponse } from 'next/server';
import {
  getUserProfile,
  createUserProfile,
  addOrUpdateUser,
  userExists,
  type DecryptedUserProfile,
} from '@/lib/walrus';

const USER_REGISTRY_BLOB_ID = process.env.USER_REGISTRY_BLOB_ID || '';

/**
 * GET /api/users - Fetch user profile
 * Query params: user_id (wallet address)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId || !userId.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'User ID cannot be empty' },
        { status: 400 }
      );
    }

    if (!USER_REGISTRY_BLOB_ID) {
      return NextResponse.json({
        exists: false,
        user: null,
        is_onboarded: false,
      });
    }

    const userProfile = await getUserProfile(USER_REGISTRY_BLOB_ID, userId);

    if (userProfile) {
      const isOnboarded = !!userProfile.email;
      return NextResponse.json({
        exists: true,
        user: userProfile,
        is_onboarded: isOnboarded,
      });
    }

    return NextResponse.json({
      exists: false,
      user: null,
      is_onboarded: false,
    });
  } catch (error) {
    console.error('[API] Error in fetch-user:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', detail: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users - Create or update user profile
 * Body: { user_id, wallet_address?, email?, username?, first_name?, last_name?, preferences? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_id,
      wallet_address,
      email,
      username,
      first_name,
      last_name,
      preferences,
    } = body;

    if (!user_id || !user_id.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'User ID cannot be empty' },
        { status: 400 }
      );
    }

    // Fetch existing profile if registry exists
    let existingProfile: DecryptedUserProfile | null = null;
    if (USER_REGISTRY_BLOB_ID) {
      existingProfile = await getUserProfile(USER_REGISTRY_BLOB_ID, user_id);
    }

    // Create updated profile
    const updatedProfile = createUserProfile(
      email || existingProfile?.email || '',
      wallet_address || user_id,
      existingProfile?.is_waitlisted || false,
      existingProfile?.points_awarded || 0,
      {
        username: username || existingProfile?.username,
        first_name: first_name || existingProfile?.first_name,
        last_name: last_name || existingProfile?.last_name,
        preferences: preferences || existingProfile?.preferences,
        waitlist_verified_at: existingProfile?.waitlist_verified_at,
      }
    );

    const newBlobId = await addOrUpdateUser(
      USER_REGISTRY_BLOB_ID || null,
      updatedProfile
    );

    if (!newBlobId) {
      return NextResponse.json(
        { error: 'Internal Server Error', detail: 'Failed to update user profile' },
        { status: 500 }
      );
    }

    // Log if blob ID changed (need to update env)
    if (newBlobId !== USER_REGISTRY_BLOB_ID) {
      console.log(`[API] Update .env: USER_REGISTRY_BLOB_ID=${newBlobId}`);
    }

    return NextResponse.json({
      message: 'User profile updated successfully',
      user_id,
      requires_onboarding: !(email || existingProfile?.email),
      registry_blob_id: newBlobId,
    });
  } catch (error) {
    console.error('[API] Error in update-user:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', detail: 'Failed to update user profile' },
      { status: 500 }
    );
  }
}
