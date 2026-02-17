import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import "dotenv/config";
import { WalrusUserManager } from "../src/services/walrusUserManager";

function normalizeAddress(addr: string): string {
  const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + hex.padStart(64, "0");
}

function toMoveAddressFormat(addr: string): string {
  const normalized = normalizeAddress(addr);
  const withoutPrefix = normalized.slice(2);
  const withoutLeadingZeros = withoutPrefix.replace(/^0+/, "") || "0";
  return "0x" + withoutLeadingZeros;
}

async function checkClaimStatus(
  client: SuiClient,
  packageId: string,
  pointsRegistryId: string,
  walletAddress: string,
): Promise<{
  hasClaimed: boolean;
  balance: number;
}> {
  try {
    const normalized = normalizeAddress(walletAddress);
    const moveAddr = toMoveAddressFormat(walletAddress);

    // Check if claimed
    const claimTx = new Transaction();
    claimTx.moveCall({
      target: `${packageId}::points::has_claimed`,
      arguments: [
        claimTx.object(pointsRegistryId),
        claimTx.pure.string(moveAddr),
      ],
    });

    const claimResult = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: claimTx,
    });

    let hasClaimed = false;
    if (claimResult.results?.[0]?.returnValues?.[0]) {
      const [bytes] = claimResult.results[0].returnValues[0];
      hasClaimed = bytes[0] === 1;
    }

    // Get balance
    const balanceTx = new Transaction();
    balanceTx.moveCall({
      target: `${packageId}::points::get_balance`,
      arguments: [
        balanceTx.object(pointsRegistryId),
        balanceTx.pure.string(moveAddr),
      ],
    });

    const balanceResult = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: balanceTx,
    });

    let balance = 0;
    if (balanceResult.results?.[0]?.returnValues?.[0]) {
      const [bytes] = balanceResult.results[0].returnValues[0];
      const view = new DataView(new Uint8Array(bytes).buffer);
      balance = Number(view.getBigUint64(0, true));
    }

    // Consider claimed if the flag is true OR if balance >= 100 (waitlist bonus amount)
    // This handles cases where points exist but the flag check might fail
    const effectivelyClaimed = hasClaimed || balance >= 100;

    return { hasClaimed: effectivelyClaimed, balance };
  } catch (error) {
    console.error("Error checking claim status:", error);
    return { hasClaimed: false, balance: 0 };
  }
}

async function main() {
  console.log("🔍 Check Waitlist Claim Status\n");
  console.log("=".repeat(60));

  const network = process.env.SUI_NETWORK || "testnet";
  const packageId = process.env.SUI_PACKAGE_ID;
  const pointsRegistryId = process.env.SUI_POINTS_REGISTRY_ID;

  // Note: For email lookup to work, you need USERS_REGISTRY_BLOB_ID set
  // This should be a direct blob ID (not an object ID like SUI_BLOB_REGISTRY_ID)
  const usersRegistryBlobId = process.env.USERS_REGISTRY_BLOB_ID;

  if (!packageId) {
    console.error("❌ Error: SUI_PACKAGE_ID not set in .env");
    process.exit(1);
  }

  if (!pointsRegistryId) {
    console.error("❌ Error: SUI_POINTS_REGISTRY_ID not set in .env");
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  const input = process.argv[2];

  if (!input) {
    console.error("\n❌ Error: Email or wallet address required");
    console.log("\nUsage:");
    console.log("  ts-node check-waitlist-claim.ts <EMAIL_OR_WALLET_ADDRESS>");
    console.log("\nExamples:");
    console.log("  ts-node check-waitlist-claim.ts user@example.com");
    console.log(
      "  ts-node check-waitlist-claim.ts 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    );
    process.exit(1);
  }

  let walletAddress: string | null = null;
  const isEmail = input.includes("@");

  if (isEmail) {
    console.log(`\n📧 Input: ${input} (email)`);

    if (!usersRegistryBlobId) {
      console.error("\n❌ Error: USERS_REGISTRY_BLOB_ID not set in .env");
      console.error(
        "   Cannot look up wallet address from email without this.",
      );
      console.log("\n💡 Tip: Use the wallet address directly instead:");
      console.log("   ts-node check-waitlist-claim.ts 0x<WALLET_ADDRESS>");
      process.exit(1);
    }

    console.log("\n🔎 Looking up wallet address from email...");

    try {
      const userManager = new WalrusUserManager();
      walletAddress = await userManager.findWalletByEmail(
        usersRegistryBlobId,
        input,
      );

      if (!walletAddress) {
        console.log("\n❌ Email not found in user registry");
        console.log("   Possible reasons:");
        console.log("   1. User hasn't signed up yet");
        console.log("   2. User registry blob ID is incorrect");
        console.log("   3. User registry doesn't exist yet");
        console.log("\n💡 If you know the wallet address, use it directly:");
        console.log("   ts-node check-waitlist-claim.ts 0x<WALLET_ADDRESS>");
        process.exit(0);
      }

      console.log(`✅ Found wallet: ${walletAddress}`);
    } catch (error: any) {
      console.error("\n❌ Error looking up wallet:", error.message || error);
      console.log("\n   Possible reasons:");
      console.log("   1. USERS_REGISTRY_BLOB_ID is invalid or doesn't exist");
      console.log("   2. Walrus network issue");
      console.log("   3. User registry blob hasn't been created yet");
      console.log("\n💡 If you know the wallet address, use it directly:");
      console.log("   ts-node check-waitlist-claim.ts 0x<WALLET_ADDRESS>");
      process.exit(1);
    }
  } else {
    // Input is a wallet address
    if (!input.startsWith("0x") || input.length !== 66) {
      console.error(
        "\n❌ Error: Invalid Sui address format. Must start with 0x and be 66 characters long.",
      );
      process.exit(1);
    }
    walletAddress = input;
    console.log(`\n💼 Input: ${walletAddress} (wallet address)`);
  }

  if (!walletAddress) {
    console.error("\n❌ Could not determine wallet address");
    process.exit(1);
  }

  console.log("\n📊 Checking claim status...\n");

  const { hasClaimed, balance } = await checkClaimStatus(
    client,
    packageId,
    pointsRegistryId,
    walletAddress,
  );

  console.log("=".repeat(60));
  console.log("\n📋 CLAIM STATUS REPORT\n");
  console.log("=".repeat(60));

  if (isEmail) {
    console.log(`📧 Email:          ${input}`);
  }
  console.log(`💼 Wallet:         ${walletAddress}`);
  console.log(`🎁 Claimed:        ${hasClaimed ? "✅ YES" : "❌ NO"}`);
  console.log(`💰 Current Points: ${balance}`);

  console.log("\n" + "=".repeat(60));

  if (!hasClaimed) {
    console.log("\n💡 This user has NOT claimed their waitlist points yet.");
    console.log("   You can award them points using:");
    console.log(
      `   ts-node sponsor-waitlist-claim.ts ${walletAddress} --confirm`,
    );
  } else {
    console.log("\n✅ This user has already claimed their waitlist points.");
    if (balance >= 100) {
      console.log("   Their current balance includes the 100 waitlist bonus.");
    } else {
      console.log(
        "   Note: Balance is less than 100, points may have been spent.",
      );
    }
  }

  console.log();
}

main();
