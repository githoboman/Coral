import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

interface PointsClaimedEvent {
  wallet_address: string;
  amount: string;
  reason: string;
  new_balance: string;
  timestamp: string;
}

/**
 * Check if an address has claimed waitlist points by querying events
 */
async function hasClaimedViaEvents(
  client: SuiClient,
  packageId: string,
  walletAddress: string,
): Promise<boolean> {
  console.log(`   Checking events for ${walletAddress}...`);

  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const events = await client.queryEvents({
      query: {
        MoveEventType: `${packageId}::points::PointsClaimed`,
      },
      cursor,
      limit: 50,
    });

    for (const event of events.data) {
      const parsedJson = event.parsedJson as any;

      if (
        parsedJson.wallet_address === walletAddress &&
        parsedJson.reason === "Waitlist Bonus"
      ) {
        return true;
      }
    }

    hasNextPage = events.hasNextPage;
    cursor = events.nextCursor ?? null;
  }

  return false;
}

async function main() {
  console.log("🎁 Sponsored Waitlist Points Claim (Improved)\n");
  console.log("=".repeat(60));

  const network = process.env.SUI_NETWORK || "testnet";
  const privateKey = process.env.WALRUS_PRIVATE_KEY;
  const adminCapId = process.env.SUI_ADMIN_CAP_ID;
  const pointsRegistryId = process.env.SUI_POINTS_REGISTRY_ID;
  const packageId = process.env.SUI_PACKAGE_ID;

  // Validate environment variables
  if (!privateKey) {
    console.error("❌ Error: WALRUS_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  if (!adminCapId) {
    console.error("❌ Error: SUI_ADMIN_CAP_ID not set in .env");
    process.exit(1);
  }

  if (!pointsRegistryId) {
    console.error("❌ Error: SUI_POINTS_REGISTRY_ID not set in .env");
    process.exit(1);
  }

  if (!packageId) {
    console.error("❌ Error: SUI_PACKAGE_ID not set in .env");
    process.exit(1);
  }

  // Get beneficiary address from command line
  const beneficiaryAddress = process.argv[2];

  if (!beneficiaryAddress) {
    console.error("\n❌ Error: Beneficiary address required");
    console.log("\nUsage:");
    console.log(
      "  npx tsx sponsor-waitlist-claim.ts <WALLET_ADDRESS> [--confirm]",
    );
    console.log("\nExample:");
    console.log(
      "  npx tsx sponsor-waitlist-claim.ts 0x1234...abcdef --confirm",
    );
    process.exit(1);
  }

  // Validate address format
  if (
    !beneficiaryAddress.startsWith("0x") ||
    beneficiaryAddress.length !== 66
  ) {
    console.error(
      "\n❌ Error: Invalid Sui address format. Must start with 0x and be 66 characters long.",
    );
    process.exit(1);
  }

  // Initialize client and keypair
  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const adminAddress = keypair.toSuiAddress();

  console.log(`\n🔑 Admin Address: ${adminAddress}`);
  console.log(`🎯 Beneficiary Address: ${beneficiaryAddress}`);
  console.log(`💰 Points to Award: 100 (Waitlist Bonus)`);
  console.log(`🌐 Network: ${network}`);

  // Check if user has already claimed by querying events
  console.log("\n🔍 Checking on-chain state...");

  try {
    const hasClaimed = await hasClaimedViaEvents(
      client,
      packageId,
      beneficiaryAddress,
    );

    if (hasClaimed) {
      console.log(
        "\n⚠️  WARNING: This user has already claimed waitlist points!",
      );
      console.log(
        "   Found 'PointsClaimed' event with reason='Waitlist Bonus'",
      );
      console.log("   Proceeding will fail with EAlreadyClaimed error.\n");

      if (process.argv[3] !== "--force") {
        console.log("To proceed anyway, run:");
        console.log(
          `  npx tsx sponsor-waitlist-claim.ts ${beneficiaryAddress} --force\n`,
        );
        process.exit(0);
      }

      console.log("⚠️  --force flag detected, attempting claim anyway...\n");
    } else {
      console.log("✅ User has not claimed yet (checked via events)\n");
    }
  } catch (error: any) {
    console.log("⚠️  Could not verify claim status via events");
    console.log(`   Error: ${error.message}`);
    console.log("   Proceeding anyway...\n");
  }

  // Confirm before proceeding
  if (process.argv[3] !== "--confirm" && process.argv[3] !== "--force") {
    console.log("⚠️  This will award 100 waitlist points to the user.");
    console.log("   You (admin) will pay the gas fees.\n");
    console.log("To proceed, run:");
    console.log(
      `  npx tsx sponsor-waitlist-claim.ts ${beneficiaryAddress} --confirm\n`,
    );
    process.exit(0);
  }

  try {
    console.log("🔄 Processing sponsored claim...\n");

    const claimTx = new Transaction();
    claimTx.setGasBudget(10_000_000);

    claimTx.moveCall({
      target: `${packageId}::points::sponsored_claim_waitlist_points`,
      arguments: [
        claimTx.object(adminCapId),
        claimTx.object(pointsRegistryId),
        claimTx.pure.address(beneficiaryAddress),
        claimTx.object("0x6"), // Clock object
      ],
    });

    const claimResult = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: claimTx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    if (claimResult.effects?.status?.status === "success") {
      console.log("✅ Waitlist points awarded successfully!\n");
      console.log(`   Transaction: ${claimResult.digest}`);
      console.log(`   Beneficiary: ${beneficiaryAddress}`);
      console.log(`   Points Awarded: 100`);

      // Check for PointsClaimed event
      const events = claimResult.events || [];
      const claimEvent = events.find(
        (e) => e.type === `${packageId}::points::PointsClaimed`,
      );

      if (claimEvent) {
        const data = claimEvent.parsedJson as unknown as PointsClaimedEvent;
        console.log(`   New Balance: ${data.new_balance} points`);
        console.log(`   Reason: ${data.reason}`);
      }

      console.log("\n" + "=".repeat(60));
      console.log("\n💡 The user can now check their balance in your app!");
    } else {
      console.error("\n❌ Claim failed!");
      console.error("   Status:", claimResult.effects?.status);

      const errorMsg = claimResult.effects?.status?.error || "";

      if (errorMsg.includes("1)")) {
        console.error("\n   Error Code 1: EAlreadyClaimed");
        console.error(
          "   This user has already claimed their waitlist points.",
        );
        console.error(
          "\n   The address is stored on-chain with a different format.",
        );
        console.error("   Run: npx tsx check-claimed-addresses.ts");
        console.error("   to see all claimed addresses.\n");
      }

      process.exit(1);
    }
  } catch (error: any) {
    console.error("\n❌ Error during sponsored claim:", error.message || error);

    if (error.message?.includes("1)")) {
      console.error("\n   Error Code 1: EAlreadyClaimed");
      console.error("   User has already claimed their waitlist points.");
    } else if (error.message?.includes("E_NOT_ADMIN")) {
      console.error(
        "\n   Error: Not authorized. Make sure you're using the correct admin private key.",
      );
    }

    process.exit(1);
  }
}

main();
