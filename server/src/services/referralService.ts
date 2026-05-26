import getSupabaseClient from "../config/supabase";
import { generateReferralCode } from "../utils/referral";

const supabase = getSupabaseClient();

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const POINTS_PER_REFERRAL = 2;
const MAX_REFERRAL_POINTS = 100;          // Lifetime cap per referrer
const MAX_REFERRALS_PER_DAY = 5;          // Daily credit cap per referrer
const MIN_ACCOUNT_AGE_HOURS = 24;         // Referred account must be at least 24h old
const REQUIRE_CHECKIN_BEFORE_CREDIT = true; // Gate: referred user must complete 1st check-in

// Disposable / temp email domains to block
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "tempmail.com", "guerrillamail.com", "10minutemail.com",
  "throwam.com", "yopmail.com", "trashmail.com", "fakeinbox.com",
  "sharklasers.com", "guerrillamailblock.com", "grr.la", "spam4.me",
  "dispostable.com", "spamgourmet.com", "maildrop.cc", "spamfree24.org",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ReferralService
// ─────────────────────────────────────────────────────────────────────────────

export class ReferralService {
  /**
   * Generates a unique referral code. Retries up to 5 times.
   */
  async generateUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode(8);
      const { data } = await supabase
        .from("user_profiles")
        .select("referral_code")
        .eq("referral_code", code)
        .maybeSingle();
      if (!data) return code;
    }
    throw new Error("Failed to generate a unique referral code after multiple attempts.");
  }

  async processReferral(newUserId: string, referralCode: string, ipAddress?: string | null): Promise<string | null> {
    try {
      // 1. Look up the referral code
      const { data: referrer } = await supabase
        .from("user_profiles")
        .select("wallet_address")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (!referrer) {
        console.warn(`[REFERRAL] Referrer with code ${referralCode} not found.`);
        return null;
      }

      const referrerId = referrer.wallet_address;

      // 2. Self-referral check
      if (referrerId.toLowerCase() === newUserId.toLowerCase()) {
        console.warn(`[REFERRAL] Self-referral attempt by ${newUserId}`);
        return null;
      }

      // 3. IP restriction — one IP per referrer (skip if IP is absent)
      if (ipAddress) {
        const { data: ipMatch } = await supabase
          .from("referrals")
          .select("id")
          .eq("referrer_id", referrerId)
          .eq("ip_address", ipAddress)
          .maybeSingle();

        if (ipMatch) {
          console.log(`[REFERRAL] IP ${ipAddress} already used for referrer ${referrerId} — blocked referred user ${newUserId}`);
          return null;
        }
      }

      // 4. Check for existing row
      const { data: existingRef } = await supabase
        .from("referrals")
        .select("id")
        .eq("referred_user_id", newUserId)
        .maybeSingle();

      if (existingRef) {
        console.warn(`[REFERRAL] Referral row already exists for ${newUserId}`);
        return null;
      }

      // 5. Insert row
      const { error: insertError } = await supabase
        .from("referrals")
        .insert({
          referrer_id: referrerId,
          referred_user_id: newUserId,
          status: "pending",
          ip_address: ipAddress ?? null,
          device_fingerprint: null,
        });

      if (insertError) {
        console.error(`[REFERRAL] Failed to insert referral ${referrerId} -> ${newUserId}:`, insertError);
        return null;
      }

      console.log(`[REFERRAL] Successfully processed referral: ${referrerId} -> ${newUserId}`);
      return referrerId;
    } catch (err) {
      console.error("[REFERRAL] Unexpected error processing referral:", err);
      return null;
    }
  }

  async verifyReferral(referredUserId: string): Promise<boolean> {
    try {
      // 1. Find pending referral
      const { data: referral } = await supabase
        .from("referrals")
        .select("id, referrer_id")
        .eq("referred_user_id", referredUserId)
        .eq("status", "pending")
        .maybeSingle();

      if (!referral) {
        console.log(`[REFERRAL] No pending referral found for ${referredUserId}`);
        return false;
      }

      // 2. Mark claimable
      const { error } = await supabase
        .from("referrals")
        .update({
          status: "claimable",
          completed_at: new Date().toISOString(),
        })
        .eq("id", referral.id);

      if (error) {
        console.error(`[REFERRAL] Failed to mark referral ${referral.id} as claimable:`, error);
        return false;
      }

      console.log(`[REFERRAL] ✓ Referral ${referral.id} marked as claimable for ${referral.referrer_id}`);
      return true;
    } catch (err) {
      console.error("[REFERRAL] Error verifying referral:", err);
      return false;
    }
  }

  /**
   * Claim points for a claimable referral.
   */
  async claimReferral(referrerId: string, referralId: string): Promise<{ success: boolean; message: string; points?: number }> {
    try {
      const { data: referral } = await supabase
        .from("referrals")
        .select("*")
        .eq("id", referralId)
        .eq("referrer_id", referrerId)
        .eq("status", "claimable")
        .maybeSingle();

      if (!referral) {
        return { success: false, message: "Referral not found or not claimable." };
      }

      // ── Re-check lifetime cap at claim time ────────────────
      const { data: existingPoints } = await supabase
        .from("referrals")
        .select("points_awarded")
        .eq("referrer_id", referrerId)
        .eq("status", "completed");

      const lifetimePoints = (existingPoints || []).reduce(
        (sum, r) => sum + (r.points_awarded || 0), 0
      );
      if (lifetimePoints >= MAX_REFERRAL_POINTS) {
        await supabase
          .from("referrals")
          .update({ status: "completed", points_awarded: 0 })
          .eq("id", referral.id);
        return { success: false, message: "Lifetime referral points cap reached." };
      }

      const pointsToAward = POINTS_PER_REFERRAL;

      // ── Award points ─────────────────────────────────────────────────────
      const { data: referrerData, error: fetchErr } = await supabase
        .from("user_profiles")
        .select("points, xp")
        .eq("wallet_address", referrerId)
        .single();

      if (fetchErr) throw fetchErr;

      await supabase
        .from("user_profiles")
        .update({
          points: (referrerData.points || 0) + pointsToAward,
          xp: (referrerData.xp || 0) + pointsToAward,
        })
        .eq("wallet_address", referrerId);

      // ── Log to points history ────────────────────────────────────────────
      await supabase.from("points_history").insert({
        user_id: referrerId,
        amount: pointsToAward,
        source: "referral_bonus",
        reason: "Successful referral",
        details: { referred_user: referral.referred_user_id },
      });

      // ── Mark referral completed ──────────────────────────────────────────
      await supabase
        .from("referrals")
        .update({
          status: "completed",
          points_awarded: pointsToAward,
          completed_at: new Date().toISOString(),
        })
        .eq("id", referral.id);

      // ── Flag referrer for review if they have >10 completed referrals ────
      const { count: completedCount } = await supabase
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", referrerId)
        .eq("status", "completed");

      if ((completedCount ?? 0) > 10) {
        console.warn(`[REFERRAL] ⚠ Referrer ${referrerId} has ${completedCount} referrals. Consider manual review.`);
      }

      console.log(`[REFERRAL] ✓ ${pointsToAward}pts awarded to ${referrerId} for claiming referral ${referralId}`);
      return { success: true, message: "Points claimed successfully.", points: pointsToAward };
    } catch (err) {
      console.error("[REFERRAL] Error claiming referral:", err);
      return { success: false, message: "Internal server error." };
    }
  }

  /**
   * Fetches referral stats for a user. Auto-generates a code if not present.
   */
  async getReferralStats(walletAddress: string) {
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("referral_code")
        .eq("wallet_address", walletAddress)
        .single();

      let currentCode = profile?.referral_code;

      if (!currentCode) {
        currentCode = await this.generateUniqueReferralCode();
        await supabase
          .from("user_profiles")
          .update({ referral_code: currentCode })
          .eq("wallet_address", walletAddress);
        console.log(`[REFERRAL] Auto-generated code ${currentCode} for legacy user ${walletAddress}`);
      }

      const { data: referrals, error } = await supabase
        .from("referrals")
        .select(`
          id,
          status,
          points_awarded,
          referred_user_id
        `)
        .eq("referrer_id", walletAddress);

      if (error) throw error;

      // Fetch emails manually to avoid Supabase PostgREST foreign key cache issues
      const referredUserIds = (referrals || []).map((ref: any) => ref.referred_user_id).filter(Boolean);
      
      let emailMap: Record<string, string> = {};
      if (referredUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("wallet_address, email")
          .in("wallet_address", referredUserIds);
          
        for (const p of profiles || []) {
          if (p.email) emailMap[p.wallet_address] = p.email;
        }
      }

      let successful = 0, pending = 0, totalPoints = 0;
      const history = (referrals || []).map((ref: any) => {
        if (ref.status === "completed") { successful++; totalPoints += ref.points_awarded || 0; }
        else if (ref.status === "pending" || ref.status === "claimable") { pending++; }
        
        return {
          id: ref.id,
          status: ref.status,
          points: ref.points_awarded || 0,
          email: emailMap[ref.referred_user_id] || "Unknown"
        };
      });

      return {
        referral_code: currentCode || null,
        successful_referrals: successful,
        pending_referrals: pending,
        points_earned: totalPoints,
        history,
      };
    } catch (err) {
      console.error("[REFERRAL] Error fetching stats:", err);
      return null;
    }
  }
}

export const getReferralService = () => new ReferralService();
