/**
 * T-007: counterfactual address properties (FR-1.1). permissionless derives
 * the address by simulating the factory against the EntryPoint, so these
 * need an RPC (EVM_RPC_URL) and are skipped offline.
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createCorralAccount, predictAccountAddress } from "../account.js";
import { BASE_SEPOLIA } from "../addresses.js";

const RPC = process.env.EVM_RPC_URL;

describe.skipIf(!RPC)("Corral account (Safe7579) on Base Sepolia", () => {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

  it("address is a pure function of (owner, saltNonce)", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const a1 = await predictAccountAddress({ client, owner, saltNonce: 0n });
    const a2 = await predictAccountAddress({ client, owner, saltNonce: 0n });
    const a3 = await predictAccountAddress({ client, owner, saltNonce: 1n });
    expect(a1).toBe(a2);
    expect(a3).not.toBe(a1);
  }, 60_000);

  it("different owners get different accounts", async () => {
    const a = await predictAccountAddress({ client, owner: privateKeyToAccount(generatePrivateKey()) });
    const b = await predictAccountAddress({ client, owner: privateKeyToAccount(generatePrivateKey()) });
    expect(a).not.toBe(b);
  }, 60_000);

  it("a fresh account is undeployed, exposes pinned config, and yields factory args", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const acct = await createCorralAccount({ client, owner });
    expect(acct.chainId).toBe(84532);
    expect(acct.owner).toBe(owner.address);
    expect(acct.addresses).toBe(BASE_SEPOLIA);
    expect(await acct.isDeployed()).toBe(false);
    const { factory, factoryData } = await acct.getFactoryArgs();
    // Deployment goes through the pinned Safe proxy factory, nothing else.
    expect(factory.toLowerCase()).toBe(BASE_SEPOLIA.safeProxyFactory.address.toLowerCase());
    expect(factoryData.startsWith("0x")).toBe(true);
  }, 60_000);
});
