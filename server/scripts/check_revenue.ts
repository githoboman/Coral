import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import "dotenv/config";
import * as fs from "fs/promises";

interface PremiumSubscribedEvent {
  wallet_address: string;
  tier: string;
  started_at: string;
  expires_at: string;
  amount_paid: string;
  timestamp: string;
}

interface CheckinFeeCollectedEvent {
  wallet_address: string;
  fee_amount: string;
  timestamp: string;
}

interface TreasuryWithdrawnEvent {
  admin: string;
  amount: string;
  remaining_balance: string;
  timestamp: string;
}

interface TreasuryDepositEvent {
  amount: string;
  new_balance: string;
  timestamp: string;
}

interface FeeUpdatedEvent {
  old_fee: string;
  new_fee: string;
  admin: string;
  timestamp: string;
}

interface TransactionRecord {
  type: string;
  wallet_address: string;
  amount: number;
  timestamp: number;
  date: string;
  details?: any;
}

interface DailyStats {
  date: string;
  subscription_revenue: number;
  subscription_count: number;
  checkin_fees: number;
  checkin_count: number;
  total_volume: number;
  transaction_count: number;
}

interface UserSpending {
  wallet_address: string;
  total_spent: number;
  subscription_payments: number;
  subscription_count: number;
  checkin_fees: number;
  checkin_count: number;
  first_transaction: string;
  last_transaction: string;
}

