import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import "dotenv/config";

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

async function main() {
  console.log("🔍 Address Format Debug Tool\n");
  console.log("=".repeat(60));

  const walletAddress = process.argv[2];

  if (!walletAddress) {
    console.error("❌ Wallet address required");
    console.log("\nUsage: npx tsx scripts/debug-address.ts <WALLET_ADDRESS>");
    process.exit(1);
  }

  const network = process.env.SUI_NETWORK || "testnet";
  const packageId = process.env.SUI_PACKAGE_ID;
  const pointsRegistryId = process.env.SUI_POINTS_REGISTRY_ID;

  if (!packageId || !pointsRegistryId) {
    console.error("❌ Missing env vars");
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  console.log("\n📋 ADDRESS FORMATS:");
  console.log("=".repeat(60));
  console.log(`Original input:     ${walletAddress}`);
  console.log(`Normalized:         ${normalizeAddress(walletAddress)}`);
  console.log(`Move format:        ${toMoveAddressFormat(walletAddress)}`);

  const normalized = normalizeAddress(walletAddress);
  const moveAddr = toMoveAddressFormat(walletAddress);

  console.log("\n🔍 CHECKING ON-CHAIN DATA:");
  console.log("=".repeat(60));

  // Try with Move format
  console.log("\n1️⃣ Using Move format address:");
  try {
    const tx1 = new Transaction();
    tx1.moveCall({
      target: `${packageId}::points::has_claimed`,
      arguments: [tx1.object(pointsRegistryId), tx1.pure.string(moveAddr)],
    });

    const result1 = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: tx1,
    });

    if (result1.results?.[0]?.returnValues?.[0]) {
      const [bytes] = result1.results[0].returnValues[0];
      console.log(`   has_claimed: ${bytes[0] === 1}`);
    } else {
      console.log(`   ❌ No result`);
    }
  } catch (err: any) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // Try with normalized format
  console.log("\n2️⃣ Using normalized address:");
  try {
    const tx2 = new Transaction();
    tx2.moveCall({
      target: `${packageId}::points::has_claimed`,
      arguments: [tx2.object(pointsRegistryId), tx2.pure.string(normalized)],
    });

    const result2 = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: tx2,
    });

    if (result2.results?.[0]?.returnValues?.[0]) {
      const [bytes] = result2.results[0].returnValues[0];
      console.log(`   has_claimed: ${bytes[0] === 1}`);
    } else {
      console.log(`   ❌ No result`);
    }
  } catch (err: any) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // Check balance with Move format
  console.log("\n3️⃣ Balance with Move format:");
  try {
    const tx3 = new Transaction();
    tx3.moveCall({
      target: `${packageId}::points::get_balance`,
      arguments: [tx3.object(pointsRegistryId), tx3.pure.string(moveAddr)],
    });

    const result3 = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: tx3,
    });

    if (result3.results?.[0]?.returnValues?.[0]) {
      const [bytes] = result3.results[0].returnValues[0];
      const view = new DataView(new Uint8Array(bytes).buffer);
      const balance = Number(view.getBigUint64(0, true));
      console.log(`   balance: ${balance} points`);
    } else {
      console.log(`   ❌ No result`);
    }
  } catch (err: any) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // Search for PointsClaimed events
  console.log("\n4️⃣ Searching for PointsClaimed events:");
  try {
    const events = await client.queryEvents({
      query: {
        MoveEventType: `${packageId}::points::PointsClaimed`,
      },
      limit: 100,
      order: "descending",
    });

    console.log(`   Found ${events.data.length} total claim events`);

    let found = false;
    for (const ev of events.data) {
      const data = ev.parsedJson as any;
      const eventAddr = data.wallet_address;

      // Try different comparisons
      if (
        eventAddr === walletAddress ||
        eventAddr === normalized ||
        eventAddr === moveAddr ||
        normalizeAddress(eventAddr) === normalized
      ) {
        found = true;
        console.log(`   ✅ FOUND claim event!`);
        console.log(`      Event address: ${eventAddr}`);
        console.log(`      Amount: ${data.amount}`);
        console.log(`      New balance: ${data.new_balance}`);
        console.log(`      Reason: ${data.reason}`);
        console.log(`      Timestamp: ${data.timestamp}`);
        break;
      }
    }

    if (!found) {
      console.log(`   ❌ No claim event found in last 100 events`);
      console.log(`\n   Sample event addresses (first 5):`);
      for (let i = 0; i < Math.min(5, events.data.length); i++) {
        const data = events.data[i].parsedJson as any;
        console.log(`   ${i + 1}. ${data.wallet_address}`);
      }
    }
  } catch (err: any) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  console.log("\n" + "=".repeat(60));
}

main();
