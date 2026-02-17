// server/src/services/walrusUserManager.ts
import axios from "axios";
import "dotenv/config";
import { getEncryptionService, type EncryptedData } from "./encryptionService";

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

  // Telegram Integration
  telegram_username?: EncryptedData | string;
  telegram_chat_id?: EncryptedData | string;
  telegram_linked_at?: string;
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

  // Telegram Integration
  telegram_username?: string;
  telegram_chat_id?: string;
  telegram_linked_at?: string;
}

export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>;
  description: string;
  previous_blob?: string;
}

export interface WalrusUploadResponse {
  newlyCreated?: {
    blobObject: {
      id: string;
      storedEpoch: number;
      blobId: string;
      size: number;
      encodingType: string;
      certifiedEpoch: number;
      storage: {
        id: string;
        startEpoch: number;
        endEpoch: number;
        storageSize: number;
      };
    };
    encodedSize: number;
    cost: number;
  };
  alreadyCertified?: {
    blobId: string;
    event: {
      txDigest: string;
      eventSeq: string;
    };
    endEpoch: number;
  };
}

export class WalrusUserManager {
  private static instance: WalrusUserManager;
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;
  private registryCache: { blobId: string; registry: UsersRegistry } | null =
    null;
  private encryption = getEncryptionService();

  private constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL ||
      "https://publisher.walrus-testnet.walrus.space";
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL ||
      "https://aggregator.walrus-testnet.walrus.space";
    this.epochs = parseInt(process.env.WALRUS_EPOCHS || "50", 10);

