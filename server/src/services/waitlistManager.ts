// ============================================================================
// FILE 1: src/services/WaitlistManager.ts (FIXED - PROPER SDK USAGE)
// ============================================================================
/**
 * Waitlist Access Control System using Walrus
 * ===========================================
 *
 * ARCHITECTURE:
 * 1. Store email whitelist on Walrus (immutable, decentralized)
 * 2. Frontend checks email against Walrus before registration
 * 3. Admin can manually add new emails (creates new version)
 */

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";
import { WalrusFile } from "@mysten/walrus";
import * as fs from "fs/promises";
import * as path from "path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

// ============================================================================
// TYPES
// ============================================================================

export interface Whitelist {
  version: number;
  created_at: string;
  total_count: number;
  emails: string[]; // Plaintext for now, will hash with Seal later
  description: string;
  previous_blob?: string;
}

export interface MigrationRecord {
  migration_date: string;
  whitelist_blob_id: string;
  email_count: number;
  storage: string;
  version: number;
}

export class WaitlistManager {
  private client: any;
  private keypair: Ed25519Keypair;

  constructor(privateKey?: string) {
    // Initialize SuiClient with Walrus extension
    // Note: The 'network' parameter may vary based on SDK version
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

    console.log("✅ WaitlistManager initialized");
    console.log(`   Wallet: ${this.keypair.getPublicKey().toSuiAddress()}`);
  }

  // ==========================================================================
  // EMAIL LOADING
  // ==========================================================================

