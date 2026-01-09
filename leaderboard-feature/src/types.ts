export interface UserProfile {
  profile_id: string;
  user_id: string;
  username: string;
  points: number;
  last_checkin: number;
  is_active: boolean;
  source: 'local' | 'blockchain' | 'api';
  [key: string]: any;
}

export interface UserSession {
  user_id: string;
  username?: string;
  display_name?: string;
  email?: string;
  profile_id?: string;
  points?: number;
  last_checkin?: number;
  [key: string]: any;
}

export interface BlockchainEntry {
  user_address: string;
  profile_id?: string;
  points?: number | string;
  last_checkin?: number | string;
  [key: string]: any;
}

// ADD THIS INTERFACE - This is what's missing
export interface LeaderboardFormatOptions {
  formatType: 'html' | 'markdown' | 'plain' | 'json';
  showTop?: number;
  includeUserPosition?: boolean;
}

export interface AdvancementInfo {
  points_needed: number;
  next_user: UserProfile | null;
}

export interface PointsRangeGroups {
  '0-100': UserProfile[];
  '101-500': UserProfile[];
  '501-1000': UserProfile[];
  '1001-5000': UserProfile[];
  '5001+': UserProfile[];
}

// Type aliases for loader functions
export type SessionLoader = () => Promise<UserSession[]>;
export type BlockchainFetcher = (registryId: string) => Promise<BlockchainEntry[]>;
export type CheckinDataLoader = (userId: string, session: UserSession) => Promise<Record<string, any>>;