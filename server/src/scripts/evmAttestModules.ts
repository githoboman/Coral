/**
 * TESTNET ONLY (T-008): self-attest the pinned SmartSessions validator in the
 * ERC-7484 registry from the dev key, so accounts that trust the dev key as
 * attester (addresses.ts registryGating) can install it.
 *
 * Why: on Base Sepolia neither Rhinestone's attester nor its mock attester
 * has attested SmartSessions/V2 policies (verified 2026-08-23), while the
 * Safe7579 launchpad requires a non-empty trusted-attester set. This mirrors
 * mainnet's real mechanism (Rhinestone attests) with our key in the attester
 * role, attesting exactly the addresses we codehash-pin. Never run on
 * mainnet: there the trusted attester is Rhinestone's.
 *
 * Usage: EVM_RPC_URL=... EVM_DEPLOYER_PRIVATE_KEY=0x... npx tsx src/scripts/evmAttestModules.ts
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { registryAbi } from "../services/evm/abi/registry.js";
import { BASE_SEPOLIA } from "../services/evm/addresses.js";

const rpc = process.env.EVM_RPC_URL;
const pk = process.env.EVM_DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!rpc || !pk) throw new Error("EVM_RPC_URL and EVM_DEPLOYER_PRIVATE_KEY are required");
if (BASE_SEPOLIA.chainId !== 84532) throw new Error("testnet only");

/** Rhinestone's module schema on Base Sepolia (read from their OwnableValidator attestation). */
const SCHEMA_UID = "0x93d46fcca4ef7d66a413c7bde08bb1ff14bacbd04c4069bb24cd7c21729d7bf1" as const;
const MODULE_TYPE_VALIDATOR = 1n;
const MODULE_TYPE_STATELESS_VALIDATOR = 7n;

const attester = privateKeyToAccount(pk);
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: attester, chain: baseSepolia, transport: http(rpc) });
const registry = BASE_SEPOLIA.registry.address;
const targets = [{ name: "SmartSessions", address: BASE_SEPOLIA.smartSessions.address, types: [MODULE_TYPE_VALIDATOR, MODULE_TYPE_STATELESS_VALIDATOR] }];

for (const t of targets) {
  const existing = await client.readContract({ address: registry, abi: registryAbi, functionName: "findAttestation", args: [t.address, attester.address] });
  if (existing.time !== 0 && existing.revocationTime === 0) {
    console.log(`${t.name}: already attested by ${attester.address} at ${existing.time}`);
    continue;
  }
  const hash = await wallet.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "attest",
    args: [SCHEMA_UID, { moduleAddress: t.address, expirationTime: 0, data: "0x", moduleTypes: t.types }],
  });
  const r = await client.waitForTransactionReceipt({ hash });
  console.log(`${t.name}: attested in tx ${hash} block ${r.blockNumber} status ${r.status}`);
}

for (const t of targets) {
  try {
    // check() has no return value; a non-reverting eth_call is the pass signal.
    await client.call({ to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: "check", args: [t.address, MODULE_TYPE_VALIDATOR, [attester.address], 1n] }) });
    console.log(`check(${t.name}, type 1, [dev attester], 1): PASS`);
  } catch (e) {
    console.log(`check(${t.name}): FAIL ${(e as Error).message.split("\n")[0]}`);
    process.exit(1);
  }
}
