
import "dotenv/config";
import getSupabaseClient from "../config/supabase.js";

const supabase = getSupabaseClient();

async function testFetch(identifier: string) {
  console.log(`🔍 Searching Supabase for: "${identifier}" (Username or Email)...`);

  // 1. Fetch Profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .or(`username.ilike.${identifier},email.ilike.${identifier}`);

  if (profileError) {
    console.error("Error fetching profile:", profileError.message);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log("❌ No user found matching that username or email.");
    return;
  }

  console.log(`✅ Found ${profiles.length} matching user(s):`);

  for (const profile of profiles) {
    console.log("\n--------------------------------------------------");
    console.log(`👤 Profile: ${profile.username} (${profile.wallet_address})`);
    console.log(JSON.stringify(profile, null, 2));

    // 2. Fetch History for this specific user
    const { data: history, error: historyError } = await supabase
      .from('points_history')
      .select('*')
      .eq('user_id', profile.wallet_address)
      .order('created_at', { ascending: false });

    if (historyError) {
      console.error(`Error fetching history for ${profile.username}:`, historyError.message);
    } else {
      console.log(`\n📄 Points History (${history.length} entries):`);
      if (history.length > 0) {
        console.table(history.slice(0, 5).map(h => ({
          Amount: h.amount,
          Source: h.source,
          Reason: h.reason,
          Date: h.created_at
        })));
        if (history.length > 5) console.log("... (only showing first 5)");
      }
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Please provide a username or email to search for.");
  console.log("Example: npx tsx src/scripts/testUserFetch.ts MyUsername");
  console.log("Example: npx tsx src/scripts/testUserFetch.ts user@example.com");
} else {
  testFetch(args[0]).catch(console.error);
}
