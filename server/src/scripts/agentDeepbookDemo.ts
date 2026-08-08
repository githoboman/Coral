/**
 * Standalone DeepBook bring-up + demo for the agent wallet — runs directly against
 * testnet with the agent key, no Express/Supabase/auth needed.
 *
 * Steps:
 *   1. Load agent keypair from AGENT_DEMO_KEY (suiprivkey...).
 *   2. Inspect the registered testnet SUI_DBUSDC pool (proves real liquidity).
 *   3. Create + share the agent's BalanceManager (one-time bootstrap).
 *
 * Usage (PowerShell):
 *   $env:AGENT_DEMO_KEY="suiprivkey..."; npx tsx src/scripts/agentDeepbookDemo.ts
 */
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";

const POOL_KEY = "SUI_DBUSDC";
const MANAGER_KEY = "AGENT_MANAGER";

async function main() {
  const pk = process.env.AGENT_DEMO_KEY;
  if (!pk) throw new Error("Set AGENT_DEMO_KEY to the agent's suiprivkey...");

  const { secretKey } = decodeSuiPrivateKey(pk);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const address = keypair.toSuiAddress();
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });

  console.log("Agent address:", address);
  const bal = await client.getBalance({ owner: address });
  console.log("Agent SUI balance:", Number(bal.totalBalance) / 1e9, "SUI");

  const db = new DeepBookClient({ client: client as any, address, env: "testnet" });

  // 1. Inspect the real testnet pool.
  console.log(`\n— Inspecting pool ${POOL_KEY} —`);
  try {
    const params = await db.poolBookParams(POOL_KEY);
    console.log("Pool params (tick/lot/min):", params);
  } catch (e: any) {
    console.log("poolBookParams failed:", e?.message);
  }
  try {
    const mid = await db.midPrice(POOL_KEY);
    console.log("Mid price (SUI in DBUSDC):", mid);
  } catch (e: any) {
    console.log("midPrice failed (book may be empty):", e?.message);
  }

  // 2. Bootstrap BalanceManager.
  console.log("\n— Creating BalanceManager —");
  const tx = new Transaction();
  db.balanceManager.createAndShareBalanceManager()(tx);
  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error("BalanceManager creation failed: " + res.effects?.status?.error);
  }
  const created = (res.objectChanges ?? []).find(
    (c: any) => c.type === "created" && /::balance_manager::BalanceManager$/.test(c.objectType ?? ""),
  ) as any;
  console.log("BalanceManager id:", created?.objectId);
  console.log("Digest:", res.digest);

  console.log("\nDone. Save this for the swap step:");
  console.log(JSON.stringify({ agentAddress: address, balanceManagerId: created?.objectId, poolKey: POOL_KEY }, null, 2));
}

main().catch((e) => {
  console.error("DEMO FAILED:", e);
  process.exit(1);
});
