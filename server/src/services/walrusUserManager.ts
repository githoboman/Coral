import "dotenv/config";
import { getEncryptionService, type EncryptedData } from "./encryptionService";
import getSupabaseClient from "../config/supabase";

const supabase = getSupabaseClient();

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

export class WalrusUserManager {
  private static instance: WalrusUserManager;
  private encryption = getEncryptionService();

  private constructor() {
    // Dedicated to Supabase now
  }

  public static getInstance(): WalrusUserManager {
    if (!WalrusUserManager.instance) {
      WalrusUserManager.instance = new WalrusUserManager();
    }
    return WalrusUserManager.instance;
  }

  public getCachedBlobId(): string | null {
    return "supabase_managed";
  }

  createUserProfile(
    email: string,
    walletAddress: string,
    isWaitlisted: boolean,
    pointsAwarded: number,
    additionalData?: Partial<DecryptedUserProfile>,
  ): UserProfile {
    const normalizedEmail = email.toLowerCase().trim();

    const profile: UserProfile = {
      email: this.encryption.encrypt(normalizedEmail),
      wallet_address: walletAddress,
      is_waitlisted: isWaitlisted,
      points_awarded: pointsAwarded,
      joined_at: new Date().toISOString(),
    };

    if (additionalData?.username) {
      profile.username = this.encryption.encrypt(additionalData.username);
    }
    if (additionalData?.first_name) {
      profile.first_name = this.encryption.encrypt(additionalData.first_name);
    }
    if (additionalData?.last_name) {
      profile.last_name = this.encryption.encrypt(additionalData.last_name);
    }
    if (additionalData?.preferences) {
      profile.preferences = this.encryption.encryptPreferences(
        additionalData.preferences,
      );
    }
    if (additionalData?.waitlist_verified_at) {
      profile.waitlist_verified_at = additionalData.waitlist_verified_at;
    }

    // Chat system
    if (additionalData?.chat_registry_blob_id) {
      profile.chat_registry_blob_id = additionalData.chat_registry_blob_id;
    }

    // Task system
    if (additionalData?.task_registry_blob_id) {
      profile.task_registry_blob_id = additionalData.task_registry_blob_id;
    }

    // Task tracking
    if (additionalData?.tasks_created_today !== undefined) {
      profile.tasks_created_today = additionalData.tasks_created_today;
    }
    if (additionalData?.tasks_claimed_today !== undefined) {
      profile.tasks_claimed_today = additionalData.tasks_claimed_today;
    }
    if (additionalData?.last_task_reset_date) {
      profile.last_task_reset_date = additionalData.last_task_reset_date;
    }

    // Check-in streak tracking
    if (additionalData?.current_streak !== undefined) {
      profile.current_streak = additionalData.current_streak;
    }
    if (additionalData?.last_checkin_date) {
      profile.last_checkin_date = additionalData.last_checkin_date;
    }
    if (additionalData?.total_checkins !== undefined) {
      profile.total_checkins = additionalData.total_checkins;
    }

    // Subscription
    if (additionalData?.subscription_tier !== undefined) {
      profile.subscription_tier = additionalData.subscription_tier;
    }
    if (additionalData?.subscription_expires_at) {
      profile.subscription_expires_at = additionalData.subscription_expires_at;
    }
    if (additionalData?.daily_prompts_used !== undefined) {
      profile.daily_prompts_used = additionalData.daily_prompts_used;
    }
    if (additionalData?.last_prompt_date) {
      profile.last_prompt_date = additionalData.last_prompt_date;
    }

    return profile;
  }

