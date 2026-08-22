/**
 * T-007 integration test: every pinned address on Base Sepolia still holds
 * the exact bytecode we pinned. Needs EVM_RPC_URL; skipped (loudly) without
 * it so unit runs stay offline. CI sets it. A failure here is a security
 * event (unreviewed redeploy / proxy upgrade at a pinned address), not a
 * flaky test — do not re-pin without reviewing the new code.
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA, checkPinnedCodehashes } from "../addresses.js";

const RPC = process.env.EVM_RPC_URL;

describe.skipIf(!RPC)("pinned codehashes on Base Sepolia (EVM_RPC_URL)", () => {
  it("every pinned contract matches its codehash", async () => {
    const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
    const mismatches = await checkPinnedCodehashes(client, BASE_SEPOLIA);
    expect(mismatches, JSON.stringify(mismatches, null, 2)).toStrictEqual([]);
  }, 60_000);
});

if (!RPC) {
  // eslint-disable-next-line no-console
  console.warn("[evm] EVM_RPC_URL not set — pinned-codehash integration test skipped");
}
