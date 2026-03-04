import "dotenv/config";
import getSupabaseClient from "../config/supabase.js";

const supabase = getSupabaseClient();

async function resetPrompts() {
  const identifier = process.argv[2];

  if (!identifier) {
    console.log("❌ Please provide a username or wallet address.");
    console.log("Usage: npx tsx src/scripts/resetPrompts.ts <username|wallet>");
    return;
  }

  console.log(`🔍 Looking for user: ${identifier}...`);

  // Try wallet_address first, then username
  let { data: user, error: fetchError } = await supabase
    .from('user_profiles')
    .select('wallet_address, username')
    .or(`wallet_address.eq.${identifier},username.eq.${identifier}`)
    .maybeSingle();

  if (fetchError) {
    console.error("❌ Error fetching user:", fetchError.message);
    return;
  }

  if (!user) {
    console.log("❌ No user found with that identifier.");
    return;
  }

  console.log(`✅ Found user: ${user.username || 'N/A'} (${user.wallet_address})`);
  console.log(`♻️ Resetting prompts and tasks...`);

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      daily_prompts_used: 0,
      last_prompt_date: null,
      daily_research_prompts_used: 0,
      last_research_prompt_date: null,
      tasks_created_today: 0,
      tasks_claimed_today: 0,
      research_created_today: 0,
      research_claimed_today: 0,
      last_task_reset_date: null
    })
    .eq('wallet_address', user.wallet_address);

  if (updateError) {
    console.error("❌ Error resetting prompts:", updateError.message);
  } else {
    console.log("✅ Successfully reset all daily prompt and activity counters.");
  }
}

resetPrompts().catch(console.error);
