import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import "dotenv/config";

export interface Whitelist {
  version: number;
  created_at: string;
  total_count: number;
  email_hashes: string[];
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

export class WaitlistManager {
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;
  private cachedWhitelist: Map<string, Whitelist> = new Map();

  constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL ||
      "https://publisher.walrus-testnet.walrus.space";
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL ||
      "https://aggregator.walrus-testnet.walrus.space";
    this.epochs = parseInt(process.env.WALRUS_EPOCHS || "50", 10);

    console.log("✅ WaitlistManager initialized (with email hashing)");
    console.log(`   Publisher: ${this.publisherUrl}`);
    console.log(`   Aggregator: ${this.aggregatorUrl}`);
  }

  private hashEmail(email: string): string {
    const normalized = email.toLowerCase().trim();
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  private hashEmails(emails: string[]): string[] {
    return emails.map((email) => this.hashEmail(email));
  }

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
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      });

      console.log(`✅ Loaded ${emails.length} valid emails`);
      return emails;
    } catch (error) {
      console.error("❌ Error loading CSV:", error);
      throw error;
    }
  }

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

    const uniqueEmails = [
      ...new Set(emails.map((e) => e.toLowerCase().trim())),
    ];

    const emailHashes = this.hashEmails(uniqueEmails);

    console.log(`🔒 Hashed ${uniqueEmails.length} emails with SHA-256`);

    const whitelist: Whitelist = {
      version: 1,
      created_at: new Date().toISOString(),
      total_count: emailHashes.length,
      email_hashes: emailHashes,
      description:
        description || "Waitlist - emails hashed with SHA-256 on Walrus",
    };

    console.log("✅ Whitelist created");
    console.log(`   Total entries: ${whitelist.total_count}`);
    console.log(`   Storage: Email hashes only (irreversible)`);
    return whitelist;
  }

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

        const whitelistJson = JSON.stringify(whitelist, null, 2);
        const whitelistBytes = new TextEncoder().encode(whitelistJson);

        const response = await axios.put(
          `${this.publisherUrl}/v1/blobs`,
          whitelistJson,
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
        console.log(`   Size: ${whitelistBytes.length} bytes`);
        console.log(`   Email hashes: ${whitelist.total_count}`);
        console.log(`   Storage: ${this.epochs} epochs`);

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

  async fetchWhitelist(
    blobId: string,
    maxRetries: number = 3,
  ): Promise<Whitelist | null> {
    const cached = this.cachedWhitelist.get(blobId);
    if (cached) {
      console.log(`📋 Returning cached whitelist for ${blobId}`);
      return cached;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `📥 Fetching whitelist: ${blobId} (attempt ${attempt}/${maxRetries})`,
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

        const whitelist = response.data as Whitelist;

        console.log("✅ Whitelist fetched successfully");
        console.log(`   Version: ${whitelist.version}`);
        console.log(`   Email hashes: ${whitelist.total_count}`);

        this.cachedWhitelist.set(blobId, whitelist);
        return whitelist;
      } catch (error: any) {
        lastError = error as Error;
        console.warn(`⚠️  Attempt ${attempt} failed:`, lastError.message);

        if (error.response?.status === 404) {
          console.error("❌ Blob not found on Walrus");
          return null;
        }

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

  async isEmailWhitelisted(email: string, blobId: string): Promise<boolean> {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const emailHash = this.hashEmail(normalizedEmail);

      const whitelist = await this.fetchWhitelist(blobId);
      if (!whitelist) {
        console.error("Could not fetch whitelist");
        return false;
      }

      const isWhitelisted = whitelist.email_hashes.includes(emailHash);

      if (isWhitelisted) {
        console.log(`✅ Email is whitelisted (hash verified)`);
      } else {
        console.log(`❌ Email is NOT whitelisted`);
      }

      return isWhitelisted;
    } catch (error) {
      console.error("Error checking whitelist:", error);
      return false;
    }
  }

  async addEmailsToWhitelist(
    newEmails: string[],
    currentBlobId: string,
  ): Promise<string | null> {
    try {
      console.log(`\n➕ Adding ${newEmails.length} new emails to whitelist...`);

      const currentWhitelist = await this.fetchWhitelist(currentBlobId);
      if (!currentWhitelist) {
        throw new Error("Could not fetch current whitelist");
      }

      const normalizedNewEmails = newEmails.map((e) => e.toLowerCase().trim());
      const newHashes = this.hashEmails(normalizedNewEmails);

      const currentHashesSet = new Set(currentWhitelist.email_hashes);
      const uniqueNewHashes = newHashes.filter(
        (hash) => !currentHashesSet.has(hash),
      );

      if (uniqueNewHashes.length === 0) {
        console.log("⚠️  No new emails to add (all duplicates)");
        return currentBlobId;
      }

      const combinedHashes = [
        ...currentWhitelist.email_hashes,
        ...uniqueNewHashes,
      ];

      const updatedWhitelist: Whitelist = {
        version: currentWhitelist.version + 1,
        created_at: new Date().toISOString(),
        total_count: combinedHashes.length,
        email_hashes: combinedHashes,
        description: `Updated waitlist - added ${uniqueNewHashes.length} email hashes`,
        previous_blob: currentBlobId,
      };

      const newBlobId = await this.uploadToWalrus(updatedWhitelist);

      if (newBlobId) {
        console.log("\n✅ Whitelist updated!");
        console.log(`   Old Blob ID: ${currentBlobId}`);
        console.log(`   New Blob ID: ${newBlobId}`);
        console.log(`   Added: ${uniqueNewHashes.length} email hashes`);
        console.log(`   Total: ${combinedHashes.length} email hashes`);
      }

      return newBlobId;
    } catch (error) {
      console.error("❌ Error updating whitelist:", error);
      return null;
    }
  }

  async migrateFromCSV(csvPath: string): Promise<string | null> {
    console.log("\n" + "=".repeat(70));
    console.log("WAITLIST MIGRATION: CSV → WALRUS (HASHED)");
    console.log("=".repeat(70));

    const emails = await this.loadFromCSV(csvPath);
    if (emails.length === 0) {
      console.log("❌ No emails to migrate");
      return null;
    }

    console.log("\n🔐 Creating whitelist with hashed emails...");
    const whitelist = this.createWhitelist(emails);

    console.log("\n☁️  Uploading to Walrus...");
    const blobId = await this.uploadToWalrus(whitelist);

    if (!blobId) {
      console.log("❌ Failed to upload whitelist");
      return null;
    }

    console.log("\n📝 Saving migration record...");
    await this.saveMigrationRecord(blobId, emails.length, whitelist.version);

    console.log("\n" + "=".repeat(70));
    console.log("✅ MIGRATION COMPLETE!");
    console.log("=".repeat(70));
    console.log(`\nWhitelist Blob ID: ${blobId}`);
    console.log(`Total Emails: ${emails.length} (hashed)`);
    console.log("\n⚠️  IMPORTANT:");
    console.log(
      "   - Original emails are NOT stored on Walrus (only SHA-256 hashes)",
    );
    console.log(
      "   - You cannot recover the email list from the blob (irreversible)",
    );
    console.log("   - Keep your original CSV as backup for reference");
    console.log("\nNext Steps:");
    console.log("1. Save this Blob ID in your backend config");
    console.log("2. Update frontend to verify emails against Walrus");
    console.log("3. Test with a whitelisted email");
    console.log("=".repeat(70));

    return blobId;
  }

  async saveMigrationRecord(
    blobId: string,
    emailCount: number,
    version: number,
  ): Promise<void> {
    const record: MigrationRecord = {
      migration_date: new Date().toISOString(),
      whitelist_blob_id: blobId,
      email_count: emailCount,
      storage: "Walrus decentralized network (emails hashed with SHA-256)",
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

  async checkMultipleEmails(
    emails: string[],
    blobId: string,
  ): Promise<Map<string, boolean>> {
    const whitelist = await this.fetchWhitelist(blobId);
    if (!whitelist) {
      return new Map(emails.map((email) => [email, false]));
    }

    const hashSet = new Set(whitelist.email_hashes);
    const results = new Map<string, boolean>();

    for (const email of emails) {
      const normalized = email.toLowerCase().trim();
      const hash = this.hashEmail(normalized);
      results.set(email, hashSet.has(hash));
    }

    return results;
  }
}
