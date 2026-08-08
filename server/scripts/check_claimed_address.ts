import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";
import * as fs from "fs/promises";

interface PointsRecord {
  wallet_address: string;
  balance: string;
  waitlist_claimed: boolean;
  claimed_at: string;
  last_checkin_at: string;
  current_streak: string;
  last_checkin_date: string;
  total_checkins: string;
}

interface ClaimedAddress {
  wallet_address: string;
  balance: number;
  waitlist_claimed: boolean;
  claimed_at: number;
}

async function main() {
  console.log("🔍 Checking All Claimed Waitlist Points\n");
  console.log("=".repeat(70));

  const network = process.env.SUI_NETWORK || "testnet";
  const pointsRegistryId = process.env.SUI_POINTS_REGISTRY_ID;
  const packageId = process.env.SUI_PACKAGE_ID;

  if (!pointsRegistryId || !packageId) {
    console.error("❌ Missing environment variables:");
    console.error("   - SUI_POINTS_REGISTRY_ID");
    console.error("   - SUI_PACKAGE_ID");
    process.exit(1);
  }

  const client = new SuiClient({
    url: getFullnodeUrl(network as "testnet" | "mainnet"),
  });

  console.log(`\n📊 Querying Points Registry: ${pointsRegistryId}`);
  console.log(`   Network: ${network}`);
  console.log(`   Package: ${packageId}\n`);

  try {
    // Fetch the PointsRegistry object to get all records
    const registryObject = await client.getObject({
      id: pointsRegistryId,
      options: {
        showContent: true,
      },
    });

    if (
      !registryObject.data?.content ||
      registryObject.data.content.dataType !== "moveObject"
    ) {
      console.error("❌ Could not fetch registry object");
      process.exit(1);
    }

    const fields = registryObject.data.content.fields as any;

    console.log(`✅ Registry fetched successfully`);
    console.log(`   Total Supply: ${fields.total_supply} points`);

    // The records are stored in a Table, we need to fetch events or query differently
    console.log(`\n🔍 Querying PointsClaimed events...\n`);

    // Query all PointsClaimed events
    let hasNextPage = true;
    let cursor: string | null = null;
    const claimedAddresses: Map<string, ClaimedAddress> = new Map();

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

        const walletAddress = parsedJson.wallet_address;
        const reason = parsedJson.reason;
        const amount = parseInt(parsedJson.amount);
        const timestamp = parseInt(parsedJson.timestamp);

        // Track waitlist claims specifically
        if (reason === "Waitlist Bonus") {
          if (!claimedAddresses.has(walletAddress)) {
            claimedAddresses.set(walletAddress, {
              wallet_address: walletAddress,
              balance: parseInt(parsedJson.new_balance),
              waitlist_claimed: true,
              claimed_at: timestamp,
            });
          }
        }
      }

      hasNextPage = events.hasNextPage;
      cursor = events.nextCursor ?? null;

      if (hasNextPage) {
        console.log(`   Fetched ${events.data.length} events, continuing...`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(
      `✅ FOUND ${claimedAddresses.size} ADDRESSES WITH WAITLIST CLAIMS`,
    );
    console.log("=".repeat(70) + "\n");

    if (claimedAddresses.size === 0) {
      console.log("ℹ️  No waitlist claims found yet.\n");
    } else {
      // Sort by claimed_at (earliest first)
      const sortedAddresses = Array.from(claimedAddresses.values()).sort(
        (a, b) => a.claimed_at - b.claimed_at,
      );

      console.log("📋 Claimed Addresses (chronological order):\n");
      sortedAddresses.forEach((record, index) => {
        const date = new Date(record.claimed_at).toISOString();
        console.log(`${index + 1}. ${record.wallet_address}`);
        console.log(`   Balance: ${record.balance} points`);
        console.log(`   Claimed: ${date}`);
        console.log();
      });

      // Save to file
      const outputPath = "./claimed-addresses.json";
      await fs.writeFile(
        outputPath,
        JSON.stringify(
          {
            total_claimed: claimedAddresses.size,
            network,
            registry_id: pointsRegistryId,
            package_id: packageId,
            queried_at: new Date().toISOString(),
            addresses: sortedAddresses,
          },
          null,
          2,
        ),
      );

      console.log("=".repeat(70));
      console.log(`\n💾 Saved to: ${outputPath}`);
    }

    // Check specific address if provided
    const checkAddress = process.argv[2];
    if (checkAddress) {
      console.log("\n" + "=".repeat(70));
      console.log(`🔎 Checking specific address: ${checkAddress}\n`);

      const hasClaimed = claimedAddresses.has(checkAddress);

      if (hasClaimed) {
        const record = claimedAddresses.get(checkAddress)!;
        console.log("❌ THIS ADDRESS HAS ALREADY CLAIMED");
        console.log(`   Balance: ${record.balance} points`);
        console.log(`   Claimed: ${new Date(record.claimed_at).toISOString()}`);
      } else {
        console.log("✅ THIS ADDRESS HAS NOT CLAIMED YET");
        console.log("   Safe to sponsor claim");
      }
      console.log();
    }
  } catch (error: any) {
    console.error("\n❌ Error querying blockchain:", error.message || error);
    process.exit(1);
  }
}

main();