async function main() {
  console.log("💰 Platform Transaction Volume & Revenue Report\n");
  console.log("=".repeat(80));

  const network = process.env.SUI_NETWORK || "testnet";
  const packageId = process.env.SUI_PACKAGE_ID;
  const subscriptionRegistryId = process.env.SUI_SUBSCRIPTION_REGISTRY_ID;

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
    const allTransactions: TransactionRecord[] = [];
    const userSpending = new Map<string, UserSpending>();
    const dailyStats = new Map<string, DailyStats>();

    // ========================================================================
    // STEP 1: Query subscriptions::PremiumSubscribed events
    // ========================================================================
    console.log("🔍 Step 1: Querying subscription payments...");

    let hasNextPage = true;
    let cursor: string | null = null;
    let subscriptionEvents = 0;
    let totalSubscriptionRevenue = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::subscriptions::PremiumSubscribed`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        subscriptionEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const amountPaid = parseInt(data.amount_paid);
        const timestamp = parseInt(data.timestamp);
        const tier = parseInt(data.tier);

        totalSubscriptionRevenue += amountPaid;

        // Record transaction
        const date = new Date(timestamp).toISOString();
        allTransactions.push({
          type: "subscription",
          wallet_address: walletAddress,
          amount: amountPaid,
          timestamp,
          date,
          details: {
            tier,
            started_at: data.started_at,
            expires_at: data.expires_at,
          },
        });

        // Update user spending
        if (!userSpending.has(walletAddress)) {
          userSpending.set(walletAddress, {
            wallet_address: walletAddress,
            total_spent: 0,
            subscription_payments: 0,
            subscription_count: 0,
            checkin_fees: 0,
            checkin_count: 0,
            first_transaction: date,
            last_transaction: date,
          });
        }

        const userStats = userSpending.get(walletAddress)!;
        userStats.total_spent += amountPaid;
        userStats.subscription_payments += amountPaid;
        userStats.subscription_count++;
        if (date < userStats.first_transaction)
          userStats.first_transaction = date;
        if (date > userStats.last_transaction)
          userStats.last_transaction = date;

        // Update daily stats
        const dayKey = date.split("T")[0];
        if (!dailyStats.has(dayKey)) {
          dailyStats.set(dayKey, {
            date: dayKey,
            subscription_revenue: 0,
            subscription_count: 0,
            checkin_fees: 0,
            checkin_count: 0,
            total_volume: 0,
            transaction_count: 0,
          });
        }

        const dayStats = dailyStats.get(dayKey)!;
        dayStats.subscription_revenue += amountPaid;
        dayStats.subscription_count++;
        dayStats.total_volume += amountPaid;
        dayStats.transaction_count++;
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        process.stdout.write(
          `\r   Processed ${subscriptionEvents} subscription events...`,
        );
      }
    }

    console.log(
      `\r   ✅ Processed ${subscriptionEvents} subscription payments\n`,
    );

    // ========================================================================
    // STEP 2: Query points::CheckinFeeCollected events
    // ========================================================================
    console.log("🔍 Step 2: Querying check-in fees...");

    hasNextPage = true;
    cursor = null;
    let checkinFeeEvents = 0;
    let totalCheckinFees = 0;

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::CheckinFeeCollected`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        checkinFeeEvents++;
        const data = event.parsedJson as any;

        const walletAddress = data.wallet_address;
        const feeAmount = parseInt(data.fee_amount);
        const timestamp = parseInt(data.timestamp);

        totalCheckinFees += feeAmount;

        // Record transaction
        const date = new Date(timestamp).toISOString();
        allTransactions.push({
          type: "checkin_fee",
          wallet_address: walletAddress,
          amount: feeAmount,
          timestamp,
          date,
        });

        // Update user spending
        if (!userSpending.has(walletAddress)) {
          userSpending.set(walletAddress, {
            wallet_address: walletAddress,
            total_spent: 0,
            subscription_payments: 0,
            subscription_count: 0,
            checkin_fees: 0,
            checkin_count: 0,
            first_transaction: date,
            last_transaction: date,
          });
        }

        const userStats = userSpending.get(walletAddress)!;
        userStats.total_spent += feeAmount;
        userStats.checkin_fees += feeAmount;
        userStats.checkin_count++;
        if (date < userStats.first_transaction)
          userStats.first_transaction = date;
        if (date > userStats.last_transaction)
          userStats.last_transaction = date;

        // Update daily stats
        const dayKey = date.split("T")[0];
        if (!dailyStats.has(dayKey)) {
          dailyStats.set(dayKey, {
            date: dayKey,
            subscription_revenue: 0,
            subscription_count: 0,
            checkin_fees: 0,
            checkin_count: 0,
            total_volume: 0,
            transaction_count: 0,
          });
        }

        const dayStats = dailyStats.get(dayKey)!;
        dayStats.checkin_fees += feeAmount;
        dayStats.checkin_count++;
        dayStats.total_volume += feeAmount;
        dayStats.transaction_count++;
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        process.stdout.write(
          `\r   Processed ${checkinFeeEvents} check-in fee events...`,
        );
      }
    }

    console.log(`\r   ✅ Processed ${checkinFeeEvents} check-in fees\n`);

    // ========================================================================
    // STEP 3: Query subscriptions::TreasuryWithdrawn events (for audit trail)
    // ========================================================================
    console.log("🔍 Step 3: Querying treasury withdrawals...");

    hasNextPage = true;
    cursor = null;
    let withdrawalEvents = 0;
    let totalWithdrawals = 0;

    const withdrawals: Array<{
      admin: string;
      amount: number;
      remaining_balance: number;
      timestamp: number;
      date: string;
    }> = [];

    while (hasNextPage) {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::subscriptions::TreasuryWithdrawn`,
        },
        cursor,
        limit: 50,
      });

      for (const event of events.data) {
        withdrawalEvents++;
        const data = event.parsedJson as any;

        const admin = data.admin;
        const amount = parseInt(data.amount);
        const remainingBalance = parseInt(data.remaining_balance);
        const timestamp = parseInt(data.timestamp);

        totalWithdrawals += amount;

        withdrawals.push({
          admin,
          amount,
          remaining_balance: remainingBalance,
          timestamp,
          date: new Date(timestamp).toISOString(),
        });
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;
    }

    console.log(`   ✅ Processed ${withdrawalEvents} treasury withdrawals\n`);

    // ========================================================================
    // STEP 4: Query current treasury balance
    // ========================================================================
    let currentTreasuryBalance = 0;

    if (subscriptionRegistryId) {
      console.log("🔍 Step 4: Checking current treasury balance...");

      try {
        const registryObject = await client.getObject({
          id: subscriptionRegistryId,
          options: {
            showContent: true,
          },
        });

        if (
          registryObject.data?.content &&
          registryObject.data.content.dataType === "moveObject"
        ) {
          const fields = registryObject.data.content.fields as any;
          currentTreasuryBalance = parseInt(fields.treasury || "0");
          console.log(
            `   ✅ Current treasury balance: ${(currentTreasuryBalance / 1_000_000_000).toFixed(2)} SUI\n`,
          );
        }
      } catch (error) {
        console.log("   ⚠️  Could not fetch current treasury balance\n");
      }
    } else {
      console.log(
        "⚠️  Step 4: Skipping (no SUI_SUBSCRIPTION_REGISTRY_ID in .env)\n",
      );
    }

    // ========================================================================
    // STEP 5: Calculate and Display Results
    // ========================================================================
    const totalVolume = totalSubscriptionRevenue + totalCheckinFees;
    const totalTransactions = subscriptionEvents + checkinFeeEvents;

    console.log("=".repeat(80));
    console.log("💰 PLATFORM REVENUE & VOLUME SUMMARY");
    console.log("=".repeat(80) + "\n");

    // Convert MIST to SUI (1 SUI = 1,000,000,000 MIST)
    const suiSubscriptions = totalSubscriptionRevenue / 1_000_000_000;
    const suiCheckins = totalCheckinFees / 1_000_000_000;
    const suiTotal = totalVolume / 1_000_000_000;
    const suiWithdrawals = totalWithdrawals / 1_000_000_000;
    const suiTreasury = currentTreasuryBalance / 1_000_000_000;

    console.log("📊 Overall Statistics:");
    console.log(
      `   Total Transaction Volume: ${suiTotal.toFixed(4)} SUI (${totalVolume.toLocaleString()} MIST)`,
    );
    console.log(
      `   ├─ Subscription Revenue: ${suiSubscriptions.toFixed(4)} SUI (${subscriptionEvents} payments)`,
    );
    console.log(
      `   └─ Check-in Fees: ${suiCheckins.toFixed(4)} SUI (${checkinFeeEvents} fees)`,
    );
    console.log();
    console.log(`   Total Transactions: ${totalTransactions.toLocaleString()}`);
    console.log(`   Unique Paying Users: ${userSpending.size}`);
    console.log();

    if (withdrawalEvents > 0) {
      console.log("💸 Treasury Management:");
      console.log(
        `   Total Withdrawn: ${suiWithdrawals.toFixed(4)} SUI (${withdrawalEvents} withdrawals)`,
      );
      console.log(`   Current Treasury: ${suiTreasury.toFixed(4)} SUI`);
      console.log(
        `   Expected Balance: ${(suiTotal - suiWithdrawals).toFixed(4)} SUI`,
      );

      const difference = Math.abs(suiTotal - suiWithdrawals - suiTreasury);
      if (difference > 0.0001) {
        console.log(`   ⚠️  Discrepancy: ${difference.toFixed(4)} SUI`);
      } else {
        console.log(`   ✅ Balance matches expected value`);
      }
      console.log();
    }

    // Average transaction values
    const avgSubscription =
      subscriptionEvents > 0 ? suiSubscriptions / subscriptionEvents : 0;
    const avgCheckinFee =
      checkinFeeEvents > 0 ? suiCheckins / checkinFeeEvents : 0;

    console.log("📈 Average Transaction Values:");
    console.log(`   Avg Subscription: ${avgSubscription.toFixed(4)} SUI`);
    console.log(`   Avg Check-in Fee: ${avgCheckinFee.toFixed(4)} SUI`);
    console.log();

    // Sort user spending
    const topSpenders = Array.from(userSpending.values()).sort(
      (a, b) => b.total_spent - a.total_spent,
    );

    // Display mode
    const mode = process.argv[2] || "summary";

    if (mode === "detailed" || mode === "--detailed") {
      console.log("👥 Top 20 Spenders:\n");

      topSpenders.slice(0, 20).forEach((user, index) => {
        console.log(`${index + 1}. ${user.wallet_address}`);
        console.log(
          `   Total Spent: ${(user.total_spent / 1_000_000_000).toFixed(4)} SUI`,
        );
        console.log(
          `   ├─ Subscriptions: ${(user.subscription_payments / 1_000_000_000).toFixed(4)} SUI (${user.subscription_count}x)`,
        );
        console.log(
          `   └─ Check-in Fees: ${(user.checkin_fees / 1_000_000_000).toFixed(4)} SUI (${user.checkin_count}x)`,
        );
        console.log(`   First Transaction: ${user.first_transaction}`);
        console.log(`   Last Transaction: ${user.last_transaction}`);
        console.log();
      });
    } else if (mode === "daily" || mode === "--daily") {
      // Sort daily stats by date
      const sortedDays = Array.from(dailyStats.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      console.log("📅 Daily Revenue Breakdown:\n");
      console.log(
        "Date       | Subs Revenue | Subs # | Checkin Fees | Checkin # | Total Volume | Total Txns",
      );
      console.log("-".repeat(100));

      sortedDays.forEach((day) => {
        const date = day.date;
        const subsRev = (day.subscription_revenue / 1_000_000_000)
          .toFixed(2)
          .padStart(12);
        const subsCount = day.subscription_count.toString().padStart(6);
        const checkinRev = (day.checkin_fees / 1_000_000_000)
          .toFixed(2)
          .padStart(12);
        const checkinCount = day.checkin_count.toString().padStart(9);
        const totalVol = (day.total_volume / 1_000_000_000)
          .toFixed(2)
          .padStart(12);
        const totalTxn = day.transaction_count.toString().padStart(10);

        console.log(
          `${date} | ${subsRev} | ${subsCount} | ${checkinRev} | ${checkinCount} | ${totalVol} | ${totalTxn}`,
        );
      });
      console.log();
    } else if (mode === "withdrawals" || mode === "--withdrawals") {
      if (withdrawals.length > 0) {
        console.log("💸 Treasury Withdrawal History:\n");

        withdrawals
          .sort((a, b) => a.timestamp - b.timestamp)
          .forEach((w, index) => {
            console.log(`${index + 1}. ${w.date}`);
            console.log(`   Admin: ${w.admin}`);
            console.log(
              `   Amount: ${(w.amount / 1_000_000_000).toFixed(4)} SUI`,
            );
            console.log(
              `   Remaining Balance: ${(w.remaining_balance / 1_000_000_000).toFixed(4)} SUI`,
            );
            console.log();
          });
      } else {
        console.log("ℹ️  No treasury withdrawals found\n");
      }
    } else {
      // Summary mode (default)
      console.log("👥 Top 10 Spenders:\n");
      console.log(
        "Rank | Address                                                            | Total Spent | Subs | Check-ins",
      );
      console.log("-".repeat(120));

      topSpenders.slice(0, 10).forEach((user, index) => {
        const rank = (index + 1).toString().padStart(4);
        const addr = user.wallet_address;
        const spent = (user.total_spent / 1_000_000_000)
          .toFixed(4)
          .padStart(11);
        const subs = user.subscription_count.toString().padStart(4);
        const checkins = user.checkin_count.toString().padStart(10);

        console.log(`${rank} | ${addr} | ${spent} SUI | ${subs} | ${checkins}`);
      });
      console.log();
    }

    // Save to JSON
    const outputData = {
      network,
      package_id: packageId,
      queried_at: new Date().toISOString(),
      summary: {
        total_volume_mist: totalVolume,
        total_volume_sui: suiTotal,
        subscription_revenue_mist: totalSubscriptionRevenue,
        subscription_revenue_sui: suiSubscriptions,
        subscription_count: subscriptionEvents,
        checkin_fees_mist: totalCheckinFees,
        checkin_fees_sui: suiCheckins,
        checkin_count: checkinFeeEvents,
        total_transactions: totalTransactions,
        unique_paying_users: userSpending.size,
        total_withdrawals_mist: totalWithdrawals,
        total_withdrawals_sui: suiWithdrawals,
        current_treasury_mist: currentTreasuryBalance,
        current_treasury_sui: suiTreasury,
      },
      daily_stats: Array.from(dailyStats.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      top_spenders: topSpenders,
      withdrawals,
      all_transactions: allTransactions.sort(
        (a, b) => a.timestamp - b.timestamp,
      ),
    };

    const outputPath = "./platform-revenue-report.json";
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));

    console.log("=".repeat(80));
    console.log(`💾 Full report saved to: ${outputPath}`);
    console.log("\nUsage modes:");
    console.log(
      "  npx tsx check-platform-revenue.ts              # Summary (top 10 spenders)",
    );
    console.log(
      "  npx tsx check-platform-revenue.ts detailed     # Top 20 spenders breakdown",
    );
    console.log(
      "  npx tsx check-platform-revenue.ts daily        # Daily revenue breakdown",
    );
    console.log(
      "  npx tsx check-platform-revenue.ts withdrawals  # Treasury withdrawal history",
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