  /**
   * Load emails from CSV file
   * Format: email header, then one email per line
   */
  async loadFromCSV(csvPath: string): Promise<string[]> {
    try {
      console.log(`📁 Loading emails from ${csvPath}...`);

      const content = await fs.readFile(csvPath, "utf-8");
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        throw new Error("CSV file is empty");
      }

      if (lines[0].toLowerCase() !== "email") {
        throw new Error('First line must be "email"');
      }

      const emails = lines.slice(1).filter((email) => {
        // Basic email validation
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      });

      console.log(`✅ Loaded ${emails.length} valid emails`);
      return emails;
    } catch (error) {
      console.error("❌ Error loading CSV:", error);
      throw error;
    }
  }

  /**
   * Load emails from JSON backup
   */
  async loadFromJSON(jsonPath: string): Promise<string[]> {
    try {
      console.log(`📁 Loading emails from ${jsonPath}...`);

      const content = await fs.readFile(jsonPath, "utf-8");
      const data = JSON.parse(content);

      const emails = data.emails || [];
      console.log(`✅ Loaded ${emails.length} emails from backup`);
      return emails;
    } catch (error) {
      console.error("❌ Error loading JSON:", error);
      throw error;
    }
  }

  createWhitelist(emails: string[], description?: string): Whitelist {
    console.log(`🔐 Creating whitelist from ${emails.length} emails...`);

    // Remove duplicates and normalize
    const uniqueEmails = [
      ...new Set(emails.map((e) => e.toLowerCase().trim())),
    ];

    const whitelist: Whitelist = {
      version: 1,
      created_at: new Date().toISOString(),
      total_count: uniqueEmails.length,
      emails: uniqueEmails,
      description: description || "Waitlist - stored on Walrus",
    };

    console.log("✅ Whitelist created");
    console.log(`   Total entries: ${whitelist.total_count}`);
    return whitelist;
  }

  /**
   * Upload whitelist to Walrus using Quilt
   */
  async uploadToWalrus(
    whitelist: Whitelist,
    maxRetries: number = 3,
  ): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📤 Uploading to Walrus (attempt ${attempt}/${maxRetries})...`,
        );

        // Convert whitelist to bytes
        const whitelistJson = JSON.stringify(whitelist, null, 2);
        const whitelistBytes = new TextEncoder().encode(whitelistJson);

        // Create WalrusFile
        const file = WalrusFile.from({
          contents: whitelistBytes,
          identifier: `waitlist_v${whitelist.version}_${Date.now()}`,
          tags: {
            type: "whitelist",
            version: whitelist.version.toString(),
            category: "access_control",
          },
        });

        // Upload with Quilt
        const results = await this.client.walrus.writeFiles({
          files: [file],
          epochs: 50, // Store for 50 epochs
          deletable: false, // Make immutable
          signer: this.keypair,
        });

        const blobId = results[0].blobId;

        console.log("✅ Upload successful!");
        console.log(`   Blob ID: ${blobId}`);
        console.log(`   Size: ${whitelistBytes.length} bytes`);
        console.log(`   Emails: ${whitelist.total_count}`);
        console.log(`   Storage: 50 epochs (~6 months)`);
        console.log(`   Cost: ~0.02 WAL (Quilt optimized)`);

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

  // ==========================================================================
  // WHITELIST RETRIEVAL & VERIFICATION (FIXED - USE SDK getFiles)
  // ==========================================================================

  /**
   * Fetch whitelist from Walrus using SDK's getFiles method
   * This properly decodes Quilt-encoded data and strips any header before JSON.
   */
  async fetchWhitelist(
    blobId: string,
    maxRetries: number = 3,
  ): Promise<Whitelist | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📥 Fetching whitelist: ${blobId} (attempt ${attempt}/${maxRetries})`,
        );

        // Use the SDK's getFiles method - this handles Quilt decoding
        const [file] = await this.client.walrus.getFiles({
          ids: [blobId],
        });

        // Decode the file content
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

        // Slice JSON
        let jsonText = rawText.slice(start, end + 1);

        // 🚨 CRITICAL: strip non-JSON control characters
        jsonText = jsonText.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

        const whitelist = JSON.parse(jsonText);

        console.log("✅ Whitelist fetched successfully");
        console.log(`   Version: ${whitelist.version}`);
        console.log(`   Emails: ${whitelist.total_count}`);

        // Optional: Log identifier and tags if available
        const identifier = await file.getIdentifier();
        const tags = await file.getTags();
        if (identifier) {
          console.log(`   Identifier: ${identifier}`);
        }
        if (tags && Object.keys(tags).length > 0) {
          console.log(`   Tags:`, tags);
        }

        return whitelist;
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

    console.error("❌ Failed to fetch whitelist after all retries");
    console.error("Last error:", lastError?.message);
    return null;
  }

  /**
   * Check if email is whitelisted
   */
  async isEmailWhitelisted(email: string, blobId: string): Promise<boolean> {
    try {
      const normalizedEmail = email.toLowerCase().trim();

      const whitelist = await this.fetchWhitelist(blobId);
      if (!whitelist) {
        console.error("Could not fetch whitelist");
        return false;
      }

      const isWhitelisted = whitelist.emails.includes(normalizedEmail);

      if (isWhitelisted) {
        console.log(`✅ Email "${email}" is whitelisted`);
      } else {
        console.log(`❌ Email "${email}" is NOT whitelisted`);
      }

      return isWhitelisted;
    } catch (error) {
      console.error("Error checking whitelist:", error);
      return false;
    }
  }

  // ==========================================================================
  // WHITELIST UPDATES
  // ==========================================================================

  /**
   * Add new emails to existing whitelist (creates new version)
   */
  async addEmailsToWhitelist(
    newEmails: string[],
    currentBlobId: string,
  ): Promise<string | null> {
    try {
      console.log(`\n➕ Adding ${newEmails.length} new emails to whitelist...`);

      // Fetch current whitelist
      const currentWhitelist = await this.fetchWhitelist(currentBlobId);
      if (!currentWhitelist) {
        throw new Error("Could not fetch current whitelist");
      }

      // Combine emails
      const normalizedNewEmails = newEmails.map((e) => e.toLowerCase().trim());
      const currentEmailsSet = new Set(currentWhitelist.emails);
      const combinedEmails = [...currentWhitelist.emails];

      let addedCount = 0;
      for (const email of normalizedNewEmails) {
        if (!currentEmailsSet.has(email)) {
          combinedEmails.push(email);
          addedCount++;
        }
      }

      if (addedCount === 0) {
        console.log("⚠️  No new emails to add (all duplicates)");
        return currentBlobId;
      }

      // Create updated whitelist
      const updatedWhitelist: Whitelist = {
        version: currentWhitelist.version + 1,
        created_at: new Date().toISOString(),
        total_count: combinedEmails.length,
        emails: combinedEmails,
        description: `Updated waitlist - added ${addedCount} emails`,
        previous_blob: currentBlobId,
      };

      // Upload new version
      const newBlobId = await this.uploadToWalrus(updatedWhitelist);

      if (newBlobId) {
        console.log("\n✅ Whitelist updated!");
        console.log(`   Old Blob ID: ${currentBlobId}`);
        console.log(`   New Blob ID: ${newBlobId}`);
        console.log(`   Added: ${addedCount} emails`);
        console.log(`   Total: ${combinedEmails.length} emails`);
      }

      return newBlobId;
    } catch (error) {
      console.error("❌ Error updating whitelist:", error);
      return null;
    }
  }

  // ==========================================================================
  // MIGRATION & HELPERS
  // ==========================================================================

  /**
   * Complete migration from CSV to Walrus
   */
  async migrateFromCSV(csvPath: string): Promise<string | null> {
    console.log("\n" + "=".repeat(70));
    console.log("WAITLIST MIGRATION: CSV → WALRUS");
    console.log("=".repeat(70));

    // Step 1: Load emails
    const emails = await this.loadFromCSV(csvPath);
    if (emails.length === 0) {
      console.log("❌ No emails to migrate");
      return null;
    }

    // Step 2: Create whitelist
    console.log("\n🔐 Creating whitelist...");
    const whitelist = this.createWhitelist(emails);

    // Step 3: Upload to Walrus
    console.log("\n☁️  Uploading to Walrus...");
    const blobId = await this.uploadToWalrus(whitelist);

    if (!blobId) {
      console.log("❌ Failed to upload whitelist");
      return null;
    }

    // Step 4: Save migration record
    console.log("\n📝 Saving migration record...");
    await this.saveMigrationRecord(blobId, emails.length, whitelist.version);

    console.log("\n" + "=".repeat(70));
    console.log("✅ MIGRATION COMPLETE!");
    console.log("=".repeat(70));
    console.log(`\nWhitelist Blob ID: ${blobId}`);
    console.log(`Total Emails: ${emails.length}`);
    console.log("\nNext Steps:");
    console.log("1. Save this Blob ID in your backend config");
    console.log("2. Update frontend to verify emails against Walrus");
    console.log("3. Test with a whitelisted email");
    console.log("=".repeat(70));

    return blobId;
  }

  /**
   * Save migration record for reference
   */
  async saveMigrationRecord(
    blobId: string,
    emailCount: number,
    version: number,
  ): Promise<void> {
    const record: MigrationRecord = {
      migration_date: new Date().toISOString(),
      whitelist_blob_id: blobId,
      email_count: emailCount,
      storage: "Walrus decentralized network",
      version,
    };

    const recordsDir = path.join(process.cwd(), "migration_records");
    await fs.mkdir(recordsDir, { recursive: true });

    const filename = `migration_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    const filepath = path.join(recordsDir, filename);

    await fs.writeFile(filepath, JSON.stringify(record, null, 2));
    console.log(`Migration record saved: ${filename}`);
  }
}
