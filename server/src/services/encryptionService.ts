import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
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

export class EncryptionService {
  private masterKey: Buffer;

  constructor() {
    const masterPassword = process.env.ENCRYPTION_MASTER_KEY;

    if (!masterPassword) {
      throw new Error(
        "ENCRYPTION_MASTER_KEY not set in environment variables. " +
        "Generate one with: openssl rand -base64 32",
      );
    }

    // Derive a consistent key from the master password (master key, not
    // per-encryption). This salt is a fixed KDF constant. Safe to set here because
    // the agent key is imported fresh from AGENT_IMPORT_KEY and re-encrypted in
    // memory each boot (no-DB mode) — nothing persisted depends on the old value.
    const masterSalt = Buffer.from("coral-encryption-v1", "utf-8");
    this.masterKey = crypto.pbkdf2Sync(
      masterPassword,
      masterSalt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      "sha256",
    );


  }

  /**
   * Encrypt sensitive data
   * Returns an object with IV, salt, auth tag, and encrypted data
   */
  encrypt(plaintext: string): EncryptedData {
    try {
      // Generate random IV and salt for this encryption
      const iv = crypto.randomBytes(IV_LENGTH);
      const salt = crypto.randomBytes(SALT_LENGTH);

      // Derive encryption key from master key + salt
      const key = crypto.pbkdf2Sync(
        this.masterKey,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        "sha256",
      );

      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      // Encrypt
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);

      // Get auth tag
      const tag = cipher.getAuthTag();

      return {
        iv: iv.toString("base64"),
        salt: salt.toString("base64"),
        tag: tag.toString("base64"),
        encrypted: encrypted.toString("base64"),
      };
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("Failed to encrypt data");
    }
  }

  /**
   * Decrypt encrypted data
   * Returns the original plaintext
   */
  decrypt(encryptedData: EncryptedData): string {
    try {
      const iv = Buffer.from(encryptedData.iv, "base64");
      const salt = Buffer.from(encryptedData.salt, "base64");
      const tag = Buffer.from(encryptedData.tag, "base64");
      const encrypted = Buffer.from(encryptedData.encrypted, "base64");

      // Derive the same key
      const key = crypto.pbkdf2Sync(
        this.masterKey,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        "sha256",
      );

      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      // Decrypt
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("Failed to decrypt data");
    }
  }

  /**
   * Check if data is encrypted (has the encrypted structure)
   */
  isEncrypted(data: any): data is EncryptedData {
    return (
      typeof data === "object" &&
      data !== null &&
      typeof data.iv === "string" &&
      typeof data.salt === "string" &&
      typeof data.tag === "string" &&
      typeof data.encrypted === "string"
    );
  }

  /**
   * Safely encrypt a value that might be undefined
   */
  encryptOptional(value: string | undefined): EncryptedData | undefined {
    return value ? this.encrypt(value) : undefined;
  }

  /**
   * Safely decrypt a value that might be undefined or EncryptedData
   */
  decryptOptional(
    value: EncryptedData | string | undefined,
  ): string | undefined {
    if (!value) return undefined;
    if (this.isEncrypted(value)) {
      return this.decrypt(value);
    }
    // If it's already a plain string (legacy data), return as-is
    return value as string;
  }

  /**
   * Encrypt an object of preferences
   */
  encryptPreferences(
    preferences: Record<string, any> | undefined,
  ): EncryptedData | undefined {
    if (!preferences || Object.keys(preferences).length === 0) {
      return undefined;
    }
    return this.encrypt(JSON.stringify(preferences));
  }

  /**
   * Decrypt preferences object
   */
  decryptPreferences(
    encrypted: EncryptedData | Record<string, any> | undefined,
  ): Record<string, any> | undefined {
    if (!encrypted) return undefined;

    if (this.isEncrypted(encrypted)) {
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    }

    // Already decrypted or legacy format
    return encrypted as Record<string, any>;
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