    console.log("✅ WalrusUserManager initialized");
    console.log(`   Publisher: ${this.publisherUrl}`);
    console.log(`   Aggregator: ${this.aggregatorUrl}`);
  }

  public static getInstance(): WalrusUserManager {
    if (!WalrusUserManager.instance) {
      WalrusUserManager.instance = new WalrusUserManager();
    }
    return WalrusUserManager.instance;
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

    // Telegram Integration
    if (additionalData?.telegram_username) {
      profile.telegram_username = this.encryption.encrypt(
        additionalData.telegram_username,
      );
    }
    if (additionalData?.telegram_chat_id) {
      profile.telegram_chat_id = this.encryption.encrypt(
        additionalData.telegram_chat_id,
      );
    }
    if (additionalData?.telegram_linked_at) {
      profile.telegram_linked_at = additionalData.telegram_linked_at;
    }

    return profile;
  }

  private decryptProfile(profile: UserProfile): DecryptedUserProfile {
    return {
      email: this.encryption.decryptOptional(profile.email) || "",
      wallet_address: profile.wallet_address,
      is_waitlisted: profile.is_waitlisted,
      points_awarded: profile.points_awarded,
      joined_at: profile.joined_at,
      username: this.encryption.decryptOptional(profile.username),
      first_name: this.encryption.decryptOptional(profile.first_name),
      last_name: this.encryption.decryptOptional(profile.last_name),
      preferences: this.encryption.decryptPreferences(profile.preferences),
      waitlist_verified_at: profile.waitlist_verified_at,

      // Chat system
      chat_registry_blob_id: profile.chat_registry_blob_id,

      // Task system
      task_registry_blob_id: profile.task_registry_blob_id,

      // Task tracking
      tasks_created_today: profile.tasks_created_today || 0,
      tasks_claimed_today: profile.tasks_claimed_today || 0,
      last_task_reset_date: profile.last_task_reset_date,

      // Check-in streak tracking
      current_streak: profile.current_streak || 0,
      last_checkin_date: profile.last_checkin_date,
      total_checkins: profile.total_checkins || 0,

      // Subscription
      subscription_tier: profile.subscription_tier || 0,
      subscription_expires_at: profile.subscription_expires_at,
      daily_prompts_used: profile.daily_prompts_used || 0,
      last_prompt_date: profile.last_prompt_date,

      // Telegram Integration
      telegram_username: this.encryption.decryptOptional(
        profile.telegram_username,
      ),
      telegram_chat_id: this.encryption.decryptOptional(
        profile.telegram_chat_id,
      ),
      telegram_linked_at: profile.telegram_linked_at,
    };
  }

  async fetchUsersRegistry(
    blobId: string,
    maxRetries: number = 3,
  ): Promise<UsersRegistry | null> {
    if (this.registryCache && this.registryCache.blobId === blobId) {
      console.log(`📋 Returning cached registry for ${blobId}`);
      return this.registryCache.registry;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📥 Fetching users registry: ${blobId} (attempt ${attempt}/${maxRetries})`,
        );

        const response = await axios.get(
          `${this.aggregatorUrl}/v1/blobs/${blobId}`,
          {
            timeout: 30000,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const registry = response.data as UsersRegistry;

        console.log("✅ Users registry fetched successfully (encrypted)");
        console.log(`   Version: ${registry.version}`);
        console.log(`   Total users: ${registry.total_users}`);

        this.registryCache = { blobId, registry };
        return registry;
      } catch (error: any) {
        lastError = error as Error;
        console.warn(`⚠️  Attempt ${attempt} failed:`, lastError.message);

        if (error.response?.status === 404) {
          console.error("❌ Registry blob not found");
          return null;
        }

        if (attempt < maxRetries) {
          const waitTime = 1500 * attempt;
          console.log(`   Waiting ${waitTime}ms before retry...`);
          await new Promise((r) => setTimeout(r, waitTime));
        }
      }
    }

    console.error("❌ Failed to fetch users registry after all retries");
    throw lastError || new Error("Failed to fetch users registry");
  }

  async uploadUsersRegistry(
    registry: UsersRegistry,
    maxRetries: number = 3,
  ): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📤 Uploading users registry (attempt ${attempt}/${maxRetries})...`,
        );

        const registryJson = JSON.stringify(registry, null, 2);
        const registryBytes = new TextEncoder().encode(registryJson);

        const response = await axios.put(
          `${this.publisherUrl}/v1/blobs`,
          registryJson,
          {
            headers: {
              "Content-Type": "application/json",
            },
            params: {
              epochs: this.epochs,
            },
            timeout: 30000,
          },
        );

        const result = response.data as WalrusUploadResponse;

        const blobId =
          result.newlyCreated?.blobObject?.blobId ||
          result.alreadyCertified?.blobId;

        if (!blobId) {
          throw new Error("No blob ID returned from Walrus");
        }

        console.log("✅ Upload successful!");
        console.log(`   Blob ID: ${blobId}`);
        console.log(`   Size: ${registryBytes.length} bytes`);
        console.log(`   Users: ${registry.total_users}`);

        if (result.newlyCreated) {
          console.log(`   Cost: ${result.newlyCreated.cost} MIST`);
        }

        return blobId;
      } catch (error: any) {
        lastError = error as Error;
        console.warn(
          `⚠️  Attempt ${attempt} failed:`,
          error instanceof Error ? error.message : error,
        );

        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`   Retrying in ${waitTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    console.error("❌ All upload attempts failed");
    throw lastError || new Error("Upload failed");
  }

  async addOrUpdateUser(
    currentBlobId: string | null,
    userProfile: UserProfile,
  ): Promise<string | null> {
    try {
      console.log(
        `\n➕ Adding/updating user: ${userProfile.wallet_address}...`,
      );

      let registry: UsersRegistry;

      if (currentBlobId) {
        const existing = await this.fetchUsersRegistry(currentBlobId);
        if (!existing) {
          throw new Error("Could not fetch existing registry");
        }

        registry = {
          version: existing.version + 1,
          updated_at: new Date().toISOString(),
          total_users: existing.total_users,
          users: { ...existing.users },
          description: `Updated user: ${userProfile.wallet_address}`,
          previous_blob: currentBlobId,
        };

        const userExists = !!registry.users[userProfile.wallet_address];
        if (!userExists) {
          registry.total_users += 1;
        }

        registry.users[userProfile.wallet_address] = userProfile;
      } else {
        registry = {
          version: 1,
          updated_at: new Date().toISOString(),
          total_users: 1,
          users: {
            [userProfile.wallet_address]: userProfile,
          },
          description: "Initial users registry",
        };
      }

      const newBlobId = await this.uploadUsersRegistry(registry);

      if (newBlobId) {
        this.registryCache = { blobId: newBlobId, registry };
      }

      if (newBlobId) {
        console.log("\n✅ User registry updated!");
        if (currentBlobId) {
          console.log(`   Old Blob ID: ${currentBlobId}`);
        }
        console.log(`   New Blob ID: ${newBlobId}`);
        console.log(`   Total users: ${registry.total_users}`);
      }

      return newBlobId;
    } catch (error) {
      console.error("❌ Error updating user registry:", error);
      return null;
    }
  }

  async getUserProfile(
    registryBlobId: string,
    walletAddress: string,
  ): Promise<DecryptedUserProfile | null> {
    // Propagate errors so caller knows if fetch failed vs user not found
    const registry = await this.fetchUsersRegistry(registryBlobId);
    
    // If registry is null (shouldn't happen with throw change, but for type safety)
    if (!registry) { 
      throw new Error("Failed to retrieve user registry");
    }

    const encryptedProfile = registry.users[walletAddress];
    if (!encryptedProfile) {
      return null; // User genuinely doesn't exist in this registry
    }

    return this.decryptProfile(encryptedProfile);
  }

  async findWalletByEmail(
    registryBlobId: string,
    email: string,
  ): Promise<string | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) return null;

      const normalised = email.toLowerCase().trim();

      for (const [walletAddress, encryptedProfile] of Object.entries(
        registry.users,
      )) {
        const decryptedEmail = this.encryption.decryptOptional(
          encryptedProfile.email,
        );
        if (decryptedEmail?.toLowerCase().trim() === normalised) {
          return walletAddress;
        }
      }

      return null;
    } catch (error) {
      console.error("Error in findWalletByEmail:", error);
      return null;
    }
  }

  async findWalletByTelegramChatId(
    registryBlobId: string,
    chatId: string,
  ): Promise<string | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) return null;

      const targetChatId = chatId.toString().trim();

      for (const [walletAddress, encryptedProfile] of Object.entries(
        registry.users,
      )) {
        const decryptedChatId = this.encryption.decryptOptional(
          encryptedProfile.telegram_chat_id,
        );
        if (decryptedChatId === targetChatId) {
          return walletAddress;
        }
      }

      return null;
    } catch (error) {
      console.error("Error in findWalletByTelegramChatId:", error);
      return null;
    }
  }

  async userExists(
    registryBlobId: string,
    walletAddress: string,
  ): Promise<boolean> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) {
        return false;
      }

      return !!registry.users[walletAddress];
    } catch (error) {
      console.error("Error checking user existence:", error);
      return false;
    }
  }

  async verifyBlob(blobId: string): Promise<boolean> {
    try {
      await axios.head(`${this.aggregatorUrl}/v1/blobs/${blobId}`, {
        timeout: 10000,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  async findWalletByUsername(
    registryBlobId: string,
    username: string,
  ): Promise<string | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) return null;

      const targetUsername = username.toLowerCase().trim();

      for (const [walletAddress, encryptedProfile] of Object.entries(
        registry.users,
      )) {
        const decryptedUsername = this.encryption.decryptOptional(
          encryptedProfile.username,
        );
        if (decryptedUsername?.toLowerCase().trim() === targetUsername) {
          return walletAddress;
        }
      }

      return null;
    } catch (error) {
      console.error("Error in findWalletByUsername:", error);
      return null;
    }
  }

  getBlobUrl(blobId: string): string {
    return `${this.aggregatorUrl}/v1/blobs/${blobId}`;
  }
}

export const getWalrusUserManager = () => WalrusUserManager.getInstance();

