
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

async function discover() {
  const network = process.env.SUI_NETWORK || "testnet";
  const client = new SuiClient({ url: getFullnodeUrl(network as "testnet" | "mainnet") });
  const packageId = process.env.SUI_PACKAGE_ID;

  if (!packageId) { console.error("Missing SUI_PACKAGE_ID"); return; }

  const modules = ["subscriptions", "points", "tasks", "task_manager"];
  let output = "";

  for (const mod of modules) {
    try {
      const q = { MoveModule: { package: packageId, module: mod } };
      const res = await client.queryEvents({ query: q, limit: 5, order: "descending" });
      if (res.data.length > 0) {
        output += `MODULE: ${mod}\n`;
        const types = new Set(res.data.map(e => e.type));
        types.forEach(t => output += `  TYPE: ${t}\n`);
      }
    } catch (e) {
      output += `MODULE: ${mod} ERROR: ${(e as Error).message}\n`;
    }
  }

  fs.writeFileSync("events_list.txt", output);
  console.log("Done.");
}

discover();
