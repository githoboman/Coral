// ============================================================================
// FILE 3: src/scripts/manageWaitlist.ts (FIXED)
// ============================================================================

import * as readline from "readline";
import { WaitlistManager } from "../src/services/waitlistManager";

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("=".repeat(70));
  console.log("WAITLIST MANAGEMENT TOOL");
  console.log("=".repeat(70));
  console.log("\nManage your Walrus-based waitlist");

  const rl = createInterface();

  try {
    console.log("\n" + "-".repeat(70));
    console.log("CHOOSE OPERATION");
    console.log("-".repeat(70));
    console.log("\n1. Migrate from CSV file (first time)");
    console.log("2. Add new emails to existing whitelist");
    console.log("3. Check if email is whitelisted");
    console.log("4. View whitelist info");

    const choice = await question(rl, "\nEnter choice (1-4): ");

    const privateKey = process.env.WALRUS_PRIVATE_KEY;
    const manager = new WaitlistManager();

    switch (choice.trim()) {
      case "1": {
        // Migrate from CSV
        const csvPath = await question(rl, "\nPath to CSV file: ");
        const blobId = await manager.migrateFromCSV(csvPath.trim());

        if (blobId) {
          console.log(`\n✅ Save this in your .env file:`);
          console.log(`WHITELIST_BLOB_ID=${blobId}`);
        }
        break;
      }

      case "2": {
        // Add new emails
        const currentBlob = await question(rl, "\nCurrent whitelist blob ID: ");

        console.log(
          "\nEnter emails to add (one per line, empty line to finish):",
        );
        const newEmails: string[] = [];
        while (true) {
          const email = await question(rl, "");
          if (!email.trim()) break;
          newEmails.push(email.trim());
        }

        if (newEmails.length > 0) {
          const newBlobId = await manager.addEmailsToWhitelist(
            newEmails,
            currentBlob.trim(),
          );
          if (newBlobId) {
            console.log(`\n✅ Update your .env file:`);
            console.log(`WHITELIST_BLOB_ID=${newBlobId}`);
          }
        }
        break;
      }

      case "3": {
        // Check email
        const blobId = await question(rl, "\nWhitelist blob ID: ");
        const email = await question(rl, "Email to check: ");

        await manager.isEmailWhitelisted(email.trim(), blobId.trim());
        break;
      }

      case "4": {
        // View info
        const blobId = await question(rl, "\nWhitelist blob ID: ");
        const whitelist = await manager.fetchWhitelist(blobId.trim());

        if (whitelist) {
          console.log("\n📋 Whitelist Information:");
          console.log(`   Version: ${whitelist.version}`);
          console.log(`   Total Emails: ${whitelist.total_count}`);
          console.log(`   Created: ${whitelist.created_at}`);
          console.log(`   Description: ${whitelist.description}`);
          if (whitelist.previous_blob) {
            console.log(`   Previous Version: ${whitelist.previous_blob}`);
          }
        }
        break;
      }

      default:
        console.log("\n❌ Invalid choice");
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
  } finally {
    rl.close();
  }
}

// Run if executed directly
main().catch(console.error);
