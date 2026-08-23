/**
 * T-008 acceptance on Base Sepolia: fresh account → compose the worked-example
 * policy (spec §4.3, Sepolia addresses) → owner-signed first userOp deploys the
 * account + installs the session + journals it → own-relayer submission →
 * post-install read-back verification → ACTIVE (or PAUSED_MISMATCH).
 *
 * TESTNET ONLY. The dev EOA plays both owner and relayer; the agent session
 * signer is a throwaway key generated here (address printed, key discarded —
 * the agent cannot act yet anyway; that is the pipeline epic).
 *
 * Usage: EVM_RPC_URL=... EVM_DEPLOYER_PRIVATE_KEY=0x... [EVM_SALT_NONCE=1]
 *        npx tsx src/scripts/evmInstallSession.ts
 */
import { createPublicClient, createWalletClient, http, keccak256, parseEther, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { parsePolicy } from "@corral/core";

import { createCorralAccount } from "../services/evm/account.js";
import { BASE_SEPOLIA, assertPinnedCodehashes } from "../services/evm/addresses.js";
import { composeSession } from "../services/evm/session/compose.js";
import { installSession } from "../services/evm/session/install.js";

const rpc = process.env.EVM_RPC_URL;
const pk = process.env.EVM_DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!rpc || !pk) throw new Error("EVM_RPC_URL and EVM_DEPLOYER_PRIVATE_KEY are required");

// Base Sepolia venue/asset addresses for the worked example.
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER_02 = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

const owner = privateKeyToAccount(pk);
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const relayer = createWalletClient({ account: owner, chain: baseSepolia, transport: http(rpc) });
const saltNonce = BigInt(process.env.EVM_SALT_NONCE ?? "1");

console.log("[1/6] pinned codehashes…");
await assertPinnedCodehashes(client, BASE_SEPOLIA);

const account = await createCorralAccount({ client, owner, saltNonce });
console.log(`[2/6] account (owner ${owner.address}, salt ${saltNonce}): ${account.address} deployed=${await account.isDeployed()}`);

const agentSigner = privateKeyToAccount(generatePrivateKey()).address; // throwaway; key discarded
const now = Math.floor(Date.now() / 1000);
const policy = parsePolicy({
  version: 1,
  chain_id: 84532,
  asset_scope: [{ symbol: "USDC", address: USDC }],
  budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "500000000" }],
  max_native_value: "0",
  target_scope: [
    {
      address: USDC,
      selector: "0x095ea7b3",
      action: "APPROVE",
      param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
        { rule: "LTE", param_index: 1, max: "125000000" },
      ],
    },
    {
      address: SWAP_ROUTER_02,
      selector: "0x04e45aaf",
      action: "SWAP",
      param_rules: [
        { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
        { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
        { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 3000 }] },
        { rule: "EQ_ACCOUNT", param_index: 3 },
        { rule: "LTE", param_index: 4, max: "125000000" },
      ],
    },
  ],
  action_scope: ["APPROVE", "SWAP"],
  valid_after: now - 60,
  valid_until: now + 30 * 24 * 3600,
  max_executions: 8,
  max_executions_per_24h: 2,
  min_output_bps: 9800,
});
const composed = composeSession({
  policy,
  account: account.address,
  agentSigner,
  addresses: BASE_SEPOLIA,
  salt: keccak256(stringToHex(`corral.dev.session.${saltNonce}`)),
});
console.log(`[3/6] composed: permissionId ${composed.permissionId}, ${composed.session.actions.length} actions, agent signer ${agentSigner}`);

// The account pays its own EntryPoint gas (no paymaster yet): prefund it.
const bal = await client.getBalance({ address: account.address });
if (bal < parseEther("0.003")) {
  const h = await relayer.sendTransaction({ to: account.address, value: parseEther("0.005") });
  await client.waitForTransactionReceipt({ hash: h });
  console.log(`[4/6] prefunded account with 0.005 ETH (tx ${h})`);
} else {
  console.log(`[4/6] account already funded (${bal} wei)`);
}

console.log("[5/6] owner-signed first userOp → own relayer handleOps…");
const result = await installSession({ client, account, composed, addresses: BASE_SEPOLIA, relayer });
if (result.submission) {
  console.log(`      tx ${result.submission.txHash} block ${result.submission.blockNumber} tx=${result.submission.txSuccess} op=${result.submission.opSuccess} revert=${result.submission.opRevertReason ?? "-"} gas ${result.submission.gasUsed}`);
}
if (result.error) console.log(`      error: ${result.error.slice(0, 600)}`);

console.log(`[6/6] post-install verification → ${result.status}`);
if (result.verification && !result.verification.ok) {
  for (const m of result.verification.mismatches) console.log(`      MISMATCH ${m.what}: expected ${m.expected} got ${m.actual}`);
}
if (result.status !== "ACTIVE") process.exit(1);
