import "dotenv/config";
import getSupabaseClient from "../config/supabase.js";
import { redisClient } from "../middleware/rateLimiter.js";

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

  const walletAddress = user.wallet_address;
  console.log(`✅ Found user: ${user.username || 'N/A'} (${walletAddress})`);
  console.log(`♻️ Resetting prompts and tasks in Supabase...`);

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
    .eq('wallet_address', walletAddress);

  if (updateError) {
    console.error("❌ Error resetting Supabase prompts:", updateError.message);
  } else {
    console.log("✅ Successfully reset all daily prompt and activity counters in Supabase.");
    
    // Also clear Redis if available
    if (redisClient) {
      console.log(`♻️ Clearing Redis cache...`);
      try {
        const today = new Date().toISOString().split("T")[0];
        const taskKey = `task:prompts:${walletAddress}:${today}`;
        const researchKey = `research:prompts:${walletAddress}:${today}`;
        
        // Connect if needed (though usually script handles this)
        if (!redisClient.isOpen) await redisClient.connect();
        
        await redisClient.del(taskKey);
        await redisClient.del(researchKey);
        // Also clear general rate limit
        await redisClient.del(`ratelimit:${walletAddress}`);
        
        console.log("✅ Successfully cleared Redis keys.");
      } catch (redisErr: any) {
        console.error("⚠️ Failed to clear Redis keys:", redisErr.message);
      } finally {
        if (redisClient.isOpen) await redisClient.disconnect();
      }
    }
  }
}

resetPrompts().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
