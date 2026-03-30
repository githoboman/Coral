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

  // Activity points tracking
  tasks_created_today?: number;
  tasks_claimed_today?: number;
  research_created_today?: number;
  research_claimed_today?: number;
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

  // Research prompts
  daily_research_prompts_used?: number;
  last_research_prompt_date?: string;

  // Tracked wallets
  recently_analyzed?: string[];
  alert_wallets?: string[];
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

  // Activity points tracking
  tasks_created_today?: number;
  tasks_claimed_today?: number;
  research_created_today?: number;
  research_claimed_today?: number;
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

  // Research prompts
  daily_research_prompts_used?: number;
  last_research_prompt_date?: string;

  // Tracked wallets
  recently_analyzed?: string[];
  alert_wallets?: string[];
}

export class UserManager {
  private static instance: UserManager;
  private encryption = getEncryptionService();

  private constructor() {
    // Dedicated to Supabase
  }

  public static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
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

    // Activity tracking
    if (additionalData?.tasks_created_today !== undefined) {
      profile.tasks_created_today = additionalData.tasks_created_today;
    }
    if (additionalData?.tasks_claimed_today !== undefined) {
      profile.tasks_claimed_today = additionalData.tasks_claimed_today;
    }
    if (additionalData?.research_created_today !== undefined) {
      profile.research_created_today = additionalData.research_created_today;
    }
    if (additionalData?.research_claimed_today !== undefined) {
      profile.research_claimed_today = additionalData.research_claimed_today;
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

    // Research prompts
    if (additionalData?.daily_research_prompts_used !== undefined) {
      profile.daily_research_prompts_used = additionalData.daily_research_prompts_used;
    }
    if (additionalData?.last_research_prompt_date) {
      profile.last_research_prompt_date = additionalData.last_research_prompt_date;
    }

    return profile;
  }

