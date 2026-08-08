
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import * as dotenv from "dotenv";

dotenv.config();

async function inspect() {
  const network = process.env.SUI_NETWORK || "testnet";
  const client = new SuiClient({ url: getFullnodeUrl(network as "testnet" | "mainnet") });
  const packageId = process.env.SUI_PACKAGE_ID;

  if (!packageId) { console.error("Missing SUI_PACKAGE_ID"); return; }

  const q = { MoveModule: { package: packageId, module: "subscriptions" } };

  try {
    const res = await client.queryEvents({ query: q, limit: 5, order: "descending" });
    const premiumEvent = res.data.find(e => e.type.includes("::PremiumSubscribed"));

    if (premiumEvent) {
      const json = premiumEvent.parsedJson as any;
      console.log("KEYS: " + Object.keys(json).join("|"));
    } else {
      console.log("No events");
    }
  } catch (e) {
    console.error(e);
  }
}

inspect();
