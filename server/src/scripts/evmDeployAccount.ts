/**
 * T-007 acceptance script: predict, then deploy, a Corral account on Base
 * Sepolia from an owner key, and prove the deployed address equals the
 * counterfactual one (FR-1.1). TESTNET ONLY — the owner here is the funded
 * dev EOA from contracts/.env; in the product the owner is the user's wallet
 * and the deploy is bundled into their first signature (FR-1.3).
 *
 * Usage: EVM_RPC_URL=... EVM_DEPLOYER_PRIVATE_KEY=0x... npx tsx src/scripts/evmDeployAccount.ts
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA, assertPinnedCodehashes } from "../services/evm/addresses.js";
import { createCorralAccount } from "../services/evm/account.js";

const rpc = process.env.EVM_RPC_URL;
const pk = process.env.EVM_DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!rpc || !pk) throw new Error("EVM_RPC_URL and EVM_DEPLOYER_PRIVATE_KEY are required");

const owner = privateKeyToAccount(pk);
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(rpc) });

console.log("[1/4] asserting pinned codehashes…");
await assertPinnedCodehashes(client, BASE_SEPOLIA);

const saltNonce = BigInt(process.env.EVM_SALT_NONCE ?? "0");
const account = await createCorralAccount({ client, owner, saltNonce });
console.log(`[2/4] counterfactual address for owner ${owner.address} (salt ${saltNonce}): ${account.address}`);

if (await account.isDeployed()) {
  console.log("[3/4] already deployed — nothing to broadcast");
} else {
  const { factory, factoryData } = await account.getFactoryArgs();
  console.log(`[3/4] deploying via factory ${factory}…`);
  const hash = await wallet.sendTransaction({ to: factory, data: factoryData });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`      tx ${hash} — block ${receipt.blockNumber}, status ${receipt.status}, gas ${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error("deploy reverted");
}

// Load-balanced RPCs can serve a stale read right after a receipt (observed
// on Base Sepolia 2026-08-22): re-read with backoff before judging.
let deployed = false;
for (let attempt = 1; attempt <= 6 && !deployed; attempt++) {
  deployed = await account.isDeployed();
  if (!deployed) await new Promise((r) => setTimeout(r, 1000 * attempt));
}
console.log(`[4/4] bytecode at counterfactual address: ${deployed ? "YES — FR-1.1 holds" : "NO — FR-1.1 VIOLATED"}`);
if (!deployed) process.exit(1);
