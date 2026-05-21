import getSupabaseClient from "../config/supabase";
import { generateReferralCode } from "../utils/referral";

const supabase = getSupabaseClient();

export class ReferralService {
  /**
   * Generates a unique referral code. Retries if the code already exists.
   */
  async generateUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode(8);
      const { data } = await supabase
        .from('user_profiles')
        .select('referral_code')
        .eq('referral_code', code)
        .maybeSingle();
      
      if (!data) return code; // Code is unique
    }
    throw new Error("Failed to generate a unique referral code after multiple attempts.");
  }

  /**
   * Processes a referral on user signup.
   * Finds the referrer by code, checks for self-referral, and creates a pending referral.
   */
  async processReferral(newUserId: string, referralCode: string, ipAddress?: string, deviceFingerprint?: string): Promise<string | null> {
    try {
      // 1. Find the referrer
      const { data: referrer, error: referrerError } = await supabase
        .from('user_profiles')
        .select('wallet_address')
        .eq('referral_code', referralCode)
        .maybeSingle();

      if (referrerError || !referrer) {
        console.warn(`[REFERRAL] Referrer with code ${referralCode} not found.`);
        return null;
      }

      const referrerId = referrer.wallet_address;

      // 2. Prevent self-referral
      if (referrerId.toLowerCase() === newUserId.toLowerCase()) {
        console.warn(`[REFERRAL] Self-referral attempt by ${newUserId}`);
        return null;
      }

      // Optional: Check IP/Device for self-referral if needed here.

      // 3. Create a pending referral entry
      const { error: insertError } = await supabase
        .from('referrals')
        .insert({
          referrer_id: referrerId,
          referred_user_id: newUserId,
          status: 'pending',
          ip_address: ipAddress || null,
          device_fingerprint: deviceFingerprint || null
        });

      if (insertError) {
        // If it's a unique constraint violation, it means they already referred them
        if (insertError.code === '23505') {
          console.warn(`[REFERRAL] Duplicate referral attempt: ${referrerId} -> ${newUserId}`);
          return null;
        }
        throw insertError;
      }

      return referrerId;
    } catch (err) {
      console.error("[REFERRAL] Error processing referral:", err);
      return null;
    }
  }

  /**
   * Completes a referral (called when the user does a qualifying action).
   * Awards points to the referrer.
   */
  async completeReferral(referredUserId: string): Promise<boolean> {
    try {
      // 1. Find the pending referral
      const { data: referral, error: findError } = await supabase
        .from('referrals')
        .select('*')
        .eq('referred_user_id', referredUserId)
        .eq('status', 'pending')
        .maybeSingle();

      if (findError || !referral) {
        return false;
      }

      const referrerId = referral.referrer_id;
      const pointsToAward = 2;

      // 2. Begin "transaction"
      
      // Award points to referrer
      const { data: referrerData, error: referrerFetchError } = await supabase
        .from('user_profiles')
        .select('points, xp')
        .eq('wallet_address', referrerId)
        .single();

      if (referrerFetchError) throw referrerFetchError;

      const { error: updatePointsError } = await supabase
        .from('user_profiles')
        .update({
          points: (referrerData.points || 0) + pointsToAward,
          xp: (referrerData.xp || 0) + pointsToAward, // Assuming points sync with XP
        })
        .eq('wallet_address', referrerId);

      if (updatePointsError) throw updatePointsError;

      // Log point history
      await supabase.from('points_history').insert({
        user_id: referrerId,
        amount: pointsToAward,
        source: 'referral_bonus',
        reason: 'Successful referral',
        details: { referred_user: referredUserId }
      });

      // 3. Mark referral as completed
      const { error: completeError } = await supabase
        .from('referrals')
        .update({
          status: 'completed',
          points_awarded: pointsToAward,
          completed_at: new Date().toISOString()
        })
        .eq('id', referral.id);

      if (completeError) throw completeError;

      return true;
    } catch (err) {
      console.error("[REFERRAL] Error completing referral:", err);
      return false;
    }
  }

  /**
   * Fetches referral stats for a user
   */
  async getReferralStats(walletAddress: string) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('referral_code')
        .eq('wallet_address', walletAddress)
        .single();
      
      let currentCode = profile?.referral_code;

      // Auto-generate for legacy users who don't have a code yet
      if (!currentCode) {
        currentCode = await this.generateUniqueReferralCode();
        await supabase
          .from('user_profiles')
          .update({ referral_code: currentCode })
          .eq('wallet_address', walletAddress);
        console.log(`[REFERRAL] Auto-generated code ${currentCode} for legacy user ${walletAddress}`);
      }

      const { data: referrals, error } = await supabase
        .from('referrals')
        .select('status, points_awarded')
        .eq('referrer_id', walletAddress);

      if (error) throw error;

      let successful = 0;
      let pending = 0;
      let totalPoints = 0;

      if (referrals) {
        for (const ref of referrals) {
          if (ref.status === 'completed') {
            successful++;
            totalPoints += (ref.points_awarded || 0);
          } else if (ref.status === 'pending') {
            pending++;
          }
        }
      }

      return {
        referral_code: currentCode || null,
        successful_referrals: successful,
        pending_referrals: pending,
        points_earned: totalPoints
      };

    } catch (err) {
      console.error("[REFERRAL] Error fetching stats:", err);
      return null;
    }
  }
}

export const getReferralService = () => new ReferralService();
