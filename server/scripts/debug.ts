// test-account-lookup.ts
// Run: npx tsx scripts/test-account-lookup.ts

import { TicketMinter } from "../src/services/ticketMinter";
import { WalrusUserManager } from "../src/services/walrusUserManager";

async function testAccountLookup() {
  console.log("\n🧪 Testing Account Lookup\n");
  console.log("=".repeat(60));

  const wallet =
    "0xd854a95802b834b5ea45d4ac5506751c67f4c61c4b11e00d0faa2d74b805bf19";

  try {
    // Initialize services
    const minter = new TicketMinter();
    const um = new WalrusUserManager();

    // Step 1: Get blob ID from chain
    console.log("\n📖 Step 1: Reading BlobRegistry from chain...");
    const blobId = await minter.getCurrentBlobId();
    console.log(`   Result: ${blobId || "(null)"}`);

    if (!blobId) {
      console.log("\n❌ FAILED: No blob ID found in BlobRegistry");
      console.log(
        "   This means the BlobRegistry is empty or getCurrentBlobId() is broken",
      );
      return;
    }

    console.log("   ✅ Blob ID retrieved successfully");

    // Step 2: Fetch the registry from Walrus
    console.log("\n📥 Step 2: Fetching users registry from Walrus...");
    console.log(
      `   URL: https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`,
    );

    const registry = await um.fetchUsersRegistry(blobId);

    if (!registry) {
      console.log("\n❌ FAILED: Could not fetch registry from Walrus");
      console.log("   This means either:");
      console.log("   1. The blob ID is invalid");
      console.log("   2. Walrus aggregator is down");
      console.log("   3. Network connectivity issue");
      return;
    }

    console.log("   ✅ Registry fetched successfully");
    console.log(`   Total users: ${registry.total_users}`);
    console.log(`   Version: ${registry.version}`);

    // Step 3: Look up the specific user
    console.log("\n🔍 Step 3: Looking up user by wallet address...");
    console.log(`   Wallet: ${wallet}`);

    const userInRegistry = registry.users[wallet];

    if (!userInRegistry) {
      console.log("\n❌ FAILED: User not found in registry");
      console.log("   Available wallet addresses in registry:");
      Object.keys(registry.users).forEach((addr) => {
        console.log(`   - ${addr}`);
      });
      return;
    }

    console.log("   ✅ User found in registry!");
    console.log("   User data:");
    console.log(JSON.stringify(userInRegistry, null, 4));

    // Step 4: Test getUserProfile method
    console.log("\n🧩 Step 4: Testing getUserProfile method...");
    const profile = await um.getUserProfile(blobId, wallet);

    if (!profile) {
      console.log("\n❌ FAILED: getUserProfile returned null");
      console.log("   But we know the user exists in the registry!");
      console.log("   This suggests a bug in getUserProfile()");
      return;
    }

    console.log("   ✅ getUserProfile works!");
    console.log("   Profile:");
    console.log(JSON.stringify(profile, null, 4));

    // Step 5: Check on-chain points
    console.log("\n💎 Step 5: Checking on-chain points...");
    const balance = await minter.getBalance(wallet);
    const claimed = await minter.hasClaimed(wallet);

    console.log(`   Points balance: ${balance}`);
    console.log(`   Waitlist claimed: ${claimed}`);

    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("✅ ALL TESTS PASSED!");
    console.log("\nAccount endpoint SHOULD work with this data:");
    console.log({
      user_id: wallet,
      wallet_address: wallet,
      email: profile.email,
      username: profile.username || null,
      points: balance,
      rank: null,
    });
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ ERROR:", error);
  }
}

testAccountLookup();
