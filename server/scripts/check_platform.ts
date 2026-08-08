import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import "dotenv/config";
import * as fs from "fs/promises";

interface PointsClaimedEvent {
  wallet_address: string;
  amount: string;
  reason: string;
  new_balance: string;
  timestamp: string;
}

interface CheckInEvent {
  wallet_address: string;
  points_earned: string;
  new_balance: string;
  timestamp: string;
  checkin_date: string;
  current_streak: string;
  is_milestone: boolean;
  milestone_bonus: string;
}

interface TaskPointsClaimedEvent {
  wallet_address: string;
  task_count: string;
  points_earned: string;
  new_balance: string;
  timestamp: string;
}

interface UserPointsSummary {
  wallet_address: string;

  total_points_blockchain: number;

  waitlist_points: number;
  checkin_points: number;
  checkin_base_points: number;
  checkin_milestone_bonus: number;
  task_points: number;
  other_points: number;

  total_checkins: number;
  current_streak: number;
  last_checkin_date: string;

  total_tasks_completed: number;
  total_task_points: number;

  first_claim_date: string;
  last_activity_date: string;

  claim_history: Array<{
    source: string;
    reason: string;
    amount: number;
    timestamp: string;
    date: string;
    details?: any;
  }>;
}

async function main() {
  console.log("📊 Complete Platform Points Overview (All Contracts)\n");
  console.log("=".repeat(80));

  const network = process.env.SUI_NETWORK || "testnet";
  const packageId = process.env.SUI_PACKAGE_ID;

  if (!packageId) {
    console.error("❌ Missing SUI_PACKAGE_ID in .env");
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  console.log(`\n🌐 Network: ${network}`);
  console.log(`📦 Package: ${packageId}\n`);

  try {
    const userPoints = new Map<string, UserPointsSummary>();

    console.log("🔍 Step 1: Querying points::PointsClaimed events...");

    let hasNextPage = true;
    let cursor: string | null = null;
    let totalPointsEvents = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::PointsClaimed`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        totalPointsEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const amount = parseInt(data.amount);
        const reason = data.reason;
        const timestamp = parseInt(data.timestamp);

        if (!userPoints.has(walletAddress)) {
          userPoints.set(walletAddress, {
            wallet_address: walletAddress,
            total_points_blockchain: 0,
            waitlist_points: 0,
            checkin_points: 0,
            checkin_base_points: 0,
            checkin_milestone_bonus: 0,
            task_points: 0,
            other_points: 0,
            total_checkins: 0,
            current_streak: 0,
            last_checkin_date: "",
            total_tasks_completed: 0,
            total_task_points: 0,
            first_claim_date: new Date(timestamp).toISOString(),
            last_activity_date: new Date(timestamp).toISOString(),
            claim_history: [],
          });
        }

        const user = userPoints.get(walletAddress)!;

        if (reason === "Waitlist Bonus") {
          user.waitlist_points += amount;
        } else if (reason === "Daily Check-in") {
          user.checkin_points += amount;
        } else {
          user.other_points += amount;
        }

        const eventDate = new Date(timestamp).toISOString();
        if (eventDate < user.first_claim_date) {
          user.first_claim_date = eventDate;
        }
        if (eventDate > user.last_activity_date) {
          user.last_activity_date = eventDate;
        }

        user.claim_history.push({
          source: "points",
          reason,
          amount,
          timestamp: timestamp.toString(),
          date: eventDate,
        });
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        process.stdout.write(`\r   Processed ${totalPointsEvents} events...`);
      }
    }

    console.log(
      `\r   ✅ Processed ${totalPointsEvents} PointsClaimed events\n`,
    );

    console.log("🔍 Step 2: Querying points::CheckInCompleted events...");

    hasNextPage = true;
    cursor = null;
    let checkinEvents = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::CheckInCompleted`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        checkinEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const pointsEarned = parseInt(data.points_earned);
        const currentStreak = parseInt(data.current_streak);
        const checkinDate = data.checkin_date;
        const isMilestone = data.is_milestone;
        const milestoneBonus = parseInt(data.milestone_bonus || "0");
        const timestamp = parseInt(data.timestamp);

        if (userPoints.has(walletAddress)) {
          const user = userPoints.get(walletAddress)!;
          user.total_checkins++;

          if (isMilestone && milestoneBonus > 0) {
            user.checkin_milestone_bonus += milestoneBonus;
            user.checkin_base_points += pointsEarned - milestoneBonus;
          } else {
            user.checkin_base_points += pointsEarned;
          }

          if (checkinDate > user.last_checkin_date || !user.last_checkin_date) {
            user.current_streak = currentStreak;
            user.last_checkin_date = checkinDate;
          }

          const existingIndex = user.claim_history.findIndex(
            (h) =>
              h.source === "points" &&
              h.reason === "Daily Check-in" &&
              h.timestamp === timestamp.toString(),
          );

          if (existingIndex >= 0) {
            user.claim_history[existingIndex].details = {
              streak: currentStreak,
              is_milestone: isMilestone,
              milestone_bonus: milestoneBonus,
              date: checkinDate,
            };
          }
        }
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        process.stdout.write(
          `\r   Processed ${checkinEvents} check-in events...`,
        );
      }
    }

    console.log(`\r   ✅ Processed ${checkinEvents} CheckInCompleted events\n`);

    console.log("🔍 Step 3: Querying task_points::TaskPointsClaimed events...");

    hasNextPage = true;
    cursor = null;
    let taskEvents = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::task_points::TaskPointsClaimed`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        taskEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const taskCount = parseInt(data.task_count);
        const pointsEarned = parseInt(data.points_earned);
        const timestamp = parseInt(data.timestamp);

        if (!userPoints.has(walletAddress)) {
          userPoints.set(walletAddress, {
            wallet_address: walletAddress,
            total_points_blockchain: 0,
            waitlist_points: 0,
            checkin_points: 0,
            checkin_base_points: 0,
            checkin_milestone_bonus: 0,
            task_points: 0,
            other_points: 0,
            total_checkins: 0,
            current_streak: 0,
            last_checkin_date: "",
            total_tasks_completed: 0,
            total_task_points: 0,
            first_claim_date: new Date(timestamp).toISOString(),
            last_activity_date: new Date(timestamp).toISOString(),
            claim_history: [],
          });
        }

        const user = userPoints.get(walletAddress)!;

        user.task_points += pointsEarned;
        user.total_tasks_completed += taskCount;
        user.total_task_points += pointsEarned;

        const eventDate = new Date(timestamp).toISOString();
        if (eventDate < user.first_claim_date) {
          user.first_claim_date = eventDate;
        }
        if (eventDate > user.last_activity_date) {
          user.last_activity_date = eventDate;
        }

        user.claim_history.push({
          source: "task_points",
          reason: "Task Completion",
          amount: pointsEarned,
          timestamp: timestamp.toString(),
          date: eventDate,
          details: {
            task_count: taskCount,
            points_per_task: 2,
          },
        });
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        process.stdout.write(`\r   Processed ${taskEvents} task events...`);
      }
    }

    console.log(`\r   ✅ Processed ${taskEvents} TaskPointsClaimed events\n`);

    console.log("🔧 Recalculating totals from accumulated category sums...");
    userPoints.forEach((user) => {
      user.total_points_blockchain =
        user.waitlist_points +
        user.checkin_points +
        user.task_points +
        user.other_points;
    });
    console.log("   ✅ Totals recalculated\n");

    console.log("=".repeat(80));
    console.log(`📈 TOTAL USERS WITH POINTS: ${userPoints.size}`);
    console.log("=".repeat(80) + "\n");

    if (userPoints.size === 0) {
      console.log("ℹ️  No users with points found.\n");
      return;
    }

    let totalPlatformPoints = 0;
    let totalWaitlistPoints = 0;
    let totalCheckinPoints = 0;
    let totalCheckinBasePoints = 0;
    let totalCheckinMilestoneBonus = 0;
    let totalTaskPoints = 0;
    let totalOtherPoints = 0;
    let totalCheckins = 0;
    let totalTasks = 0;

    userPoints.forEach((user) => {
      totalPlatformPoints += user.total_points_blockchain;
      totalWaitlistPoints += user.waitlist_points;
      totalCheckinPoints += user.checkin_points;
      totalCheckinBasePoints += user.checkin_base_points;
      totalCheckinMilestoneBonus += user.checkin_milestone_bonus;
      totalTaskPoints += user.task_points;
      totalOtherPoints += user.other_points;
      totalCheckins += user.total_checkins;
      totalTasks += user.total_tasks_completed;
    });

    console.log("🎯 Platform Statistics:");
    console.log(
      `   Total Points Distributed: ${totalPlatformPoints.toLocaleString()}`,
    );
    console.log(
      `   ├─ Waitlist Bonuses: ${totalWaitlistPoints.toLocaleString()}`,
    );
    console.log(
      `   ├─ Check-in Rewards: ${totalCheckinPoints.toLocaleString()}`,
    );
    console.log(
      `   │  ├─ Base Points: ${totalCheckinBasePoints.toLocaleString()}`,
    );
    console.log(
      `   │  └─ Milestone Bonuses: ${totalCheckinMilestoneBonus.toLocaleString()}`,
    );
    console.log(`   ├─ Task Completion: ${totalTaskPoints.toLocaleString()}`);
    console.log(`   └─ Other: ${totalOtherPoints.toLocaleString()}`);
    console.log();
    console.log(`   Total Check-ins: ${totalCheckins.toLocaleString()}`);
    console.log(`   Total Tasks Completed: ${totalTasks.toLocaleString()}`);
    console.log();

    const sortedUsers = Array.from(userPoints.values()).sort(
      (a, b) => b.total_points_blockchain - a.total_points_blockchain,
    );

    const mode = process.argv[2] || "summary";

    if (mode === "detailed" || mode === "--detailed") {
      console.log("📋 Detailed User List:\n");

      sortedUsers.forEach((user, index) => {
        console.log(`${index + 1}. ${user.wallet_address}`);
        console.log(
          `   Total Points: ${user.total_points_blockchain.toLocaleString()}`,
        );
        console.log(`   ├─ Waitlist: ${user.waitlist_points}`);
        console.log(
          `   ├─ Check-ins: ${user.checkin_points} (${user.total_checkins} total)`,
        );
        console.log(`   │  ├─ Base: ${user.checkin_base_points}`);
        console.log(
          `   │  └─ Milestone Bonus: ${user.checkin_milestone_bonus}`,
        );
        console.log(
          `   ├─ Tasks: ${user.task_points} (${user.total_tasks_completed} tasks)`,
        );
        console.log(`   └─ Other: ${user.other_points}`);
        console.log(`   Current Streak: ${user.current_streak} days`);
        console.log(`   Last Check-in: ${user.last_checkin_date || "N/A"}`);
        console.log(`   First Activity: ${user.first_claim_date}`);
        console.log(`   Last Activity: ${user.last_activity_date}`);
        console.log();
      });
    } else if (mode === "full" || mode === "--full") {
      console.log("📋 Full User List with Complete Transaction History:\n");

      sortedUsers.forEach((user, index) => {
        console.log(`${index + 1}. ${user.wallet_address}`);
        console.log(
          `   Total Points: ${user.total_points_blockchain.toLocaleString()}`,
        );
        console.log(`   Breakdown:`);
        console.log(`   ├─ Waitlist: ${user.waitlist_points}`);
        console.log(
          `   ├─ Check-ins: ${user.checkin_points} (${user.total_checkins} total, ${user.current_streak}d streak)`,
        );
        console.log(`   │  ├─ Base: ${user.checkin_base_points}`);
        console.log(`   │  └─ Milestone: ${user.checkin_milestone_bonus}`);
        console.log(
          `   ├─ Tasks: ${user.task_points} (${user.total_tasks_completed} completed)`,
        );
        console.log(`   └─ Other: ${user.other_points}`);
        console.log(
          `   Transaction History (${user.claim_history.length} claims):`,
        );

        const sortedHistory = user.claim_history.sort(
          (a, b) => parseInt(a.timestamp) - parseInt(b.timestamp),
        );

        sortedHistory.forEach((claim, idx) => {
          const details = claim.details
            ? ` ${JSON.stringify(claim.details)}`
            : "";
          console.log(
            `     ${idx + 1}. [${claim.source}] ${claim.reason}: +${claim.amount} points${details}`,
          );
          console.log(`        Date: ${claim.date}`);
        });
        console.log();
      });
    } else {
      console.log("📋 User Summary (Top 50):\n");
      console.log(
        "Rank | Address                                                            | Total  | Waitlist | Check-ins | Tasks | Streak",
      );
      console.log("-".repeat(150));

      sortedUsers.slice(0, 50).forEach((user, index) => {
        const rank = (index + 1).toString().padStart(4);
        const addr = user.wallet_address;
        const total = user.total_points_blockchain.toLocaleString().padStart(6);
        const waitlist = user.waitlist_points.toString().padStart(8);
        const checkins =
          `${user.checkin_points} (${user.total_checkins})`.padStart(9);
        const tasks =
          `${user.task_points} (${user.total_tasks_completed})`.padStart(5);
        const streak = `${user.current_streak}d`.padStart(6);

        console.log(
          `${rank} | ${addr} | ${total} | ${waitlist} | ${checkins} | ${tasks} | ${streak}`,
        );
      });

      if (sortedUsers.length > 50) {
        console.log(`\n... and ${sortedUsers.length - 50} more users\n`);
      }
    }

    const outputData = {
      network,
      package_id: packageId,
      queried_at: new Date().toISOString(),
      total_users: userPoints.size,
      total_platform_points: totalPlatformPoints,
      statistics: {
        waitlist_points: totalWaitlistPoints,
        checkin_points: totalCheckinPoints,
        checkin_base_points: totalCheckinBasePoints,
        checkin_milestone_bonus: totalCheckinMilestoneBonus,
        task_points: totalTaskPoints,
        other_points: totalOtherPoints,
        total_checkins: totalCheckins,
        total_tasks: totalTasks,
      },
      events_processed: {
        points_claimed: totalPointsEvents,
        checkin_completed: checkinEvents,
        task_points_claimed: taskEvents,
        total: totalPointsEvents + checkinEvents + taskEvents,
      },
      users: sortedUsers,
    };

    const outputPath = "./complete-platform-points.json";
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));

    console.log("\n" + "=".repeat(80));
    console.log(`💾 Full data saved to: ${outputPath}`);
    console.log("\nUsage modes:");
    console.log(
      "  npx tsx check-complete-platform-points.ts           # Summary (top 50)",
    );
    console.log(
      "  npx tsx check-complete-platform-points.ts detailed  # All users breakdown",
    );
    console.log(
      "  npx tsx check-complete-platform-points.ts full      # Full transaction history",
    );
    console.log("=".repeat(80) + "\n");
  } catch (error: any) {
    console.error("\n❌ Error querying blockchain:", error.message || error);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

main();
