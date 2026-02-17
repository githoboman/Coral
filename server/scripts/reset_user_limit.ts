import { WalrusUserManager } from "../src/services/walrusUserManager";
import { TicketMinter } from "../src/services/ticketMinter";
import { getSubscriptionService } from "../src/services/subscriptionService";
import "dotenv/config";

async function resetUserLimits() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: tsx scripts/reset_user_limit.ts <username>");
    process.exit(1);
  }

  console.log(`\n🔄 Resetting limits for user: ${username}`);

  try {
    const ticketMinter = new TicketMinter();
    const userManager = new WalrusUserManager();
    const subscriptionService = getSubscriptionService();

    // 1. Get Registry
    const blobId = await ticketMinter.getCurrentBlobId();
    if (!blobId) {
      console.error("❌ No registry found.");
      process.exit(1);
    }

    // 2. Find User
    let walletAddress = await userManager.findWalletByUsername(blobId, username);
    
    // Fallback: Check if input is a wallet address
    if (!walletAddress && username.startsWith("0x")) {
        const exists = await userManager.userExists(blobId, username);
        if (exists) walletAddress = username;
    }

    if (!walletAddress) {
      console.error(`❌ User '${username}' not found in registry.`);
      process.exit(1);
    }

    console.log(`✅ Found wallet: ${walletAddress}`);

    // 3. Reset Limits via SubscriptionService (or manually if needed)
    
    // Connect to Redis to clear cache
    const { redisClient } = await import("../src/middleware/rateLimiter");
    if (redisClient) {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
        
        const today = new Date().toISOString().split("T")[0];
        const redisKey = `prompts:${walletAddress}:${today}`;
        
        await redisClient.del(redisKey);
        console.log(`✅ Cleared Redis cache: ${redisKey}`);
    } else {
        console.warn("⚠️ Redis client not available, skipping cache clear.");
    }

    const profile = await userManager.getUserProfile(blobId, walletAddress);
    if (!profile) {
        console.error("❌ Profile not found.");
        process.exit(1);
    }

    console.log(`Current usage: ${profile.daily_prompts_used || 0}`);

    const updatedProfile = userManager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        profile.points_awarded,
        {
            ...profile,
            daily_prompts_used: 0,
            last_prompt_date: new Date().toISOString() 
        }
    );

    const newBlobId = await userManager.addOrUpdateUser(blobId, updatedProfile);

    if (newBlobId) {
        if (newBlobId !== blobId) {
            await ticketMinter.updateBlobRegistry(newBlobId);
        }
        console.log(`\n✨ Successfully reset prompt limits for ${username}!`);
        console.log(`New usage: 0`);
    } else {
        console.error("❌ Failed to update user profile.");
    }

    if (redisClient && redisClient.isOpen) {
        await redisClient.disconnect();
    }

  } catch (error) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  }
}

resetUserLimits();
