import { getEncryptionService, type EncryptedData } from './encryption';

// Types
export interface UserProfile {
  email: EncryptedData | string;
  wallet_address: string;
  is_waitlisted: boolean;
  points_awarded: number;
  joined_at: string;
  username?: EncryptedData | string;
  first_name?: EncryptedData | string;
  last_name?: EncryptedData | string;
  preferences?: EncryptedData | Record<string, unknown>;
  waitlist_verified_at?: string;
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
  preferences?: Record<string, unknown>;
  waitlist_verified_at?: string;
}

export interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>;
  description: string;
  previous_blob?: string;
}

interface WalrusUploadResponse {
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

// Config
const WALRUS_PUBLISHER_URL = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';
const WALRUS_EPOCHS = parseInt(process.env.WALRUS_EPOCHS || '50', 10);

// Registry cache
let registryCache: { blobId: string; registry: UsersRegistry } | null = null;

/**
 * Create an encrypted user profile
 */
export function createUserProfile(
  email: string,
  walletAddress: string,
  isWaitlisted: boolean,
  pointsAwarded: number,
  additionalData?: Partial<DecryptedUserProfile>
): UserProfile {
  const encryption = getEncryptionService();
  const normalizedEmail = email.toLowerCase().trim();

  const profile: UserProfile = {
    email: encryption.encrypt(normalizedEmail),
    wallet_address: walletAddress,
    is_waitlisted: isWaitlisted,
    points_awarded: pointsAwarded,
    joined_at: new Date().toISOString(),
  };

  if (additionalData?.username) {
    profile.username = encryption.encrypt(additionalData.username);
  }
  if (additionalData?.first_name) {
    profile.first_name = encryption.encrypt(additionalData.first_name);
  }
  if (additionalData?.last_name) {
    profile.last_name = encryption.encrypt(additionalData.last_name);
  }
  if (additionalData?.preferences) {
    profile.preferences = encryption.encryptPreferences(additionalData.preferences);
  }
  if (additionalData?.waitlist_verified_at) {
    profile.waitlist_verified_at = additionalData.waitlist_verified_at;
  }

  return profile;
}

/**
 * Decrypt a user profile
 */
export function decryptProfile(profile: UserProfile): DecryptedUserProfile {
  const encryption = getEncryptionService();
  return {
    email: encryption.decryptOptional(profile.email) || '',
    wallet_address: profile.wallet_address,
    is_waitlisted: profile.is_waitlisted,
    points_awarded: profile.points_awarded,
    joined_at: profile.joined_at,
    username: encryption.decryptOptional(profile.username),
    first_name: encryption.decryptOptional(profile.first_name),
    last_name: encryption.decryptOptional(profile.last_name),
    preferences: encryption.decryptPreferences(profile.preferences),
    waitlist_verified_at: profile.waitlist_verified_at,
  };
}

/**
 * Fetch users registry from Walrus
 */
export async function fetchUsersRegistry(
  blobId: string,
  maxRetries: number = 3
): Promise<UsersRegistry | null> {
  // Check cache
  if (registryCache && registryCache.blobId === blobId) {
    return registryCache.registry;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`, {
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        console.error('[Walrus] Registry blob not found');
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const registry = (await response.json()) as UsersRegistry;
      registryCache = { blobId, registry };
      return registry;
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Walrus] Fetch attempt ${attempt} failed:`, lastError.message);

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  console.error('[Walrus] Failed to fetch registry after all retries');
  return null;
}

/**
 * Upload users registry to Walrus
 */
export async function uploadUsersRegistry(
  registry: UsersRegistry,
  maxRetries: number = 3
): Promise<string | null> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const registryJson = JSON.stringify(registry, null, 2);

      const response = await fetch(`${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${WALRUS_EPOCHS}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: registryJson,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as WalrusUploadResponse;
      const blobId = result.newlyCreated?.blobObject?.blobId || result.alreadyCertified?.blobId;

      if (!blobId) {
        throw new Error('No blob ID returned from Walrus');
      }

      return blobId;
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Walrus] Upload attempt ${attempt} failed:`, lastError.message);

      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }
  }

  console.error('[Walrus] All upload attempts failed');
  throw lastError || new Error('Upload failed');
}

/**
 * Add or update a user in the registry
 */
export async function addOrUpdateUser(
  currentBlobId: string | null,
  userProfile: UserProfile
): Promise<string | null> {
  try {
    let registry: UsersRegistry;

    if (currentBlobId) {
      const existing = await fetchUsersRegistry(currentBlobId);
      if (!existing) {
        throw new Error('Could not fetch existing registry');
      }

      const userExists = !!existing.users[userProfile.wallet_address];

      registry = {
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        total_users: userExists ? existing.total_users : existing.total_users + 1,
        users: { ...existing.users, [userProfile.wallet_address]: userProfile },
        description: `Updated user: ${userProfile.wallet_address}`,
        previous_blob: currentBlobId,
      };
    } else {
      registry = {
        version: 1,
        updated_at: new Date().toISOString(),
        total_users: 1,
        users: { [userProfile.wallet_address]: userProfile },
        description: 'Initial users registry',
      };
    }

    const newBlobId = await uploadUsersRegistry(registry);

    if (newBlobId) {
      registryCache = { blobId: newBlobId, registry };
    }

    return newBlobId;
  } catch (error) {
    console.error('[Walrus] Error updating user registry:', error);
    return null;
  }
}

/**
 * Get decrypted user profile from registry
 */
export async function getUserProfile(
  registryBlobId: string,
  walletAddress: string
): Promise<DecryptedUserProfile | null> {
  try {
    const registry = await fetchUsersRegistry(registryBlobId);
    if (!registry) return null;

    const encryptedProfile = registry.users[walletAddress];
    if (!encryptedProfile) return null;

    return decryptProfile(encryptedProfile);
  } catch (error) {
    console.error('[Walrus] Error fetching user profile:', error);
    return null;
  }
}

/**
 * Check if user exists in registry
 */
export async function userExists(
  registryBlobId: string,
  walletAddress: string
): Promise<boolean> {
  try {
    const registry = await fetchUsersRegistry(registryBlobId);
    if (!registry) return false;
    return !!registry.users[walletAddress];
  } catch (error) {
    console.error('[Walrus] Error checking user existence:', error);
    return false;
  }
}

/**
 * Find wallet address by email
 */
export async function findWalletByEmail(
  registryBlobId: string,
  email: string
): Promise<string | null> {
  try {
    const registry = await fetchUsersRegistry(registryBlobId);
    if (!registry) return null;

    const encryption = getEncryptionService();
    const normalised = email.toLowerCase().trim();

    for (const [walletAddress, encryptedProfile] of Object.entries(registry.users)) {
      const decryptedEmail = encryption.decryptOptional(encryptedProfile.email);
      if (decryptedEmail?.toLowerCase().trim() === normalised) {
        return walletAddress;
      }
    }

    return null;
  } catch (error) {
    console.error('[Walrus] Error in findWalletByEmail:', error);
    return null;
  }
}

/**
 * Get blob URL
 */
export function getBlobUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`;
}

/**
 * Verify blob exists
 */
export async function verifyBlob(blobId: string): Promise<boolean> {
  try {
    const response = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`, {
      method: 'HEAD',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clear registry cache (useful for testing)
 */
export function clearRegistryCache(): void {
  registryCache = null;
}
