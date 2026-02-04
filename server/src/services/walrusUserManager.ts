import axios from "axios";
import "dotenv/config";
import { getEncryptionService, type EncryptedData } from "./encryptionService";

// User profile with encrypted PII fields
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

// Decrypted version for internal use
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

export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>; // wallet_address -> encrypted profile
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
  private encryption = getEncryptionService();

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

  /**
   * Create a user profile with encrypted PII
   */
  createUserProfile(
    email: string,
    walletAddress: string,
    isWaitlisted: boolean,
    pointsAwarded: number,
    additionalData?: Partial<DecryptedUserProfile>,
  ): UserProfile {
    const normalizedEmail = email.toLowerCase().trim();

    // Encrypt PII fields
    const profile: UserProfile = {
      email: this.encryption.encrypt(normalizedEmail),
      wallet_address: walletAddress, // NOT encrypted
      is_waitlisted: isWaitlisted, // NOT encrypted
      points_awarded: pointsAwarded, // NOT encrypted
      joined_at: new Date().toISOString(), // NOT encrypted
    };

    // Encrypt optional PII fields if provided
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

    return profile;
  }

  /**
   * Decrypt a user profile
   */
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

        // Cache the encrypted registry
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

        // Store encrypted profile
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

  /**
   * Get a user profile and decrypt it
   */
  async getUserProfile(
    registryBlobId: string,
    walletAddress: string,
  ): Promise<DecryptedUserProfile | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) {
        return null;
      }

      const encryptedProfile = registry.users[walletAddress];
      if (!encryptedProfile) {
        return null;
      }

      // Decrypt and return
      return this.decryptProfile(encryptedProfile);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
  }

  /**
   * Find wallet by email (requires decrypting all emails)
   */
  async findWalletByEmail(
    registryBlobId: string,
    email: string,
  ): Promise<string | null> {
    try {
      const registry = await this.fetchUsersRegistry(registryBlobId);
      if (!registry) return null;

      const normalised = email.toLowerCase().trim();

      // Must decrypt each email to compare
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

  getBlobUrl(blobId: string): string {
    return `${this.aggregatorUrl}/v1/blobs/${blobId}`;
  }
}
