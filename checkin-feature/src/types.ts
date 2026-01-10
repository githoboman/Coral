
export interface CheckInEntry {
  timestamp: number;
  date: string;
  points_earned: number;
}

export interface CheckInData {
  checkins: CheckInEntry[];
  total: number;
  last_checkin: number | null;
}

export interface SessionData {
  [key: string]: any;
  password?: string;
  profile_id?: string;
  points?: number;
  last_checkin?: string;
  checkin_count?: number;
  status?: 'local_only' | 'blockchain';
}

export interface CheckInResult {
  success: boolean;
  message: string;
  points_earned?: number;
  total_points?: number;
  streak_day?: number;
  can_check_in_again: boolean;
  next_checkin_time?: Date;
  updated_session?: SessionData;
}

export interface HasCheckedInResult {
  has_checked_in: boolean;
  last_checkin?: Date;
  next_available?: Date;
}

// SIMPLIFIED Adapter Interfaces - remove Promise wrappers
export interface StorageAdapter {
  loadUserCheckinData(userId: string, password: string): CheckInData;
  saveUserCheckinData(userId: string, password: string, data: CheckInData): boolean;
  storeEncryptedUserData(publicKey: string, data: CheckInData): string | null;
}

export interface BlockchainAdapter {
  getUserDetails(profileId: string): Record<string, any> | null;
  checkin(profileId: string): boolean;
  updateEncryptedData(profileId: string, blobId: string): boolean;
}

export interface KeyManagerAdapter {
  getUserPublicKey(userId: string): string | null;
}
