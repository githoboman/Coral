
import { TicketMinter } from "../services/ticketMinter";
import "dotenv/config";

async function main() {
  const walletAddress = "0x8144d748a1316b2e3b871bc24f54b1b48905dcfe8451a8391197b3dbd4fbeacf";
  console.log(`Debugging Check-in for: ${walletAddress}`);

  const minter = TicketMinter.getInstance();

  console.log("\n--- Checking Last Date (Should Fail & Log Error) ---");
  try {
    const date = await minter.getLastCheckinDate(walletAddress);
    console.log(`LastCheckinDate: "${date}"`);
  } catch (e) {
    console.error("Caught error in main:", e);
  }

  console.log("\n--- Checking Streak (Should Fail & Log Error) ---");
  try {
    const streak = await minter.getCurrentStreak(walletAddress);
    console.log(`CurrentStreak: ${streak}`);
  } catch (e) {
    console.error("Caught error in main:", e);
  }
}

main().catch(console.error);
