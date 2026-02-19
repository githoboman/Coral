
import { getTicketMinter } from "../services/ticketMinter";
import "dotenv/config";

async function debugCheckin() {
  const minter = getTicketMinter();
  // specific address that we know exists or random one
  // Using a likely valid address or a random one to test read-only functions
  const TEST_ADDR = "0x78ab5ce8374e6f470557262145b2520a3203027b68991a0ae74198d5c219602a";

  console.log(`\n--- DEBUGGING CHECK-IN FOR ${TEST_ADDR.substring(0, 8)}... ---`);

  // 1. Check getLastCheckin (Uses string)
  try {
    console.log("1. Testing getLastCheckin (expecting String arg)...");
    const lastCheckin = await minter.getLastCheckin(TEST_ADDR);
    console.log(`✅ getLastCheckin result: ${lastCheckin}`);
  } catch (e) {
    console.error("❌ getLastCheckin failed:", e);
  }
  await new Promise(r => setTimeout(r, 1000));

  // 2. Check hasClaimed (Uses Address arg)
  try {
    console.log("\n2. Testing hasClaimed (expecting Address arg)...");
    const claimed = await minter.hasClaimed(TEST_ADDR);
    console.log(`✅ hasClaimed result: ${claimed}`);
  } catch (e) {
    console.error("❌ hasClaimed failed:", e);
  }
  await new Promise(r => setTimeout(r, 1000));

  // 3. Check getBalance (Uses Address arg)
  try {
    console.log("\n3. Testing getBalance (expecting Address arg)...");
    const balance = await minter.getBalance(TEST_ADDR);
    console.log(`✅ getBalance result: ${balance}`);
  } catch (e) {
    console.error("❌ getBalance failed:", e);
  }
  await new Promise(r => setTimeout(r, 1000));

  // 4. Check getCurrentStreak (Uses string arg)
  try {
    console.log("\n4. Testing getCurrentStreak (expecting String arg)...");
    const streak = await minter.getCurrentStreak(TEST_ADDR);
    console.log(`✅ getCurrentStreak result: ${streak}`);
  } catch (e) {
    console.error("❌ getCurrentStreak failed:", e);
  }
}

debugCheckin().catch(console.error);
