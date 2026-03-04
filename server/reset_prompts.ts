import "dotenv/config";
import { getUserManager } from "./src/services/userManager";
import getSupabaseClient from "./src/config/supabase";
import { redisClient } from "./src/middleware/rateLimiter";

async function run() {
  const identifier = process.argv[2];

  if (!identifier) {
    console.error("Usage: npx tsx reset_prompts.ts <wallet_address_or_username>");
    process.exit(1);
  }

  const userManager = getUserManager();
  const supabase = getSupabaseClient();

  let walletAddress = identifier;

  // Check if it's a wallet address (starts with 0x)
  if (!identifier.toLowerCase().startsWith("0x")) {
    console.log(`Searching for wallet associated with username: ${identifier}...`);
    const foundWallet = await userManager.findWalletByUsername(identifier);
    if (!foundWallet) {
      console.error(`Could not find a user with username: ${identifier}`);
      process.exit(1);
    }
    walletAddress = foundWallet;
    console.log(`Found wallet: ${walletAddress}`);
  }

  walletAddress = walletAddress.toLowerCase();
  console.log(`Resetting prompts for ${walletAddress}...`);

  try {
    // 1. Reset in Supabase
    const { error: supabaseError } = await supabase
      .from('user_profiles')
      .update({
        daily_prompts_used: 0,
        daily_research_prompts_used: 0,
        last_prompt_date: null,
        last_research_prompt_date: null
      })
      .eq('wallet_address', walletAddress);

    if (supabaseError) {
      throw new Error(`Supabase reset failed: ${supabaseError.message}`);
    }
    console.log("✓ Supabase prompt counters reset to 0.");

    // 2. Clear Redis labels if connected
    if (redisClient && redisClient.isOpen) {
      const today = new Date().toISOString().split("T")[0];
      const taskKey = `task:prompts:${walletAddress}:${today}`;
      const researchKey = `research:prompts:${walletAddress}:${today}`;
      
      await redisClient.del(taskKey);
      await redisClient.del(researchKey);
      console.log("✓ Redis prompt cache cleared.");
    } else {
      console.log("! Redis client not connected, skipping Redis cache clear.");
    }

    console.log("Successfully reset all prompt limits for user.");
  } catch (error: any) {
    console.error("Error during reset:", error.message);
    process.exit(1);
  } finally {
    if (redisClient && redisClient.isOpen) {
       await redisClient.quit();
    }
  }
}

run();
