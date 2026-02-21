
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import getSupabaseClient from "../config/supabase.js";
import { getEncryptionService } from "../services/encryptionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const supabase = getSupabaseClient();
const encryption = getEncryptionService();

// Paths to data files
const REGISTRY_PATH = path.join(__dirname, "../../data/user_registry_cache.json");
const POINTS_PATH = path.join(__dirname, "../../../complete-platform-points 2.json");
const WAITLIST_PATH = path.join(__dirname, "../../../claimed-addresses.json");

// --- SAFETY CONFIG ---
const DRY_RUN = process.env.DRY_RUN === "true" || false; 
const OVERWRITE_EXISTING = true; // Enabled per user request to update beta profiles
// ---------------------

async function runMigration() {
  console.log(`🚀 Starting Walrus to Supabase migration... ${DRY_RUN ? "[DRY RUN MODE]" : "[LIVE MODE]"}`);

  // 1. Load data files
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`Registry file not found at ${REGISTRY_PATH}`);
  }
  if (!fs.existsSync(POINTS_PATH)) {
    throw new Error(`Points file not found at ${POINTS_PATH}`);
  }

  const registryData = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  const pointsData = JSON.parse(fs.readFileSync(POINTS_PATH, "utf-8"));
  
  let waitlistAddresses = new Set<string>();
  if (fs.existsSync(WAITLIST_PATH)) {
    const waitlistData = JSON.parse(fs.readFileSync(WAITLIST_PATH, "utf-8"));
    if (Array.isArray(waitlistData)) {
        waitlistData.forEach(item => waitlistAddresses.add(item.wallet_address.toLowerCase()));
    }
  }

  const walrusUsers = registryData.registry.users;
  const summarizedUsers = pointsData.users;

  console.log(`Found ${Object.keys(walrusUsers).length} users in registry.`);
  console.log(`Found ${summarizedUsers.length} users in summarized points.`);

  let migratedCount = 0;
  let historyCount = 0;

  // 2. Process users
  for (const userSummary of summarizedUsers) {
    const wallet = userSummary.wallet_address.toLowerCase();
    const walrusProfile = walrusUsers[wallet] || walrusUsers[userSummary.wallet_address]; // try both casing

    let email = null;
    let username = null;
    let preferences = {};

    if (walrusProfile) {
      email = encryption.decryptOptional(walrusProfile.email)?.trim() || null;
      username = encryption.decryptOptional(walrusProfile.username);
      preferences = encryption.decryptPreferences(walrusProfile.preferences) || {};
    }

    const profile = {
      user_id: wallet, // Required field
      user_address: wallet,
      wallet_address: wallet,
      username: username,
      email: email,
      points: userSummary.total_points_blockchain || 0,
      xp: userSummary.total_points_blockchain || 0,
      waitlist_points: userSummary.waitlist_points || 0,
      checkin_points: userSummary.checkin_points || 0,
      task_points: userSummary.task_points || 0,
      checkin_streak: userSummary.streak_count || (walrusProfile?.current_streak || 0),
      total_checkins: walrusProfile?.total_checkins || 0,
      last_checkin: walrusProfile?.last_checkin_date ? new Date(walrusProfile.last_checkin_date).toISOString() : null,
      joined_at: walrusProfile?.joined_at ? new Date(walrusProfile.joined_at).toISOString() : new Date().toISOString(),
      is_waitlisted: waitlistAddresses.has(wallet) || !!walrusProfile?.is_waitlisted,
      preferences: preferences
    };

    // 3. Safety Check: Check if user already exists
    const { data: existingUser } = await supabase
      .from("user_profiles")
      .select("points, checkin_streak")
      .eq("wallet_address", wallet)
      .single();

    if (existingUser && !OVERWRITE_EXISTING) {
      console.log(`ℹ️ User ${wallet} already exists with ${existingUser.points} pts. Skipping...`);
    } else {
        if (DRY_RUN) {
            console.log(`[DRY RUN] Would upsert user ${wallet} with ${profile.points} pts (current: ${existingUser?.points || 0})`);
        } else {
            const { error: profileError } = await supabase
                .from("user_profiles")
                .upsert(profile, { onConflict: "wallet_address" });

            if (profileError) {
              console.error(`❌ Error migrating profile for ${wallet}:`, profileError.message);
              continue;
            }
        }
        migratedCount++;
    }

    // 4. Migrate claim history
    if (Array.isArray(userSummary.claim_history) && userSummary.claim_history.length > 0) {
      const historyItems = userSummary.claim_history.map((claim: any) => ({
        user_id: wallet,
        amount: claim.amount,
        source: claim.type === "waitlist" ? "points" : (claim.type === "streak" ? "points" : "task_points"),
        reason: claim.label || claim.type,
        details: { onchain_points: claim.onchain_points, original: claim },
        created_at: claim.ts ? new Date(claim.ts).toISOString() : new Date().toISOString()
      }));

      if (DRY_RUN) {
          console.log(`[DRY RUN] Would insert ${historyItems.length} history items for ${wallet}`);
          historyCount += historyItems.length;
      } else {
          const { error: historyError } = await supabase
            .from("points_history")
            .insert(historyItems);

          if (historyError) {
            console.warn(`⚠️ Warning: Failed to migrate history for ${wallet}:`, historyError.message);
          } else {
            historyCount += historyItems.length;
          }
      }
    }

    if (migratedCount % 50 === 0) {
      console.log(`Processed ${migratedCount} users...`);
    }
  }

  console.log(`\n✅ Migration Complete!`);
  console.log(`- Profiles migrated: ${migratedCount}`);
  console.log(`- History entries: ${historyCount}`);
}

runMigration().catch(err => {
  console.error("FATAL ERROR during migration:", err);
  process.exit(1);
});
