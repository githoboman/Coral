import axios from "axios";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import "dotenv/config";
import * as fs from "fs/promises";

// ============================================================================
// Types (mirrored from walrusUserManager)
// ============================================================================

interface EncryptedData {
  iv: string;
  data: string;
  tag?: string;
}

interface UserProfile {
  email: EncryptedData | string;
  wallet_address: string;
  is_waitlisted: boolean;
  points_awarded: number;
  joined_at: string;
  username?: EncryptedData | string;
  first_name?: EncryptedData | string;
  last_name?: EncryptedData | string;
  preferences?: EncryptedData | Record<string, any>;
  waitlist_verified_at?: string;
  chat_registry_blob_id?: string;
  task_registry_blob_id?: string;
  tasks_created_today?: number;
  tasks_claimed_today?: number;
  last_task_reset_date?: string;
  current_streak?: number;
  last_checkin_date?: string;
  total_checkins?: number;
  subscription_tier?: number;
  subscription_expires_at?: string;
  daily_prompts_used?: number;
  last_prompt_date?: string;
}

interface UsersRegistry {
  version: number;
  updated_at: string;
  total_users: number;
  users: Record<string, UserProfile>;
  description: string;
  previous_blob?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function isEncryptedData(val: any): val is EncryptedData {
  return val && typeof val === "object" && "iv" in val && "data" in val;
}

function displayField(val: EncryptedData | string | undefined): string {
  if (val === undefined || val === null) return "N/A";
  if (isEncryptedData(val)) return "[encrypted]";
  return val as string;
}

function displayPreferences(
  val: EncryptedData | Record<string, any> | undefined,
): string {
  if (val === undefined || val === null) return "N/A";
  if (isEncryptedData(val)) return "[encrypted]";
  return JSON.stringify(val);
}

async function fetchRegistry(
  aggregatorUrl: string,
  blobId: string,
  maxRetries = 3,
): Promise<UsersRegistry | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `   Fetching blob (attempt ${attempt}/${maxRetries}): ${blobId}`,
      );
      const response = await axios.get(`${aggregatorUrl}/v1/blobs/${blobId}`, {
        timeout: 30000,
        headers: { Accept: "application/json" },
      });
      return response.data as UsersRegistry;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.error("   ❌ Blob not found (404)");
        return null;
      }
      console.warn(`   ⚠️  Attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  return null;
}

async function getCurrentBlobId(
  client: SuiClient,
  blobRegistryId: string,
): Promise<string | null> {
  const object = await client.getObject({
    id: blobRegistryId,
    options: { showContent: true },
  });

  if (object.data?.content?.dataType !== "moveObject") {
    console.error("❌ BlobRegistry object not found or wrong type");
    return null;
  }

  const fields = (object.data.content as any).fields;
  let currentBlobId = fields?.current_blob_id;

  if (!currentBlobId) {
    console.log("⚠️  BlobRegistry is empty");
    return null;
  }

  if (typeof currentBlobId === "string") {
    currentBlobId = currentBlobId.trim();
  } else if (typeof currentBlobId === "object" && currentBlobId !== null) {
    const value = (currentBlobId as any).value || (currentBlobId as any).bytes;
    if (typeof value === "string") {
      currentBlobId = value.trim();
    } else if (Array.isArray(value)) {
      currentBlobId = new TextDecoder().decode(new Uint8Array(value)).trim();
    }
  }

  currentBlobId = (currentBlobId as string).replace(/[^\x20-\x7E]/g, "").trim();

  if (!currentBlobId) {
    console.log("⚠️  BlobRegistry contains empty string");
    return null;
  }

  return currentBlobId;
}

// ============================================================================
// Display helpers
// ============================================================================

function printUserDetailed(
  wallet: string,
  profile: UserProfile,
  index: number,
) {
  const joinedAt = profile.joined_at
    ? new Date(profile.joined_at).toLocaleString()
    : "N/A";
  const waitlistVerified = profile.waitlist_verified_at
    ? new Date(profile.waitlist_verified_at).toLocaleString()
    : "N/A";
  const subExpires = profile.subscription_expires_at
    ? new Date(profile.subscription_expires_at).toLocaleString()
    : "N/A";

  console.log(`${index + 1}. ${wallet}`);
  console.log(`   ── Identity ──`);
  console.log(`   Email:              ${displayField(profile.email)}`);
  console.log(`   Username:           ${displayField(profile.username)}`);
  console.log(`   First Name:         ${displayField(profile.first_name)}`);
  console.log(`   Last Name:          ${displayField(profile.last_name)}`);
  console.log(
    `   Preferences:        ${displayPreferences(profile.preferences)}`,
  );
  console.log();
  console.log(`   ── Status ──`);
  console.log(
    `   Waitlisted:         ${profile.is_waitlisted ? "✅ Yes" : "❌ No"}`,
  );
  console.log(`   Waitlist Verified:  ${waitlistVerified}`);
  console.log(`   Points Awarded:     ${profile.points_awarded}`);
  console.log(`   Joined At:          ${joinedAt}`);
  console.log();
  console.log(`   ── Check-in Streak ──`);
  console.log(`   Current Streak:     ${profile.current_streak ?? 0} days`);
  console.log(`   Total Check-ins:    ${profile.total_checkins ?? 0}`);
  console.log(`   Last Check-in:      ${profile.last_checkin_date ?? "N/A"}`);
  console.log();
  console.log(`   ── Tasks ──`);
  console.log(`   Tasks Created Today: ${profile.tasks_created_today ?? 0}`);
  console.log(`   Tasks Claimed Today: ${profile.tasks_claimed_today ?? 0}`);
  console.log(
    `   Last Task Reset:     ${profile.last_task_reset_date ?? "N/A"}`,
  );
  console.log();
  console.log(`   ── Subscription ──`);
  console.log(`   Tier:               ${profile.subscription_tier ?? 0}`);
  console.log(`   Expires:            ${subExpires}`);
  console.log(`   Daily Prompts Used: ${profile.daily_prompts_used ?? 0}`);
  console.log(`   Last Prompt Date:   ${profile.last_prompt_date ?? "N/A"}`);
  console.log();
  console.log(`   ── Blobs ──`);
  console.log(
    `   Chat Registry:      ${profile.chat_registry_blob_id ?? "N/A"}`,
  );
  console.log(
    `   Task Registry:      ${profile.task_registry_blob_id ?? "N/A"}`,
  );
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("👤 User Profile Overview\n");
  console.log("=".repeat(80));

  const network = process.env.SUI_NETWORK || "testnet";
  const blobRegistryId = process.env.SUI_BLOB_REGISTRY_ID;
  const aggregatorUrl =
    process.env.WALRUS_AGGREGATOR_URL ||
    "https://aggregator.walrus-testnet.walrus.space";

  // Allow passing a blob ID directly via CLI: npx tsx check-user-profiles.ts [mode] [blobId]
  const mode = process.argv[2] || "summary";
  const overrideBlobId = process.argv[3] || null;

  console.log(`\n🌐 Network:    ${network}`);
  console.log(`🗄️  Aggregator: ${aggregatorUrl}`);

  // ── Resolve blob ID ──────────────────────────────────────────────────────
  let blobId: string | null = overrideBlobId;

  if (!blobId) {
    if (!blobRegistryId) {
      console.error(
        "\n❌ Missing SUI_BLOB_REGISTRY_ID in .env (or pass blob ID as 3rd arg)",
      );
      process.exit(1);
    }

    const client = new SuiClient({
      url: getFullnodeUrl(network as "testnet" | "mainnet"),
    });

    console.log(
      `\n📖 Reading current blob ID from BlobRegistry: ${blobRegistryId}`,
    );
    blobId = await getCurrentBlobId(client, blobRegistryId);
  }

  if (!blobId) {
    console.error("❌ Could not resolve a blob ID. Registry may be empty.");
    process.exit(1);
  }

  console.log(`\n📦 Blob ID: ${blobId}\n`);

  // ── Fetch registry ───────────────────────────────────────────────────────
  const registry = await fetchRegistry(aggregatorUrl, blobId);

  if (!registry) {
    console.error("❌ Failed to fetch user registry from Walrus");
    process.exit(1);
  }

  const users = Object.entries(registry.users);

  console.log("=".repeat(80));
  console.log(
    `📋 Registry v${registry.version} — last updated: ${registry.updated_at}`,
  );
  console.log(
    `👥 Total Users: ${registry.total_users} (actual entries: ${users.length})`,
  );
  if (registry.previous_blob) {
    console.log(`🔗 Previous Blob: ${registry.previous_blob}`);
  }
  console.log("=".repeat(80) + "\n");

  // ── Compute summary stats ────────────────────────────────────────────────
  let waitlistedCount = 0;
  let totalPointsAwarded = 0;
  let encryptedEmailCount = 0;
  let streakGt7 = 0;
  let subTierCounts: Record<number, number> = {};
  let totalCheckins = 0;
  let totalTasksCreatedToday = 0;

  for (const [, profile] of users) {
    if (profile.is_waitlisted) waitlistedCount++;
    totalPointsAwarded += profile.points_awarded || 0;
    if (isEncryptedData(profile.email)) encryptedEmailCount++;
    if ((profile.current_streak ?? 0) >= 7) streakGt7++;
    totalCheckins += profile.total_checkins ?? 0;
    totalTasksCreatedToday += profile.tasks_created_today ?? 0;
    const tier = profile.subscription_tier ?? 0;
    subTierCounts[tier] = (subTierCounts[tier] || 0) + 1;
  }

  console.log("📊 Platform Stats:");
  console.log(
    `   Waitlisted Users:       ${waitlistedCount} / ${users.length}`,
  );
  console.log(
    `   Total Points Awarded:   ${totalPointsAwarded.toLocaleString()}`,
  );
  console.log(
    `   Encrypted Emails:       ${encryptedEmailCount} / ${users.length}`,
  );
  console.log(`   Users w/ 7d+ Streak:    ${streakGt7}`);
  console.log(`   Total Check-ins:        ${totalCheckins.toLocaleString()}`);
  console.log(`   Tasks Created Today:    ${totalTasksCreatedToday}`);
  console.log(`   Subscription Tiers:`);
  for (const [tier, count] of Object.entries(subTierCounts).sort()) {
    console.log(`     Tier ${tier}: ${count} users`);
  }
  console.log();

  // ── Display modes ────────────────────────────────────────────────────────

  // Sort users: waitlisted first, then by points_awarded desc
  const sortedUsers = users.sort(([, a], [, b]) => {
    if (b.is_waitlisted !== a.is_waitlisted) {
      return b.is_waitlisted ? 1 : -1;
    }
    return (b.points_awarded || 0) - (a.points_awarded || 0);
  });

  if (mode === "detailed" || mode === "--detailed") {
    console.log("📋 Detailed User Profiles:\n");
    sortedUsers.forEach(([wallet, profile], index) => {
      printUserDetailed(wallet, profile, index);
    });
  } else if (mode === "wallet" || mode === "--wallet") {
    // Check a specific wallet: npx tsx check-user-profiles.ts wallet <blobId> <walletAddress>
    const targetWallet = process.argv[4];
    if (!targetWallet) {
      console.error(
        "❌ Usage: npx tsx check-user-profiles.ts wallet [blobId] <walletAddress>",
      );
      process.exit(1);
    }

    const profile = registry.users[targetWallet];
    if (!profile) {
      console.log(`❌ Wallet not found in registry: ${targetWallet}`);
    } else {
      console.log(`📋 Profile for: ${targetWallet}\n`);
      printUserDetailed(targetWallet, profile, 0);
    }
  } else {
    // Summary table (default)
    console.log("📋 User Summary:\n");
    console.log(
      "Rank | Wallet                                                             | Points | Waitlist | Streak | Checkins | Sub Tier | Joined",
    );
    console.log("-".repeat(170));

    sortedUsers.forEach(([wallet, profile], index) => {
      const rank = (index + 1).toString().padStart(4);
      const addr =
        wallet.length > 66 ? wallet.slice(0, 63) + "..." : wallet.padEnd(66);
      const points = (profile.points_awarded || 0).toString().padStart(6);
      const waitlist = profile.is_waitlisted ? "   ✅   " : "   ❌   ";
      const streak = `${profile.current_streak ?? 0}d`.padStart(6);
      const checkins = (profile.total_checkins ?? 0).toString().padStart(8);
      const tier = (profile.subscription_tier ?? 0).toString().padStart(8);
      const joined = profile.joined_at
        ? new Date(profile.joined_at).toISOString().slice(0, 10)
        : "N/A       ";

      console.log(
        `${rank} | ${addr} | ${points} | ${waitlist} | ${streak} | ${checkins} | ${tier} | ${joined}`,
      );
    });

    if (users.length > 50) {
      console.log(`\n... showing all ${users.length} users\n`);
    }
  }

  // ── Save to JSON ─────────────────────────────────────────────────────────
  const outputData = {
    queried_at: new Date().toISOString(),
    blob_id: blobId,
    registry_version: registry.version,
    registry_updated_at: registry.updated_at,
    previous_blob: registry.previous_blob ?? null,
    total_users: registry.total_users,
    actual_entries: users.length,
    statistics: {
      waitlisted_users: waitlistedCount,
      total_points_awarded: totalPointsAwarded,
      encrypted_email_count: encryptedEmailCount,
      users_with_7d_plus_streak: streakGt7,
      total_checkins: totalCheckins,
      tasks_created_today: totalTasksCreatedToday,
      subscription_tier_breakdown: subTierCounts,
    },
    users: sortedUsers.map(([wallet, profile]) => ({
      wallet_address: wallet,
      is_waitlisted: profile.is_waitlisted,
      points_awarded: profile.points_awarded,
      joined_at: profile.joined_at,
      waitlist_verified_at: profile.waitlist_verified_at ?? null,
      // Sensitive fields shown as encrypted/redacted markers
      email: isEncryptedData(profile.email) ? "[encrypted]" : profile.email,
      username: isEncryptedData(profile.username)
        ? "[encrypted]"
        : (profile.username ?? null),
      first_name: isEncryptedData(profile.first_name)
        ? "[encrypted]"
        : (profile.first_name ?? null),
      last_name: isEncryptedData(profile.last_name)
        ? "[encrypted]"
        : (profile.last_name ?? null),
      // Check-in
      current_streak: profile.current_streak ?? 0,
      total_checkins: profile.total_checkins ?? 0,
      last_checkin_date: profile.last_checkin_date ?? null,
      // Tasks
      tasks_created_today: profile.tasks_created_today ?? 0,
      tasks_claimed_today: profile.tasks_claimed_today ?? 0,
      last_task_reset_date: profile.last_task_reset_date ?? null,
      // Subscription
      subscription_tier: profile.subscription_tier ?? 0,
      subscription_expires_at: profile.subscription_expires_at ?? null,
      daily_prompts_used: profile.daily_prompts_used ?? 0,
      last_prompt_date: profile.last_prompt_date ?? null,
      // Blobs
      chat_registry_blob_id: profile.chat_registry_blob_id ?? null,
      task_registry_blob_id: profile.task_registry_blob_id ?? null,
    })),
  };

  const outputPath = "./user-profiles-overview.json";
  await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log(`💾 Full data saved to: ${outputPath}`);
  console.log("\nUsage modes:");
  console.log(
    "  npx tsx check-user-profiles.ts                          # Summary table (auto-reads blob from chain)",
  );
  console.log(
    "  npx tsx check-user-profiles.ts detailed                 # Full profile for every user",
  );
  console.log(
    "  npx tsx check-user-profiles.ts summary <blobId>         # Summary with specific blob",
  );
  console.log(
    "  npx tsx check-user-profiles.ts detailed <blobId>        # Detailed with specific blob",
  );
  console.log(
    "  npx tsx check-user-profiles.ts wallet <blobId> <wallet> # Single wallet lookup",
  );
  console.log("=".repeat(80) + "\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message || error);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