  async addOrUpdateUser(
    userProfile: UserProfile,
  ): Promise<string | null> {
    try {
      // Construct Supabase-ready object from UserProfile
      const upsertData: any = {
        wallet_address: userProfile.wallet_address,
        user_id: userProfile.wallet_address,
        is_waitlisted: userProfile.is_waitlisted,
        points: userProfile.points_awarded,
        xp: userProfile.points_awarded, // Sync XP
        joined_at: userProfile.joined_at,
        tasks_created_today: userProfile.tasks_created_today,
        tasks_claimed_today: userProfile.tasks_claimed_today,
        research_created_today: userProfile.research_created_today,
        research_claimed_today: userProfile.research_claimed_today,
        last_task_reset_date: userProfile.last_task_reset_date,
        checkin_streak: userProfile.current_streak,
        last_checkin: userProfile.last_checkin_date,
        total_checkins: userProfile.total_checkins,
        subscription_tier: userProfile.subscription_tier,
        subscription_expires_at: userProfile.subscription_expires_at,
        daily_prompts_used: userProfile.daily_prompts_used,
        last_prompt_date: userProfile.last_prompt_date,
        daily_research_prompts_used: userProfile.daily_research_prompts_used,
        last_research_prompt_date: userProfile.last_research_prompt_date,
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

      console.log(`[USER_MANAGER] Profile saved to Supabase: ${userProfile.wallet_address}`);

      return "supabase_managed";
    } catch (error) {
      console.error("[USER_MANAGER] Error updating user in Supabase:", error);
      return null;
    }
  }

  async getUserProfile(
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
        tasks_created_today: profile.tasks_created_today,
        tasks_claimed_today: profile.tasks_claimed_today,
        research_created_today: profile.research_created_today,
        research_claimed_today: profile.research_claimed_today,
        last_task_reset_date: profile.last_task_reset_date,
        current_streak: profile.checkin_streak,
        last_checkin_date: profile.last_checkin,
        total_checkins: profile.total_checkins,
        subscription_tier: profile.subscription_tier,
        subscription_expires_at: profile.subscription_expires_at,
        daily_prompts_used: profile.daily_prompts_used,
        last_prompt_date: profile.last_prompt_date,
        daily_research_prompts_used: profile.daily_research_prompts_used,
        last_research_prompt_date: profile.last_research_prompt_date,
        recently_analyzed: profile.recently_analyzed || [],
        alert_wallets: profile.alert_wallets || [],
      };
    } catch (error) {
      console.error("[USER_MANAGER] Error fetching profile from Supabase:", error);
      throw error;
    }
  }

  async findWalletByEmail(
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
      console.error("[USER_MANAGER] Error in findWalletByEmail:", error);
      return null;
    }
  }

  async userExists(
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
      console.error("[USER_MANAGER] Error checking user existence:", error);
      return false;
    }
  }

  async findWalletByUsername(
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
      console.error("[USER_MANAGER] Error in findWalletByUsername:", error);
      return null;
    }
  }

  /**
   * Surgical update for check-in statistics to avoid race conditions.
   * Increments points and total_checkins, updates streak and last_checkin.
   */
  async updateCheckinStats(
    walletAddress: string,
    pointsToAdd: number,
    streakDay: number,
    lastCheckinDate: string
  ): Promise<boolean> {
    try {
      const { data: profile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('points, total_checkins')
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError) throw fetchError;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          points: (profile.points || 0) + pointsToAdd,
          xp: (profile.points || 0) + pointsToAdd, // Sync XP
          checkin_streak: streakDay,
          last_checkin: lastCheckinDate,
          total_checkins: (profile.total_checkins || 0) + 1
        })
        .eq('wallet_address', walletAddress);

      if (updateError) throw updateError;
      return true;
    } catch (error) {
      console.error("[USER_MANAGER] Error updating check-in stats surgical:", error);
      return false;
    }
  }

  /**
   * Surgical increment for daily prompt usage counters.
   */
  async incrementPromptUsage(
    walletAddress: string,
    type: 'task' | 'research',
    today: string
  ): Promise<boolean> {
    try {
      const field = type === 'task' ? 'daily_prompts_used' : 'daily_research_prompts_used';
      const dateField = type === 'task' ? 'last_prompt_date' : 'last_research_prompt_date';

      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select(`${field}, ${dateField}`)
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError) throw fetchError;

      const profile = data as any;
      const needsReset = !profile[dateField] || profile[dateField] !== today;
      const newValue = needsReset ? 1 : (profile[field] || 0) + 1;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          [field]: newValue,
          [dateField]: today
        })
        .eq('wallet_address', walletAddress);

      if (updateError) throw updateError;
      return true;
    } catch (error) {
      console.error(`[USER_MANAGER] Error incrementing ${type} prompt usage:`, error);
      return false;
    }
  }

  /**
   * Surgical increment for daily activity counters (tasks/research created).
   */
  async incrementActivityCount(
    walletAddress: string,
    type: 'task' | 'research',
    today: string
  ): Promise<boolean> {
    try {
      const field = type === 'task' ? 'tasks_created_today' : 'research_created_today';
      const claimedField = type === 'task' ? 'tasks_claimed_today' : 'research_claimed_today';
      const resetDateField = 'last_task_reset_date';

      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select(`${field}, ${claimedField}, ${resetDateField}`)
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError) throw fetchError;

      const profile = data as any;
      const needsReset = !profile[resetDateField] || profile[resetDateField] !== today;

      const updateData: any = {
        [resetDateField]: today
      };

      if (needsReset) {
        updateData.tasks_created_today = type === 'task' ? 1 : 0;
        updateData.research_created_today = type === 'research' ? 1 : 0;
        updateData.tasks_claimed_today = 0;
        updateData.research_claimed_today = 0;
      } else {
        updateData[field] = (profile[field] || 0) + 1;
      }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('wallet_address', walletAddress);

      if (updateError) throw updateError;
      return true;
    } catch (error) {
      console.error(`[USER_MANAGER] Error incrementing ${type} activity count:`, error);
      return false;
    }
  }

  /**
   * Prepends a wallet address to the recently_analyzed array, capped at 5.
   */
  async addRecentlyAnalyzed(
    walletAddress: string,
    analyzedWallet: string
  ): Promise<string[] | null> {
    try {
      // First fetch the current array
      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('recently_analyzed')
        .eq('wallet_address', walletAddress)
        .single();
        
      if (fetchError) throw fetchError;
      
      let currentArray: string[] = data?.recently_analyzed || [];
      
      // Remove if it exists to avoid duplicates
      currentArray = currentArray.filter(addr => addr !== analyzedWallet);
      
      // Prepend the new one
      currentArray.unshift(analyzedWallet);
      
      // Keep only last 5
      currentArray = currentArray.slice(0, 5);
      
      // Update DB
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ recently_analyzed: currentArray })
        .eq('wallet_address', walletAddress);
        
      if (updateError) throw updateError;
      
      return currentArray;
    } catch (error) {
      console.error("[USER_MANAGER] Error updating recently analyzed:", error);
      return null;
    }
  }

  /**
   * Adds an alert wallet to the user's alert_wallets array, capped at 3.
   */
  async addAlertWallet(
    walletAddress: string,
    alertWallet: string
  ): Promise<string[] | null> {
    try {
      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('alert_wallets')
        .eq('wallet_address', walletAddress)
        .single();
        
      if (fetchError) throw fetchError;
      
      let currentArray: string[] = data?.alert_wallets || [];
      
      // Avoid duplicates
      if (currentArray.includes(alertWallet)) return currentArray;
      
      // Enforce limit of 3
      if (currentArray.length >= 3) return currentArray;
      
      currentArray.push(alertWallet);
      
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ alert_wallets: currentArray })
        .eq('wallet_address', walletAddress);
        
      if (updateError) throw updateError;
      
      return currentArray;
    } catch (error) {
      console.error("[USER_MANAGER] Error adding alert wallet:", error);
      return null;
    }
  }

  /**
   * Removes an alert wallet from the user's alert_wallets array.
   */
  async removeAlertWallet(
    walletAddress: string,
    alertWallet: string
  ): Promise<string[] | null> {
    try {
      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('alert_wallets')
        .eq('wallet_address', walletAddress)
        .single();
        
      if (fetchError) throw fetchError;
      
      let currentArray: string[] = data?.alert_wallets || [];
      
      currentArray = currentArray.filter(addr => addr !== alertWallet);
      
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ alert_wallets: currentArray })
        .eq('wallet_address', walletAddress);
        
      if (updateError) throw updateError;
      
      return currentArray;
    } catch (error) {
      console.error("[USER_MANAGER] Error removing alert wallet:", error);
      return null;
    }
  }

  /**
   * Cleans up the tracked_wallet_state entry for a specific owner and tracked wallet.
   * Called when a user unsubscribes from alerts.
   */
  async cleanupTrackedWalletState(
    ownerAddress: string,
    trackedAddress: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('tracked_wallet_state')
        .delete()
        .eq('owner_user_id', ownerAddress)
        .eq('tracked_address', trackedAddress);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("[USER_MANAGER] Error cleaning up tracked wallet state:", error);
      return false;
    }
  }
}

export const getUserManager = () => UserManager.getInstance();
