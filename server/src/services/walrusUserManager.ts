// ============================================================================
// WalrusUserManager - Manage user profiles on Walrus (Publisher/Aggregator)
// ============================================================================

import axios from "axios";
import "dotenv/config";

// ============================================================================
// TYPES
// ============================================================================

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
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;
  private registryCache: { blobId: string; registry: UsersRegistry } | null =
    null;

  constructor() {
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

  // ==========================================================================
  // USER PROFILE MANAGEMENT
  // ==========================================================================

  /**
   * Create a new user profile
   */
  createUserProfile(
    email: string,
    walletAddress: string,
    isWaitlisted: boolean,
    pointsAwarded: number,
    additionalData?: Partial<UserProfile>,
  ): UserProfile {
    const profile: UserProfile = {
      email: email.toLowerCase().trim(),
      wallet_address: walletAddress,
      is_waitlisted: isWaitlisted,
      points_awarded: pointsAwarded,
      joined_at: new Date().toISOString(),
      ...additionalData,
    };

    return profile;
  }

  /**
   * Fetch users registry from Walrus
   */
  async fetchUsersRegistry(
    blobId: string,
    maxRetries: number = 3,
  ): Promise<UsersRegistry | null> {
    // Serve from cache if we already have this exact blob.
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

        console.log("✅ Users registry fetched successfully");
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
    return null;
  }

  /**
   * Upload users registry to Walrus
   */
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

  /**
   * Add or update user in registry
   */
  async addOrUpdateUser(
    currentBlobId: string | null,
    userProfile: UserProfile,
  ): Promise<string | null> {
    try {
      console.log(`\n➕ Adding/updating user: ${userProfile.email}...`);

      let registry: UsersRegistry;

      if (currentBlobId) {
        // Fetch existing registry
        const existing = await this.fetchUsersRegistry(currentBlobId);
        if (!existing) {
          throw new Error("Could not fetch existing registry");
        }

        // Update user in registry
        registry = {
          version: existing.version + 1,
          updated_at: new Date().toISOString(),
          total_users: existing.total_users,
          users: { ...existing.users },
          description: `Updated user: ${userProfile.email}`,
          previous_blob: currentBlobId,
        };

        // Check if user already exists
        const userExists = !!registry.users[userProfile.wallet_address];
        if (!userExists) {
          registry.total_users += 1;
        }

        registry.users[userProfile.wallet_address] = userProfile;
      } else {
        // Create new registry
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

      // Upload new version
      const newBlobId = await this.uploadUsersRegistry(registry);

      // Invalidate cache — next fetch must get the new blob.
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

  /**
   * Get user profile by wallet address
   */
  async getUserProfile(
    registryBlobId: string,
    walletAddress: string,
  ): Promise<UserProfile | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) {
        return null;
      }

      return registry.users[walletAddress] || null;
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
  }

  /**
   * Find which wallet (if any) is already registered with this email.
   * Returns the wallet_address string, or null if the email is free.
   */
  async findWalletByEmail(
    registryBlobId: string,
    email: string,
  ): Promise<string | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) return null;

      const normalised = email.toLowerCase().trim();

      for (const profile of Object.values(registry.users)) {
        if (profile.email.toLowerCase().trim() === normalised) {
          return profile.wallet_address;
        }
      }

      return null;
    } catch (error) {
      console.error("Error in findWalletByEmail:", error);
      return null;
    }
  }

  /**
   * Check if user exists in registry
   */
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

  /**
   * Verify blob exists
   */
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

  /**
   * Get blob URL
   */
  getBlobUrl(blobId: string): string {
    return `${this.aggregatorUrl}/v1/blobs/${blobId}`;
  }
}
