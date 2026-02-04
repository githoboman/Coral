// Updated types for encrypted user profiles
// Place this in: server/src/types/walrus.ts

import type { EncryptedData } from "../services/encryptionService";

/**
 * User profile as stored in Walrus (with encrypted PII)
 */
export interface UserProfile {
  email: EncryptedData | string; // Encrypted
  wallet_address: string; // NOT encrypted (used for indexing)
  is_waitlisted: boolean; // NOT encrypted
  points_awarded: number; // NOT encrypted
  joined_at: string; // NOT encrypted
  username?: EncryptedData | string; // Encrypted
  first_name?: EncryptedData | string; // Encrypted
  last_name?: EncryptedData | string; // Encrypted
  preferences?: EncryptedData | Record<string, any>; // Encrypted
  waitlist_verified_at?: string; // NOT encrypted
}

/**
 * Decrypted user profile (returned from getUserProfile)
 * Use this type for API responses and internal logic
 */
export interface DecryptedUserProfile {
  email: string;
  wallet_address: string;
  is_waitlisted: boolean;
  points_awarded: number;
  joined_at: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  preferences?: Record<string, any>;
  waitlist_verified_at?: string;
}

/**
 * Users registry as stored in Walrus
 */
export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>; // wallet_address -> encrypted profile
  description: string;
  previous_blob?: string;
}

/**
 * Encrypted data structure (from encryptionService)
 */
export interface EncryptedDataStructure {
  iv: string; // Initialization vector (base64)
  salt: string; // Salt for key derivation (base64)
  tag: string; // Authentication tag (base64)
  encrypted: string; // Encrypted data (base64)
}

export interface Whitelist {
  version: number;
  created_at: string;
  total_count: number;
  emails: string[];
  description: string;
  previous_blob?: string;
}

export interface PointsBalance {
  wallet_address: string;
  balance: number;
}

export interface PointsMintRequest {
  recipient: string;
  amount: number;
  reason?: string;
}

export interface AccountDetails {
  user_id: string;
  wallet_address: string;
  email?: string; // Decrypted
  username?: string; // Decrypted
  first_name?: string; // Decrypted
  last_name?: string; // Decrypted
  points: number;
  referral_points: number;
  rank?: number;
  is_premium: boolean;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string; // Decrypted
  email?: string; // Decrypted
  points: number;
  referral_points: number;
}

export interface VerifyAndRegisterRequest {
  email: string;
  wallet_address: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  preferences?: {
    notifications_enabled?: boolean;
    analytics_enabled?: boolean;
    personalization_enabled?: boolean;
  };
}

export interface VerifyAndRegisterResponse {
  success: boolean;
  message: string;
  user: {
    email: string;
    wallet_address: string;
    is_waitlisted: boolean;
    points_awarded: number;
  };
  registry_blob_id: string;
  tx_digest: string | null;
}

export interface CheckUserResponse {
  exists: boolean;
  user: DecryptedUserProfile | null; // Always returns decrypted data
}
