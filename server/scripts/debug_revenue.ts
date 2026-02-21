
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import * as dotenv from "dotenv";

dotenv.config();

async function debugEvents() {
  const network = process.env.SUI_NETWORK || "testnet";
  const client = new SuiClient({ url: getFullnodeUrl(network as "testnet" | "mainnet") });
  const packageId = process.env.SUI_PACKAGE_ID;

  if (!packageId) { console.error("Missing SUI_PACKAGE_ID"); return; }

  // Hypothesis: The event name is 'Subscribed'
  const subType = `${packageId}::subscriptions::Subscribed`;

  console.log(`TYPE_TEST: ${subType}`);

  try {
    const subs = await client.queryEvents({ query: { MoveEventType: subType }, limit: 5, order: "descending" });
    console.log(`COUNT: ${subs.data.length}`);
    if (subs.data.length > 0) {
      console.log(`SUCCESS! Found event: ${subs.data[0].type}`);
      console.log(`DATA: ${JSON.stringify(subs.data[0].parsedJson)}`);
    } else {
      console.log("No Subscribed events found.");
    }
  } catch (e) {
    console.log(`ERROR: ${(e as Error).message}`);
  }
}

debugEvents();
