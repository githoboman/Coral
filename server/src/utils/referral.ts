import crypto from "crypto";

/**
 * Generates a random alphanumeric referral code of specified length.
 * Excludes ambiguous characters (0, O, 1, I).
 */
export function generateReferralCode(length: number = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}
