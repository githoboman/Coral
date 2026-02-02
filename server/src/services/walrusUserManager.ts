// ============================================================================
// WalrusUserManager - Manage user profiles on Walrus
// ============================================================================

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";
import { WalrusFile } from "@mysten/walrus";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
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

export class WalrusUserManager {
  private client: any;
  private keypair: Ed25519Keypair;

  constructor(privateKey?: string) {
    const baseClient = new SuiClient({
      url: getFullnodeUrl("testnet"),
    });

    // Try to extend with walrus - configuration may vary by SDK version
    try {
      this.client = baseClient.$extend(
        walrus({
          uploadRelay: {
            host: "https://upload-relay.testnet.walrus.space",
            sendTip: { max: 1_000 },
          },
        }),
      );
    } catch (error) {
      // Fallback: try without network parameter
      this.client = baseClient.$extend(
        walrus({
          uploadRelay: {
            host: "https://upload-relay.testnet.walrus.space",
            sendTip: { max: 1_000 },
          },
        } as any),
      );
    }

    const key = privateKey ?? process.env.WALRUS_PRIVATE_KEY;

    if (!key) {
      throw new Error("WALRUS_PRIVATE_KEY is not set");
    }

    const { secretKey } = decodeSuiPrivateKey(key);
    this.keypair = Ed25519Keypair.fromSecretKey(secretKey);

    console.log("✅ WalrusUserManager initialized");
    console.log(`   Wallet: ${this.keypair.getPublicKey().toSuiAddress()}`);
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
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📥 Fetching users registry: ${blobId} (attempt ${attempt}/${maxRetries})`,
        );

        const [file] = await this.client.walrus.getFiles({
          ids: [blobId],
        });

        const bytes = await file.bytes();
        const rawText = new TextDecoder("utf-8", { fatal: false }).decode(
          bytes,
        );

        // Locate JSON boundaries
        const start = rawText.indexOf("{");
        const end = rawText.lastIndexOf("}");

        if (start === -1 || end === -1 || end <= start) {
          throw new Error("Could not locate JSON boundaries");
        }

        let jsonText = rawText.slice(start, end + 1);

        // Strip control characters
        jsonText = jsonText.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

        const registry = JSON.parse(jsonText);

        console.log("✅ Users registry fetched successfully");
        console.log(`   Version: ${registry.version}`);
        console.log(`   Total users: ${registry.total_users}`);

        return registry;
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️  Attempt ${attempt} failed:`, lastError.message);

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

        const file = WalrusFile.from({
          contents: registryBytes,
          identifier: `users_registry_v${registry.version}_${Date.now()}`,
          tags: {
            type: "users_registry",
            version: registry.version.toString(),
            category: "user_management",
          },
        });

        const results = await this.client.walrus.writeFiles({
          files: [file],
          epochs: 50,
          deletable: false,
          signer: this.keypair,
        });

        const blobId = results[0].blobId;

        console.log("✅ Upload successful!");
        console.log(`   Blob ID: ${blobId}`);
        console.log(`   Size: ${registryBytes.length} bytes`);
        console.log(`   Users: ${registry.total_users}`);

        return blobId;
      } catch (error) {
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
}
