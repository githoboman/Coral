import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

function suiToMist(sui: number): number {
  return Math.floor(sui * 1_000_000_000);
}

function mistToSui(mist: number): string {
  return (mist / 1_000_000_000).toFixed(4);
}

async function getTreasuryBalance(
  client: SuiClient,
  packageId: string,
  registryId: string,
): Promise<number> {
  const tx = new Transaction();

  tx.moveCall({
    target: `${packageId}::subscriptions::get_treasury_balance`,
    arguments: [tx.object(registryId)],
  });

  const result = await client.devInspectTransactionBlock({
    sender:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    transactionBlock: tx,
  });

  if (result.results?.[0]?.returnValues?.[0]) {
    const [bytes] = result.results[0].returnValues[0];
    const view = new DataView(new Uint8Array(bytes).buffer);
    return Number(view.getBigUint64(0, true));
  }

  return 0;
}

async function main() {
  console.log("💸 Treasury Withdrawal\n");
  console.log("=".repeat(60));

  const network = process.env.SUI_NETWORK || "testnet";
  const privateKey = process.env.WALRUS_PRIVATE_KEY;
  const adminCapId =
    process.env.SUI_SUBSCRIPTION_ADMIN_CAP_ID || process.env.SUI_ADMIN_CAP_ID;
  const subscriptionRegistryId = process.env.SUI_SUBSCRIPTION_REGISTRY_ID;
  const subscriptionPackageId =
    process.env.SUI_SUBSCRIPTION_PACKAGE_ID || process.env.SUI_PACKAGE_ID;

  if (!privateKey) {
    console.error("❌ Error: WALRUS_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  if (!adminCapId) {
    console.error(
      "❌ Error: SUI_SUBSCRIPTION_ADMIN_CAP_ID or SUI_ADMIN_CAP_ID not set in .env",
    );
    process.exit(1);
  }

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
  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const adminAddress = keypair.toSuiAddress();

  console.log(`\n🔑 Admin Address: ${adminAddress}`);

  console.log("\n📊 Fetching current treasury balance...");
  const currentBalanceMist = await getTreasuryBalance(
    client,
    subscriptionPackageId,
    subscriptionRegistryId,
  );
  const currentBalanceSui = mistToSui(currentBalanceMist);

  console.log(`\n💰 Current Treasury Balance: ${currentBalanceSui} SUI`);
  console.log(`   (${currentBalanceMist.toLocaleString()} MIST)`);

  if (currentBalanceMist === 0) {
    console.log("\n⚠️  Treasury is empty. Nothing to withdraw.");
    process.exit(0);
  }

  const amountArg = process.argv[2];

  if (!amountArg) {
    console.error("\n❌ Error: Amount required");
    console.log("\nUsage:");
    console.log("  ts-node withdraw-treasury.ts <AMOUNT_IN_SUI>");
    console.log("  ts-node withdraw-treasury.ts all");
    console.log("\nExamples:");
    console.log("  ts-node withdraw-treasury.ts 1.5      # Withdraw 1.5 SUI");
    console.log("  ts-node withdraw-treasury.ts all      # Withdraw all funds");
    process.exit(1);
  }

  let withdrawAmountMist: number;
  let withdrawAmountSui: string;
  let isWithdrawAll: boolean = false;

  if (amountArg.toLowerCase() === "all") {
    withdrawAmountMist = currentBalanceMist;
    withdrawAmountSui = currentBalanceSui;
    isWithdrawAll = true;
  } else {
    const amountSui = parseFloat(amountArg);

    if (isNaN(amountSui) || amountSui <= 0) {
      console.error("\n❌ Error: Invalid amount");
      process.exit(1);
    }

    withdrawAmountMist = suiToMist(amountSui);
    withdrawAmountSui = mistToSui(withdrawAmountMist);

    if (withdrawAmountMist > currentBalanceMist) {
      console.error("\n❌ Error: Insufficient treasury balance");
      console.log(`   Requested: ${withdrawAmountSui} SUI`);
      console.log(`   Available: ${currentBalanceSui} SUI`);
      process.exit(1);
    }
  }

  console.log(`\n💸 Withdrawal Amount: ${withdrawAmountSui} SUI`);
  console.log(`   (${withdrawAmountMist.toLocaleString()} MIST)`);

  const remainingMist = currentBalanceMist - withdrawAmountMist;
  const remainingSui = mistToSui(remainingMist);

  console.log(`\n📉 Remaining After Withdrawal: ${remainingSui} SUI`);
  console.log(`   (${remainingMist.toLocaleString()} MIST)`);

  if (process.argv[3] !== "--confirm") {
    console.log("\n⚠️  WARNING: This will withdraw funds from the treasury!");
    console.log(
      `   Amount: ${withdrawAmountSui} SUI will be sent to ${adminAddress}`,
    );
    console.log("\nTo proceed, run:");
    console.log(`  ts-node withdraw-treasury.ts ${amountArg} --confirm\n`);
    process.exit(0);
  }

  try {
    console.log("\n🔄 Processing withdrawal...\n");

    const tx = new Transaction();
    tx.setGasBudget(10_000_000);

    if (isWithdrawAll) {
      tx.moveCall({
        target: `${subscriptionPackageId}::subscriptions::withdraw_all_treasury`,
        arguments: [
          tx.object(adminCapId),
          tx.object(subscriptionRegistryId),
          tx.object("0x6"),
        ],
      });
    } else {
      tx.moveCall({
        target: `${subscriptionPackageId}::subscriptions::withdraw_treasury`,
        arguments: [
          tx.object(adminCapId),
          tx.object(subscriptionRegistryId),
          tx.pure.u64(withdrawAmountMist),
          tx.object("0x6"),
        ],
      });
    }

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    if (result.effects?.status?.status === "success") {
      console.log("✅ Withdrawal successful!\n");
      console.log(`   Transaction: ${result.digest}`);
      console.log(`   Withdrawn: ${withdrawAmountSui} SUI`);
      console.log(`   Recipient: ${adminAddress}`);

      const newBalanceMist = await getTreasuryBalance(
        client,
        subscriptionPackageId,
        subscriptionRegistryId,
      );
      const newBalanceSui = mistToSui(newBalanceMist);

      console.log(`\n💰 New Treasury Balance: ${newBalanceSui} SUI`);
      console.log(`   (${newBalanceMist.toLocaleString()} MIST)`);

      console.log("\n" + "=".repeat(60));
    } else {
      console.error("\n❌ Withdrawal failed!");
      console.error("   Status:", result.effects?.status);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("\n❌ Error during withdrawal:", error.message || error);

    if (error.message?.includes("E_NOT_ADMIN")) {
      console.error(
        "\n   Error: Not authorized. Make sure you're using the correct admin private key.",
      );
    } else if (error.message?.includes("E_INSUFFICIENT_BALANCE")) {
      console.error("\n   Error: Insufficient treasury balance.");
    }

    process.exit(1);
  }
}

main();