  async addOrUpdateUser(
    currentBlobId: string | null, // Kept for compatibility
    userProfile: UserProfile,
  ): Promise<string | null> {
    try {
      // Construct Supabase-ready object from UserProfile
      const upsertData: any = {
        wallet_address: userProfile.wallet_address,
        user_id: userProfile.wallet_address,
        is_waitlisted: userProfile.is_waitlisted,
        points: userProfile.points_awarded,
        joined_at: userProfile.joined_at,
        chat_registry_blob_id: userProfile.chat_registry_blob_id,
        task_registry_blob_id: userProfile.task_registry_blob_id,
        tasks_created_today: userProfile.tasks_created_today,
        tasks_claimed_today: userProfile.tasks_claimed_today,
        last_task_reset_date: userProfile.last_task_reset_date,
        checkin_streak: userProfile.current_streak,
        last_checkin: userProfile.last_checkin_date,
        total_checkins: userProfile.total_checkins,
        subscription_tier: userProfile.subscription_tier,
        subscription_expires_at: userProfile.subscription_expires_at,
        daily_prompts_used: userProfile.daily_prompts_used,
        last_prompt_date: userProfile.last_prompt_date,
      };

      // Decrypt legacy fields if they are still encrypted in the incoming object
      const encryption = getEncryptionService();
      if (userProfile.email) {
        upsertData.email = typeof userProfile.email === 'string' 
          ? userProfile.email 
          : encryption.decryptOptional(userProfile.email);
      }
      if (userProfile.username) {
        upsertData.username = typeof userProfile.username === 'string'
          ? userProfile.username
          : encryption.decryptOptional(userProfile.username);
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .upsert(upsertData, { onConflict: 'wallet_address' })
        .select();

      if (error) throw error;

      console.log(`[WALRUS_MANAGER] ✅ Profile saved to Supabase: ${userProfile.wallet_address}`);
      
      return "supabase_managed";
    } catch (error) {
      console.error("❌ Error updating user in Supabase:", error);
      return null;
    }
  }

  async getUserProfile(
    registryBlobId: string, // Kept for interface compatibility but may be ignored
    walletAddress: string,
  ): Promise<DecryptedUserProfile | null> {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      // Map Supabase fields back to DecryptedUserProfile structure
      return {
        email: profile.email || "",
        wallet_address: profile.wallet_address,
        is_waitlisted: profile.is_waitlisted || false,
        points_awarded: profile.points || 0,
        joined_at: profile.joined_at,
        username: profile.username,
        first_name: profile.first_name,
        last_name: profile.last_name,
        preferences: profile.preferences,
        waitlist_verified_at: profile.created_at,
        chat_registry_blob_id: profile.chat_registry_blob_id,
        task_registry_blob_id: profile.task_registry_blob_id,
        tasks_created_today: profile.tasks_created_today,
        tasks_claimed_today: profile.tasks_claimed_today,
        last_task_reset_date: profile.last_task_reset_date,
        current_streak: profile.checkin_streak,
        last_checkin_date: profile.last_checkin,
        total_checkins: profile.total_checkins,
        subscription_tier: profile.subscription_tier,
        subscription_expires_at: profile.subscription_expires_at,
        daily_prompts_used: profile.daily_prompts_used,
        last_prompt_date: profile.last_prompt_date,
      };
    } catch (error) {
      console.error("[WALRUS_MANAGER] Error fetching profile from Supabase:", error);
      throw error;
    }
  }

  async findWalletByEmail(
    registryBlobId: string,
    email: string,
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('wallet_address')
        .ilike('email', email.trim())
        .maybeSingle();

      if (error) throw error;
      return data?.wallet_address || null;
    } catch (error) {
      console.error("[WALRUS_MANAGER] Error in findWalletByEmail:", error);
      return null;
    }
  }

  async userExists(
    registryBlobId: string,
    walletAddress: string,
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('wallet_address')
        .eq('wallet_address', walletAddress)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    } catch (error) {
      console.error("[WALRUS_MANAGER] Error checking user existence:", error);
      return false;
    }
  }

  async findWalletByUsername(
    registryBlobId: string,
    username: string,
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('wallet_address')
        .ilike('username', username.trim())
        .maybeSingle();

      if (error) throw error;
      return data?.wallet_address || null;
    } catch (error) {
      console.error("[WALRUS_MANAGER] Error in findWalletByUsername:", error);
      return null;
    }
  }
}

export const getWalrusUserManager = () => WalrusUserManager.getInstance();
