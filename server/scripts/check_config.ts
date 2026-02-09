// admin-scripts/check-config.ts
import { TicketMinter } from "../src/services/ticketMinter";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import "dotenv/config";

function mistToSui(mist: number): string {
  return (mist / 1_000_000_000).toFixed(3);
}

async function main() {
  console.log("📊 Check-in Fee Configuration\n");
  console.log("=".repeat(60));

  const minter = new TicketMinter();
  const client = new SuiClient({
    url: getFullnodeUrl(
      (process.env.SUI_NETWORK as "testnet" | "mainnet") || "testnet",
    ),
  });

  try {
    // Get current configuration
    const fee = await minter.getCheckinFee();
    const treasury = await minter.getFeeTreasury();

    console.log("\n📋 Current Settings:");
    console.log(`   Fee Amount: ${fee} MIST (${mistToSui(fee)} SUI)`);
    console.log(`   Treasury: ${treasury}`);

    // Check if treasury is set
    if (
      !treasury ||
      treasury ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      console.log("\n⚠️  WARNING: Treasury address not set!");
      console.log("   Run: ts-node set-treasury.ts <TREASURY_ADDRESS>");
    } else {
      // Try to get treasury balance
      try {
        const objects = await client.getOwnedObjects({
          owner: treasury,
          filter: { StructType: "0x2::coin::Coin<0x2::sui::SUI>" },
        });

        console.log(`\n💰 Treasury Info:`);
        console.log(`   Address: ${treasury}`);
        console.log(`   SUI Coins: ${objects.data.length}`);
      } catch (err) {
        console.log(`\n   (Could not fetch treasury balance)`);
      }
    }

    // Get recent fee collection events
    const packageId = process.env.SUI_PACKAGE_ID!;

    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::CheckinFeeCollected`,
        },
        limit: 10,
        order: "descending",
      });

      if (events.data.length > 0) {
        console.log("\n📈 Recent Fee Collections:");
        let totalFees = 0;

        for (const ev of events.data) {
          const data = ev.parsedJson as any;
          const feeAmount = Number(data.fee_amount);
          totalFees += feeAmount;

          const wallet = data.wallet_address.substring(0, 10) + "...";
          console.log(`   ${wallet}: ${mistToSui(feeAmount)} SUI`);
        }

        console.log(
          `\n   Total (last ${events.data.length}): ${mistToSui(totalFees)} SUI`,
        );
      } else {
        console.log("\n📈 No fee collections yet");
      }
    } catch (err) {
      console.log("\n   (Could not fetch fee events)");
    }

    // Get fee update events
    try {
      const updateEvents = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::points::FeeUpdated`,
        },
        limit: 5,
        order: "descending",
      });

      if (updateEvents.data.length > 0) {
        console.log("\n📝 Fee Update History:");

        for (const ev of updateEvents.data) {
          const data = ev.parsedJson as any;
          const oldFee = Number(data.old_fee);
          const newFee = Number(data.new_fee);

          console.log(`   ${mistToSui(oldFee)} → ${mistToSui(newFee)} SUI`);
        }
      }
    } catch (err) {
      console.log("\n   (Could not fetch update events)");
    }

    console.log("\n" + "=".repeat(60));
  } catch (error) {
    console.error("\n❌ Error fetching configuration:", error);
    process.exit(1);
  }
}

main();
