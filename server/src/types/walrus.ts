// src/types/walrus.ts - Walrus-related types
export interface UserProfile {
  email: string;
  wallet_address: string;
  is_waitlisted: boolean;
  points_awarded: number;
  joined_at: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  preferences?: {
    notifications_enabled?: boolean;
    analytics_enabled?: boolean;
    personalization_enabled?: boolean;
  };
}

export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>; // wallet_address -> profile
  description: string;
  previous_blob?: string;
}

export interface Whitelist {
  version: number;
  created_at: string;
  total_count: number;
  emails: string[];
  description: string;
  previous_blob?: string;
}

// src/types/points.ts - Points-related types
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

// src/types/auth.ts - Auth-related types
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
  user: UserProfile | null;
}
