import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedData {
  iv: string;
  salt: string;
  tag: string;
  encrypted: string;
}

class EncryptionService {
  private masterKey: Buffer;

  constructor() {
    const masterPassword = process.env.ENCRYPTION_MASTER_KEY;

    if (!masterPassword) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY not set in environment variables. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }

    // Derive a consistent key from the master password
    const masterSalt = Buffer.from('tovira-encryption-v1', 'utf-8');
    this.masterKey = crypto.pbkdf2Sync(
      masterPassword,
      masterSalt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(plaintext: string): EncryptedData {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const salt = crypto.randomBytes(SALT_LENGTH);

      const key = crypto.pbkdf2Sync(
        this.masterKey,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha256'
      );

      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      return {
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        tag: tag.toString('base64'),
        encrypted: encrypted.toString('base64'),
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt encrypted data
   */
  decrypt(encryptedData: EncryptedData): string {
    try {
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const tag = Buffer.from(encryptedData.tag, 'base64');
      const encrypted = Buffer.from(encryptedData.encrypted, 'base64');

      const key = crypto.pbkdf2Sync(
        this.masterKey,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha256'
      );

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Check if data is encrypted
   */
  isEncrypted(data: unknown): data is EncryptedData {
    return (
      typeof data === 'object' &&
      data !== null &&
      'iv' in data &&
      'salt' in data &&
      'tag' in data &&
      'encrypted' in data
    );
  }

  /**
   * Safely encrypt optional value
   */
  encryptOptional(value: string | undefined): EncryptedData | undefined {
    return value ? this.encrypt(value) : undefined;
  }

  /**
   * Safely decrypt optional value
   */
  decryptOptional(value: EncryptedData | string | undefined): string | undefined {
    if (!value) return undefined;
    if (this.isEncrypted(value)) {
      return this.decrypt(value);
    }
    return value as string;
  }

  /**
   * Encrypt preferences object
   */
  encryptPreferences(preferences: Record<string, unknown> | undefined): EncryptedData | undefined {
    if (!preferences || Object.keys(preferences).length === 0) {
      return undefined;
    }
    return this.encrypt(JSON.stringify(preferences));
  }

  /**
   * Decrypt preferences object
   */
  decryptPreferences(encrypted: EncryptedData | Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!encrypted) return undefined;

    if (this.isEncrypted(encrypted)) {
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    }

    return encrypted as Record<string, unknown>;
  }
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService();
  }
  return encryptionService;
}

export { EncryptionService };
