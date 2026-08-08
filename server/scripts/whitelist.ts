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
  console.log("WAITLIST MANAGEMENT TOOL (WITH EMAIL HASHING)");
  console.log("=".repeat(70));
  console.log("\nManage your Walrus-based waitlist");
  console.log("⚠️  Emails are hashed with SHA-256 (irreversible)");

  const rl = createInterface();

  try {
    console.log("\n" + "-".repeat(70));
    console.log("CHOOSE OPERATION");
    console.log("-".repeat(70));
    console.log("\n1. Migrate from CSV file (first time)");
    console.log("2. Add new emails to existing whitelist");
    console.log("3. Check if email is whitelisted");
    console.log("4. View whitelist info");
    console.log("5. Batch check multiple emails");

    const choice = await question(rl, "\nEnter choice (1-5): ");

    const manager = new WaitlistManager();

    switch (choice.trim()) {
      case "1": {
        // Migrate from CSV
        console.log("\n" + "-".repeat(70));
        console.log("MIGRATE FROM CSV");
        console.log("-".repeat(70));
        console.log("\n⚠️  IMPORTANT:");
        console.log("   - Emails will be hashed with SHA-256 before uploading");
        console.log("   - Original emails will NOT be stored on Walrus");
        console.log("   - This process is IRREVERSIBLE");
        console.log("   - Keep your CSV file as backup\n");

        const confirm = await question(
          rl,
          "Do you understand and want to continue? (yes/no): ",
        );
        if (confirm.toLowerCase() !== "yes") {
          console.log("❌ Migration cancelled");
          break;
        }

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
        console.log("\n" + "-".repeat(70));
        console.log("ADD NEW EMAILS");
        console.log("-".repeat(70));

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
          console.log(
            `\n📝 Adding ${newEmails.length} emails (will be hashed)...`,
          );
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
        console.log("\n" + "-".repeat(70));
        console.log("CHECK EMAIL");
        console.log("-".repeat(70));

        const blobId = await question(rl, "\nWhitelist blob ID: ");
        const email = await question(rl, "Email to check: ");

        const isWhitelisted = await manager.isEmailWhitelisted(
          email.trim(),
          blobId.trim(),
        );

        console.log("\n" + "-".repeat(70));
        if (isWhitelisted) {
          console.log("✅ EMAIL IS WHITELISTED");
        } else {
          console.log("❌ EMAIL IS NOT WHITELISTED");
        }
        console.log("-".repeat(70));
        break;
      }

      case "4": {
        // View info
        console.log("\n" + "-".repeat(70));
        console.log("WHITELIST INFO");
        console.log("-".repeat(70));

        const blobId = await question(rl, "\nWhitelist blob ID: ");
        const whitelist = await manager.fetchWhitelist(blobId.trim());

        if (whitelist) {
          console.log("\n📋 Whitelist Information:");
          console.log(`   Version: ${whitelist.version}`);
          console.log(`   Total Email Hashes: ${whitelist.total_count}`);
          console.log(`   Created: ${whitelist.created_at}`);
          console.log(`   Description: ${whitelist.description}`);
          if (whitelist.previous_blob) {
            console.log(`   Previous Version: ${whitelist.previous_blob}`);
          }
          console.log(
            "\n⚠️  Note: Original emails are not stored (only SHA-256 hashes)",
          );
        }
        break;
      }

      case "5": {
        // Batch check
        console.log("\n" + "-".repeat(70));
        console.log("BATCH CHECK EMAILS");
        console.log("-".repeat(70));

        const blobId = await question(rl, "\nWhitelist blob ID: ");

        console.log(
          "\nEnter emails to check (one per line, empty line to finish):",
        );
        const emails: string[] = [];
        while (true) {
          const email = await question(rl, "");
          if (!email.trim()) break;
          emails.push(email.trim());
        }

        if (emails.length > 0) {
          console.log(`\n🔍 Checking ${emails.length} emails...`);
          const results = await manager.checkMultipleEmails(
            emails,
            blobId.trim(),
          );

          console.log("\n" + "-".repeat(70));
          console.log("RESULTS");
          console.log("-".repeat(70));

          let whitelistedCount = 0;
          for (const [email, isWhitelisted] of results.entries()) {
            const status = isWhitelisted
              ? "✅ WHITELISTED"
              : "❌ NOT WHITELISTED";
            console.log(`${email}: ${status}`);
            if (isWhitelisted) whitelistedCount++;
          }

          console.log("-".repeat(70));
          console.log(
            `Summary: ${whitelistedCount}/${emails.length} whitelisted`,
          );
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

export { main };
