import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { DeepBookClient } from "@mysten/deepbook-v3";

const POOL_KEY = "SUI_DBUSDC";
const AGENT = "0x120aa8cccbd6bf3f14b55bb8090912b74fdde02eea885b29f9c955e4db8a91f1";

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });
  const db = new DeepBookClient({ client: client as any, address: AGENT, env: "testnet" });
  const params = await db.poolBookParams(POOL_KEY);
  console.log("tickSize / lotSize / minSize:", JSON.stringify(params, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
