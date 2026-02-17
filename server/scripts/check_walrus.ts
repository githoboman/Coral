import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { WalrusUserManager } from "../src/services/walrusUserManager";
import { TicketMinter } from "../src/services/ticketMinter";
import "dotenv/config";
import * as fs from "fs/promises";

interface UserComparison {
  wallet_address: string;
  blockchain_points: number;
  walrus_username?: string;
  walrus_email?: string;
  has_waitlist_claim: boolean;
  total_checkins: number;
  current_streak: number;
  tasks_completed: number;
  task_points: number;
  joined_at?: string;
  subscription_tier?: number;
  discrepancy: boolean;
  notes: string[];
}

async function main() {
  console.log("🔄 Cross-Reference: Blockchain vs Walrus Database\n");
  console.log("=".repeat(70));

  const network = process.env.SUI_NETWORK || "testnet";
  const packageId = process.env.SUI_PACKAGE_ID;
  const userRegistryBlobId = process.env.USER_REGISTRY_BLOB_ID;

  if (!packageId) {
    console.error("❌ Missing SUI_PACKAGE_ID in .env");
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  const userManager = new WalrusUserManager();
  const ticketMinter = new TicketMinter();

  console.log(`\n🌐 Network: ${network}`);
  console.log(`📦 Package: ${packageId}`);

  if (userRegistryBlobId) {
    console.log(`📝 User Registry: ${userRegistryBlobId}\n`);
  } else {
    console.log(
      `⚠️  No USER_REGISTRY_BLOB_ID found, will only show blockchain data\n`,
    );
  }

  try {
    // Step 1: Get all addresses with points from blockchain (points module)
    console.log("🔍 Step 1: Querying points::PointsClaimed events...");

    const blockchainUsers = new Map<
      string,
      {
        points: number;
        waitlist_claimed: boolean;
        checkins: number;
        streak: number;
        tasks_completed: number;
        task_points: number;
      }
    >();

    let hasNextPage = true;
    let cursor: string | null = null;
    let totalEvents = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::PointsClaimed`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        totalEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const reason = data.reason;
        const newBalance = parseInt(data.new_balance);

        if (!blockchainUsers.has(walletAddress)) {
          blockchainUsers.set(walletAddress, {
            points: newBalance,
            waitlist_claimed: false,
            checkins: 0,
            streak: 0,
            tasks_completed: 0,
            task_points: 0,
          });
        }

        const user = blockchainUsers.get(walletAddress)!;
        user.points = newBalance;

        if (reason === "Waitlist Bonus") {
          user.waitlist_claimed = true;
        }
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;
    }

    console.log(`   ✅ Processed ${totalEvents} PointsClaimed events\n`);

    // Step 2: Get check-in data
    console.log("🔍 Step 2: Querying check-in data...");

    hasNextPage = true;
    cursor = null;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::CheckInCompleted`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        const data = event.parsedJson as any;
        const walletAddress = data.wallet_address;

        if (blockchainUsers.has(walletAddress)) {
          const user = blockchainUsers.get(walletAddress)!;
          user.checkins++;
          user.streak = Math.max(user.streak, parseInt(data.current_streak));
        }
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;
    }

    console.log(`   ✅ Processed check-in data\n`);

    // Step 3: Get task points data
    console.log("🔍 Step 3: Querying task_points::TaskPointsClaimed events...");

    hasNextPage = true;
    cursor = null;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::task_points::TaskPointsClaimed`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        const data = event.parsedJson as any;
        const walletAddress = data.wallet_address;
        const taskCount = parseInt(data.task_count);
        const pointsEarned = parseInt(data.points_earned);
        const newBalance = parseInt(data.new_balance);

        if (!blockchainUsers.has(walletAddress)) {
          blockchainUsers.set(walletAddress, {
            points: newBalance,
            waitlist_claimed: false,
            checkins: 0,
            streak: 0,
            tasks_completed: 0,
            task_points: 0,
          });
        }

        const user = blockchainUsers.get(walletAddress)!;
        user.points = newBalance;
        user.tasks_completed += taskCount;
        user.task_points += pointsEarned;
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;
    }

    console.log(`   ✅ Processed task points data\n`);

    // Step 4: Cross-reference with Walrus database
    const comparisons: UserComparison[] = [];

    if (userRegistryBlobId) {
      console.log("🔍 Step 3: Loading Walrus user database...");

      const walrusRegistry =
        await userManager.fetchUsersRegistry(userRegistryBlobId);

      if (walrusRegistry) {
        console.log(
          `   ✅ Found ${walrusRegistry.total_users} users in Walrus database\n`,
        );

        console.log("🔄 Step 4: Cross-referencing data...\n");

        // Process all blockchain users
        for (const [
          walletAddress,
          blockchainData,
        ] of blockchainUsers.entries()) {
          const walrusProfile = await userManager.getUserProfile(
            userRegistryBlobId,
            walletAddress,
          );

          const notes: string[] = [];
          let discrepancy = false;

          // Check if user exists in Walrus but not on blockchain
          if (!walrusProfile) {
            notes.push("User has blockchain points but no Walrus profile");
            discrepancy = true;
          }

          // Check if waitlist claim matches
          if (
            walrusProfile &&
            walrusProfile.is_waitlisted !== blockchainData.waitlist_claimed
          ) {
            notes.push(
              `Waitlist mismatch: Walrus=${walrusProfile.is_waitlisted}, Blockchain=${blockchainData.waitlist_claimed}`,
            );
            discrepancy = true;
          }

          comparisons.push({
            wallet_address: walletAddress,
            blockchain_points: blockchainData.points,
            walrus_username: walrusProfile?.username,
            walrus_email: walrusProfile?.email,
            has_waitlist_claim: blockchainData.waitlist_claimed,
            total_checkins: blockchainData.checkins,
            current_streak: blockchainData.streak,
            tasks_completed: blockchainData.tasks_completed,
            task_points: blockchainData.task_points,
            joined_at: walrusProfile?.joined_at,
            subscription_tier: walrusProfile?.subscription_tier,
            discrepancy,
            notes,
          });
        }

        // Check for users in Walrus but not on blockchain
        for (const [walletAddress, encryptedProfile] of Object.entries(
          walrusRegistry.users,
        )) {
          if (!blockchainUsers.has(walletAddress)) {
            const decryptedProfile = await userManager.getUserProfile(
              userRegistryBlobId,
              walletAddress,
            );

            comparisons.push({
              wallet_address: walletAddress,
              blockchain_points: 0,
              walrus_username: decryptedProfile?.username,
              walrus_email: decryptedProfile?.email,
              has_waitlist_claim: false,
              total_checkins: 0,
              current_streak: 0,
              tasks_completed: 0,
              task_points: 0,
              joined_at: decryptedProfile?.joined_at,
              subscription_tier: decryptedProfile?.subscription_tier,
              discrepancy: true,
              notes: ["User in Walrus database but has no blockchain points"],
            });
          }
        }

        // Sort by points (descending)
        comparisons.sort((a, b) => b.blockchain_points - a.blockchain_points);

        // Display results
        console.log("=".repeat(70));
        console.log("📊 CROSS-REFERENCE RESULTS");
        console.log("=".repeat(70) + "\n");

        const withDiscrepancies = comparisons.filter((c) => c.discrepancy);

        console.log(`Total Users: ${comparisons.length}`);
        console.log(
          `Users with Points: ${comparisons.filter((c) => c.blockchain_points > 0).length}`,
        );
        console.log(
          `Users with Walrus Profiles: ${comparisons.filter((c) => c.walrus_email).length}`,
        );
        console.log(`Discrepancies Found: ${withDiscrepancies.length}\n`);

        if (withDiscrepancies.length > 0) {
          console.log("⚠️  Users with Discrepancies:\n");

          withDiscrepancies.forEach((user, index) => {
            console.log(`${index + 1}. ${user.wallet_address}`);
            console.log(`   Blockchain Points: ${user.blockchain_points}`);
            console.log(`   Walrus Email: ${user.walrus_email || "N/A"}`);
            console.log(`   Walrus Username: ${user.walrus_username || "N/A"}`);
            console.log(`   Issues:`);
            user.notes.forEach((note) => console.log(`   └─ ${note}`));
            console.log();
          });
        }

        // Top users
        const topUsers = comparisons
          .filter((c) => c.blockchain_points > 0)
          .slice(0, 20);

        console.log("\n📈 Top 20 Users by Points:\n");
        console.log(
          "Rank | Address                                                            | Points  | Email                          | Waitlist | Check-ins | Tasks",
        );
        console.log("-".repeat(170));

        topUsers.forEach((user, index) => {
          const rank = (index + 1).toString().padStart(4);
          const addr = user.wallet_address;
          const points = user.blockchain_points.toLocaleString().padStart(7);
          const email = (user.walrus_email || "No profile")
            .substring(0, 30)
            .padEnd(30);
          const waitlist = user.has_waitlist_claim ? "Yes" : "No ";
          const checkins = user.total_checkins.toString().padStart(9);
          const tasks = user.tasks_completed.toString().padStart(5);

          console.log(
            `${rank} | ${addr} | ${points} | ${email} | ${waitlist}      | ${checkins} | ${tasks}`,
          );
        });
      } else {
        console.log("   ❌ Could not fetch Walrus user registry\n");
      }
    } else {
      console.log(
        "⚠️  Skipping Walrus cross-reference (no USER_REGISTRY_BLOB_ID)\n",
      );

      // Just show blockchain data
      console.log("📊 Blockchain Users Only:\n");

      const blockchainArray = Array.from(blockchainUsers.entries())
        .map(([address, data]) => ({
          wallet_address: address,
          blockchain_points: data.points,
          has_waitlist_claim: data.waitlist_claimed,
          total_checkins: data.checkins,
          current_streak: data.streak,
          tasks_completed: data.tasks_completed,
          task_points: data.task_points,
        }))
        .sort((a, b) => b.blockchain_points - a.blockchain_points);

      blockchainArray.slice(0, 30).forEach((user, index) => {
        console.log(`${index + 1}. ${user.wallet_address}`);
        console.log(`   Points: ${user.blockchain_points}`);
        console.log(`   Waitlist: ${user.has_waitlist_claim ? "Yes" : "No"}`);
        console.log(
          `   Check-ins: ${user.total_checkins} (${user.current_streak} day streak)`,
        );
        console.log(
          `   Tasks: ${user.tasks_completed} (${user.task_points} points)`,
        );
        console.log();
      });

      // Use blockchainArray for comparisons
      blockchainArray.forEach((user) => {
        comparisons.push({
          wallet_address: user.wallet_address,
          blockchain_points: user.blockchain_points,
          has_waitlist_claim: user.has_waitlist_claim,
          total_checkins: user.total_checkins,
          current_streak: user.current_streak,
          tasks_completed: user.tasks_completed,
          task_points: user.task_points,
          discrepancy: false,
          notes: [],
        });
      });
    }

    // Save to JSON
    const outputData = {
      network,
      package_id: packageId,
      user_registry_blob_id: userRegistryBlobId || null,
      queried_at: new Date().toISOString(),
      total_users: comparisons.length,
      users_with_points: comparisons.filter((c) => c.blockchain_points > 0)
        .length,
      users_with_profiles: comparisons.filter((c) => c.walrus_email).length,
      discrepancies: comparisons.filter((c) => c.discrepancy).length,
      users: comparisons,
    };

    const outputPath = "./platform-cross-reference.json";
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));

    console.log("\n" + "=".repeat(70));
    console.log(`💾 Full data saved to: ${outputPath}`);
    console.log("=".repeat(70) + "\n");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

main();
