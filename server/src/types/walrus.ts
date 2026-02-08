import type { EncryptedData } from "../services/encryptionService";

export interface UserProfile {
  email: EncryptedData | string;
  wallet_address: string;
  is_waitlisted: boolean;
  points_awarded: number;
  joined_at: string;
  username?: EncryptedData | string;
  first_name?: EncryptedData | string;
  last_name?: EncryptedData | string;
  preferences?: EncryptedData | Record<string, any>;
  waitlist_verified_at?: string;

  // Chat system
  chat_registry_blob_id?: string;

  // Task system
  task_registry_blob_id?: string;

  // Task points tracking
  tasks_created_today?: number;
  tasks_claimed_today?: number;
  last_task_reset_date?: string;

  // Check-in streak tracking
  current_streak?: number;
  last_checkin_date?: string;
  total_checkins?: number;

  // Subscription
  subscription_tier?: number;
  subscription_expires_at?: string;
  daily_prompts_used?: number;
  last_prompt_date?: string;
}

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

  // Chat system
  chat_registry_blob_id?: string;

  // Task system
  task_registry_blob_id?: string;

  // Task points tracking
  tasks_created_today?: number;
  tasks_claimed_today?: number;
  last_task_reset_date?: string;

  // Check-in streak tracking
  current_streak?: number;
  last_checkin_date?: string;
  total_checkins?: number;

  // Subscription
  subscription_tier?: number;
  subscription_expires_at?: string;
  daily_prompts_used?: number;
  last_prompt_date?: string;
}

export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>;
  description: string;
  previous_blob?: string;
}

export interface EncryptedDataStructure {
  iv: string;
  salt: string;
  tag: string;
  encrypted: string;
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
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  points: number;
  referral_points: number;
  rank?: number;
  is_premium: boolean;
  created_at: string;
  current_streak?: number;
  total_checkins?: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  email?: string;
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
  user: DecryptedUserProfile | null;
}
