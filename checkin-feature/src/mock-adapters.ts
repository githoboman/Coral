
import {
  StorageAdapter,
  BlockchainAdapter,
  KeyManagerAdapter,
  CheckInData
} from './types';

export class MockStorageAdapter implements StorageAdapter {
  private data = new Map<string, CheckInData>();

  loadUserCheckinData(userId: string, password: string): CheckInData {
    const key = `${userId}_${password}`;
    return this.data.get(key) || { checkins: [], total: 0, last_checkin: null };
  }

  saveUserCheckinData(userId: string, password: string, data: CheckInData): boolean {
    const key = `${userId}_${password}`;
    this.data.set(key, data);
    return true;
  }

  storeEncryptedUserData(publicKey: string, data: CheckInData): string | null {
    return `blob_${Date.now()}`;
  }
}

export class MockBlockchainAdapter implements BlockchainAdapter {
  private profiles = new Map<string, any>();
  private checkins = new Map<string, number>();

  getUserDetails(profileId: string): Record<string, any> | null {
    return this.profiles.get(profileId) || null;
  }

  checkin(profileId: string): boolean {
    this.checkins.set(profileId, Date.now());
    return true;
  }

  updateEncryptedData(profileId: string, blobId: string): boolean {
    this.profiles.set(profileId, { last_checkin: Date.now(), blob_id: blobId });
    return true;
  }
}

export class MockKeyManagerAdapter implements KeyManagerAdapter {
  private keys = new Map<string, string>();

  getUserPublicKey(userId: string): string | null {
    return this.keys.get(userId) || null;
  }
}
