import { TicketMinter } from "../src/services/ticketMinter";
import "dotenv/config";

async function main() {
  console.log("🏦 Setting Fee Treasury Address\n");

  const minter = new TicketMinter();

  const treasuryAddress =
    process.argv[2] || process.env.SUI_SUBSCRIPTION_REGISTRY_ID;

  if (!treasuryAddress) {
    console.error("❌ Error: Treasury address required");
    console.log("\nUsage:");
    console.log("  ts-node set-treasury.ts <TREASURY_ADDRESS>");
    console.log("  or set SUI_SUBSCRIPTION_REGISTRY_ID in .env");
    process.exit(1);
  }

  console.log(`Setting treasury to: ${treasuryAddress}\n`);

  try {
    const result = await minter.setFeeTreasury(treasuryAddress);

    if (result) {
      console.log("\n✅ Treasury set successfully!");
      console.log(`   Transaction: ${result}`);
      console.log(`   Treasury: ${treasuryAddress}`);

      const currentTreasury = await minter.getFeeTreasury();
      console.log(`\n   Verified treasury: ${currentTreasury}`);
    } else {
      console.error("\n❌ Failed to set treasury");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Error setting treasury:", error);
    process.exit(1);
  }
}

main();
