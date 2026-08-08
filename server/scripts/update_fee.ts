// admin-scripts/update-fee.ts
import { TicketMinter } from "../src/services/ticketMinter";
import "dotenv/config";

function suiToMist(sui: number): number {
  return Math.floor(sui * 1_000_000_000);
}

function mistToSui(mist: number): string {
  return (mist / 1_000_000_000).toFixed(3);
}

async function main() {
  console.log("💰 Updating Check-in Fee\n");

  const minter = new TicketMinter();

  // Get current fee
  const currentFee = await minter.getCheckinFee();
  console.log(
    `Current fee: ${currentFee} MIST (${mistToSui(currentFee)} SUI)\n`,
  );

  // Get new fee from command line
  const newFeeSUI = parseFloat(process.argv[2]);

  if (!newFeeSUI || isNaN(newFeeSUI)) {
    console.error("❌ Error: Valid fee amount required");
    console.log("\nUsage:");
    console.log("  ts-node update-fee.ts <FEE_IN_SUI>");
    console.log("\nExamples:");
    console.log("  ts-node update-fee.ts 0.001  # Set fee to 0.001 SUI");
    console.log("  ts-node update-fee.ts 0.002  # Set fee to 0.002 SUI");
    console.log("  ts-node update-fee.ts 0.005  # Set fee to 0.005 SUI");
    process.exit(1);
  }

  const newFeeMIST = suiToMist(newFeeSUI);
  console.log(`New fee: ${newFeeMIST} MIST (${mistToSui(newFeeMIST)} SUI)\n`);

  // Confirm
  if (process.argv[3] !== "--confirm") {
    console.log("⚠️  This will update the check-in fee immediately!");
    console.log("   All new check-ins will use the new fee.");
    console.log("\nTo proceed, run:");
    console.log(`  ts-node update-fee.ts ${newFeeSUI} --confirm\n`);
    process.exit(0);
  }

  try {
    const result = await minter.updateCheckinFee(newFeeMIST);

    if (result) {
      console.log("\n✅ Fee updated successfully!");
      console.log(`   Old fee: ${mistToSui(currentFee)} SUI`);
      console.log(`   New fee: ${mistToSui(newFeeMIST)} SUI`);
      console.log(`   Transaction: ${result}`);

      // Verify
      const verifiedFee = await minter.getCheckinFee();
      console.log(`\n   Verified fee: ${mistToSui(verifiedFee)} SUI`);
    } else {
      console.error("\n❌ Failed to update fee");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Error updating fee:", error);
    process.exit(1);
  }
}

main();
