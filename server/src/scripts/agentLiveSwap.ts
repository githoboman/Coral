/**
 * Live agent trade on the real testnet SUI_DBUSDC pool:
 *   1. Deposit SUI into the agent's BalanceManager.
 *   2. Place a market order selling SUI for DBUSDC.
 *   3. Print the digest + balance changes.
 *
 *   $env:AGENT_DEMO_KEY="suiprivkey..."; npx tsx src/scripts/agentLiveSwap.ts
 */
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";

const POOL_KEY = "SUI_DBUSDC";
const MANAGER_KEY = "AGENT_MANAGER";
const BALANCE_MANAGER_ID = "0xb79410bd70cc766ae137e1e74db412934d4a13678b8b6c67115d26814451ad93";
// Pool minSize=1 SUI, lotSize=0.1. Sell 1.0 SUI (manager already holds 0.5 from the
// prior deposit; top up by 0.6 to comfortably cover 1.0 + fees).
const SELL_SUI = 1.0;
const TOP_UP_SUI = 0.6;

async function main() {
  const pk = process.env.AGENT_DEMO_KEY;
  if (!pk) throw new Error("Set AGENT_DEMO_KEY");
  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(pk).secretKey);
  const address = keypair.toSuiAddress();
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });

  const db = new DeepBookClient({
    client: client as any,
    address,
    env: "testnet",
    balanceManagers: { [MANAGER_KEY]: { address: BALANCE_MANAGER_ID } },
  });

  // 1. Top up the manager so it holds >= SELL_SUI.
  console.log(`Depositing ${TOP_UP_SUI} SUI into BalanceManager...`);
  const depTx = new Transaction();
  db.balanceManager.depositIntoManager(MANAGER_KEY, "SUI", TOP_UP_SUI)(depTx);
  const dep = await client.signAndExecuteTransaction({
    signer: keypair, transaction: depTx, options: { showEffects: true },
  });
  if (dep.effects?.status?.status !== "success") {
    throw new Error("Deposit failed: " + dep.effects?.status?.error);
  }
  console.log("Deposit digest:", dep.digest);

  // 2. Market order: sell SUI (base) for DBUSDC (quote) -> isBid=false.
  console.log(`\nPlacing market order: sell ${SELL_SUI} SUI -> DBUSDC...`);
  const tx = new Transaction();
  db.deepBook.placeMarketOrder({
    poolKey: POOL_KEY,
    balanceManagerKey: MANAGER_KEY,
    clientOrderId: String(Date.now()),
    quantity: SELL_SUI,
    isBid: false,
    payWithDeep: false, // pay fees from the traded coin, no DEEP needed
  })(tx);

  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showBalanceChanges: true, showEvents: true },
  });

  console.log("\nStatus:", res.effects?.status?.status);
  if (res.effects?.status?.status !== "success") {
    console.log("Error:", res.effects?.status?.error);
    process.exit(1);
  }
  console.log("Swap digest:", res.digest);
  console.log("Balance changes:", JSON.stringify(res.balanceChanges, null, 2));
  console.log(`\nExplorer: https://testnet.suivision.xyz/txblock/${res.digest}`);
}

main().catch((e) => { console.error("SWAP FAILED:", e); process.exit(1); });
