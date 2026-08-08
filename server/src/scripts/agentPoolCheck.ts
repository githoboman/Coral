/**
 * Quick read-only check that the DeepBook SDK read helpers work under the pinned
 * sui v1.45 + deepbook-v3 0.23 pair. No signing, no gas.
 *   npx tsx src/scripts/agentPoolCheck.ts
 */
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { DeepBookClient } from "@mysten/deepbook-v3";

const POOL_KEY = "SUI_DBUSDC";
const AGENT = "0x120aa8cccbd6bf3f14b55bb8090912b74fdde02eea885b29f9c955e4db8a91f1";

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });
  const db = new DeepBookClient({ client: client as any, address: AGENT, env: "testnet" });

  console.log(`Pool: ${POOL_KEY}`);
  try {
    const mid = await db.midPrice(POOL_KEY);
    console.log("Mid price (DBUSDC per SUI):", mid);
  } catch (e: any) {
    console.log("midPrice error:", e?.message);
  }
  try {
    const out = await db.getQuoteQuantityOut(POOL_KEY, 1);
    console.log("Quote out for 1 SUI:", out);
  } catch (e: any) {
    console.log("getQuoteQuantityOut error:", e?.message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
