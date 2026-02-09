// admin-scripts/check-treasury-balance.ts
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import "dotenv/config";

function mistToSui(mist: number): string {
  return (mist / 1_000_000_000).toFixed(4);
}

async function main() {
  console.log("💰 Treasury Balance Check\n");
  console.log("=".repeat(60));

  const network = process.env.SUI_NETWORK || "testnet";
  const subscriptionRegistryId = process.env.SUI_SUBSCRIPTION_REGISTRY_ID;
  const subscriptionPackageId =
    process.env.SUI_SUBSCRIPTION_PACKAGE_ID || process.env.SUI_PACKAGE_ID;

  if (!subscriptionRegistryId) {
    console.error("❌ Error: SUI_SUBSCRIPTION_REGISTRY_ID not set in .env");
    process.exit(1);
  }

  if (!subscriptionPackageId) {
    console.error(
      "❌ Error: SUI_SUBSCRIPTION_PACKAGE_ID or SUI_PACKAGE_ID not set in .env",
    );
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  try {
    console.log("\n📊 Fetching treasury balance...\n");

    // Method 1: Call view function
    const tx = new Transaction();

    tx.moveCall({
      target: `${subscriptionPackageId}::subscriptions::get_treasury_balance`,
      arguments: [tx.object(subscriptionRegistryId)],
    });

    const result = await client.devInspectTransactionBlock({
      sender:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      transactionBlock: tx,
    });

    if (result.results?.[0]?.returnValues?.[0]) {
      const [bytes] = result.results[0].returnValues[0];
      const view = new DataView(new Uint8Array(bytes).buffer);
      const balanceMist = Number(view.getBigUint64(0, true));
      const balanceSui = mistToSui(balanceMist);

      console.log("💎 Treasury Balance:");
      console.log(`   ${balanceSui} SUI`);
      console.log(`   (${balanceMist.toLocaleString()} MIST)`);
    } else {
      console.error("❌ Could not read treasury balance");
      process.exit(1);
    }

    // Get recent withdrawal events
    console.log("\n📜 Recent Withdrawals:");

    try {
      const withdrawEvents = await client.queryEvents({
        query: {
          MoveEventType: `${subscriptionPackageId}::subscriptions::TreasuryWithdrawn`,
        },
        limit: 5,
        order: "descending",
      });

      if (withdrawEvents.data.length > 0) {
        for (const ev of withdrawEvents.data) {
          const data = ev.parsedJson as any;
          const amount = Number(data.amount);
          const remaining = Number(data.remaining_balance);
          const admin = data.admin.substring(0, 10) + "...";

          console.log(`   ${admin}: withdrew ${mistToSui(amount)} SUI`);
          console.log(`      Remaining: ${mistToSui(remaining)} SUI`);
        }
      } else {
        console.log("   No withdrawals yet");
      }
    } catch (err) {
      console.log("   (Could not fetch withdrawal events)");
    }

    // Get recent fee collections
    console.log("\n📈 Recent Check-in Fees Collected:");

    try {
      const feeEvents = await client.queryEvents({
        query: {
          MoveEventType: `${process.env.SUI_PACKAGE_ID}::points::CheckinFeeCollected`,
        },
        limit: 10,
        order: "descending",
      });

      if (feeEvents.data.length > 0) {
        let totalFees = 0;

        for (const ev of feeEvents.data) {
          const data = ev.parsedJson as any;
          const feeAmount = Number(data.fee_amount);
          totalFees += feeAmount;

          const wallet = data.wallet_address.substring(0, 10) + "...";
          const timestamp = new Date(Number(data.timestamp)).toLocaleString();

          console.log(
            `   ${wallet}: ${mistToSui(feeAmount)} SUI (${timestamp})`,
          );
        }

        console.log(
          `\n   Total (last ${feeEvents.data.length} fees): ${mistToSui(totalFees)} SUI`,
        );
      } else {
        console.log("   No fees collected yet");
      }
    } catch (err) {
      console.log("   (Could not fetch fee events)");
    }

    // Get subscription payments
    console.log("\n💳 Recent Premium Subscriptions:");

    try {
      const subEvents = await client.queryEvents({
        query: {
          MoveEventType: `${subscriptionPackageId}::subscriptions::PremiumSubscribed`,
        },
        limit: 5,
        order: "descending",
      });

      if (subEvents.data.length > 0) {
        let totalSubs = 0;

        for (const ev of subEvents.data) {
          const data = ev.parsedJson as any;
          const amount = Number(data.amount_paid);
          totalSubs += amount;

          const wallet = data.wallet_address.substring(0, 10) + "...";
          const timestamp = new Date(Number(data.timestamp)).toLocaleString();

          console.log(`   ${wallet}: ${mistToSui(amount)} SUI (${timestamp})`);
        }

        console.log(
          `\n   Total (last ${subEvents.data.length} subs): ${mistToSui(totalSubs)} SUI`,
        );
      } else {
        console.log("   No subscriptions yet");
      }
    } catch (err) {
      console.log("   (Could not fetch subscription events)");
    }

    console.log("\n" + "=".repeat(60));
    console.log("\n💡 To withdraw funds, run:");
    console.log("   ts-node withdraw-treasury.ts <AMOUNT_IN_SUI>");
    console.log("   or");
    console.log("   ts-node withdraw-treasury.ts all\n");
  } catch (error) {
    console.error("\n❌ Error checking treasury balance:", error);
    process.exit(1);
  }
}

main();
