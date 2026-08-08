import getSupabaseClient from "../config/supabase";
import dotenv from "dotenv";
dotenv.config();

const supabase = getSupabaseClient();

async function resetAllStreaks() {
  console.log("⚠️ [CRITICAL] FULL system-wide streak reset initiated...");
  
  // 1. Delete ALL rows from checkins table
  const { count: deletedRows, error: checkinError } = await supabase
    .from("checkins")
    .delete({ count: 'exact' })
    .neq("user_id", "force_delete_all"); // Standard trick to delete all rows

  if (checkinError) {
    console.error("Failed to clear checkins:", checkinError);
    return;
  }
  console.log(`✅ [1/2] Cleared checkins history table (${deletedRows || 0} rows).`);

  // 2. Clear streak fields for ALL profiles
  const { count: updatedProfiles, error: profileError } = await supabase
    .from("user_profiles")
    .update({
      checkin_streak: 0,
      last_checkin: null,
      total_checkins: 0,
    })
    .neq("wallet_address", "force_update_all"); // Standard trick to update all rows

  if (profileError) {
    console.error("Failed to clear profiles:", profileError);
    return;
  }
  console.log(`✅ [2/2] Reset streak fields for all user profiles.`);

  console.log("\n✨ System-wide streak reset COMPLETE. All users are now on Day 0.");
}

// Ensure the user really wants to do this if they run it accidentally
if (process.argv.includes("--confirm")) {
  resetAllStreaks().catch(console.error);
} else {
  console.log("🛑 Error: This is a destructive operation. Run with '--confirm' if you are sure.");
  console.log("Usage: npx tsx src/scripts/resetAllStreaks.ts --confirm");
}
