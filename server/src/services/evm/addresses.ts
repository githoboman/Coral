/**
 * Pinned on-chain addresses and codehashes (T-007, spec §4.1, D25).
 *
 * RULES
 *  - Every address here is hand-pinned hex, never imported from an SDK
 *    constant. @rhinestone/module-sdk 0.4.0 carries two policy address sets
 *    (legacy V1 in per-policy folders, current V2 in GLOBAL_CONSTANTS); we
 *    pin V2 and a unit test asserts the SDK builders agree with these pins.
 *  - Never resolve a module address from a registry at runtime.
 *  - A codehash mismatch means the contract at that address is not the
 *    audited code we reviewed: stop, don't adapt. `assertPinnedCodehashes`
 *    is the runtime gate; CI runs it against Base Sepolia.
 *
 * Codehashes are keccak256(runtime bytecode) captured 2026-08-22 via RPC.
 */

import { keccak256, type Address, type Hex, type PublicClient } from "viem";

export interface PinnedContract {
  readonly address: Address;
  readonly codehash: Hex;
  readonly role: string;
}

export interface ChainAddresses {
  readonly chainId: number;
  readonly entryPoint: PinnedContract;
  readonly safeSingleton: PinnedContract;
  readonly safeProxyFactory: PinnedContract;
  readonly safe7579Adapter: PinnedContract;
  readonly safe7579Launchpad: PinnedContract;
  readonly registry: PinnedContract;
  readonly rhinestoneAttester: PinnedContract;
  readonly smartSessions: PinnedContract;
  readonly universalActionPolicy: PinnedContract;
  readonly spendingLimitsPolicy: PinnedContract;
  readonly timeFramePolicy: PinnedContract;
  readonly valueLimitPolicy: PinnedContract;
  readonly usageLimitPolicy: PinnedContract;
  readonly corralJournal: PinnedContract;
}

const pin = (address: Address, codehash: Hex, role: string): PinnedContract =>
  Object.freeze({ address, codehash, role });

export const BASE_SEPOLIA: ChainAddresses = Object.freeze({
  chainId: 84532,
  entryPoint: pin("0x0000000071727De22E5E9d8BAf0edAc6f37da032", "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58", "ERC-4337 EntryPoint v0.7"),
  safeSingleton: pin("0x41675C099F32341bf84BFc5382aF534df5C7461a", "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4", "Safe singleton 1.4.1"),
  safeProxyFactory: pin("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317", "Safe proxy factory 1.4.1"),
  safe7579Adapter: pin("0x7579EE8307284F293B1927136486880611F20002", "0xe03f1efc4aa74c91a87731397278a9c32d81f593263931fc94ff867aa09b83ac", "Safe7579 adapter (ERC-7579 + 4337 module)"),
  safe7579Launchpad: pin("0x7579011aB74c46090561ea277Ba79D510c6C00ff", "0xe15c7413325ecf9e9fe60a315a0c9b49ad3003f3e6c254b9fa841dff8a8a32a5", "Safe7579 launchpad (init)"),
  registry: pin("0x000000000069E2a187AEFFb852bF3cCdC95151B2", "0xe854e35a6d66f28b235af93718ffc164a03bafd057d245034f67dac391a795fd", "ERC-7484 module registry"),
  rhinestoneAttester: pin("0x000000333034E9f539ce08819E12c1b8Cb29084d", "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c", "Rhinestone attester"),
  smartSessions: pin("0x00000000008bDABA73cD9815d79069c247Eb4bDA", "0x0a31363c38106cce18a3008234d95376a9f2f8bdc67976eab1d1f5ad3cc91b79", "SmartSessions validator"),
  universalActionPolicy: pin("0x0000000000714Cf48FcF88A0bFBa70d313415032", "0xc58f13d259c69d0db90f611347535e2d5642f3352740b7d58fbf6e6b939670dd", "UniversalActionPolicy (V2)"),
  spendingLimitsPolicy: pin("0x000000000033212e272655d8a22402db819477a6", "0x9ece24bd174fd4d30b1aea219b9fb43247370bead0ec15a01afc88789891351b", "SpendingLimitsPolicy (V2)"),
  timeFramePolicy: pin("0x0000000000D30f611fA3bf652ac6879428586930", "0xa8c18f7a974673552d03d7325bbc33a102a5aaab5bc5a3c11ecae1648ca4e026", "TimeFramePolicy (V2)"),
  valueLimitPolicy: pin("0x000000000021dC45451291BCDfc9f0B46d6f0278", "0x086e8421c6c9daab4a93e63366c83e8f20cc3f736b7be5a97e0e81633581e4ed", "ValueLimitPolicy (V2)"),
  usageLimitPolicy: pin("0x00000000001d4479FA2A947026204d0283ceDe4B", "0xa85499ae68f4ac7819fa0c9a06dfb89538a820879ed356913915ea5daac62cdd", "UsageLimitPolicy (V2)"),
  corralJournal: pin("0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F", "0x518b65ef4ba1c38a724677c7d22dc38c982740057f459ed9b5ba51df56dd59ea", "CorralJournal (ours, CREATE2)"),
});

const CHAINS: Readonly<Record<number, ChainAddresses>> = Object.freeze({ 84532: BASE_SEPOLIA });

/** Adding a chain = adding a pinned table here (spec §12). Nothing else. */
export function addressesFor(chainId: number): ChainAddresses {
  const a = CHAINS[chainId];
  if (!a) throw new Error(`no pinned addresses for chain ${chainId}`);
  return a;
}

export interface CodehashMismatch {
  readonly role: string;
  readonly address: Address;
  readonly expected: Hex;
  readonly actual: Hex;
}

/**
 * Read every pinned address's bytecode and compare keccak256 against the
 * pin. Returns the mismatches (empty = all good). Callers treat a non-empty
 * result as a hard stop — never as something to reconcile automatically.
 */
export async function checkPinnedCodehashes(
  client: PublicClient,
  addresses: ChainAddresses,
): Promise<CodehashMismatch[]> {
  const mismatches: CodehashMismatch[] = [];
  const entries = Object.values(addresses).filter(
    (v): v is PinnedContract => typeof v === "object" && v !== null && "codehash" in v,
  );
  for (const c of entries) {
    const code = await client.getCode({ address: c.address });
    const actual = keccak256(code ?? "0x");
    if (actual !== c.codehash) {
      mismatches.push({ role: c.role, address: c.address, expected: c.codehash, actual });
    }
  }
  return mismatches;
}

/** Throwing form for boot-time use: the chain layer must not start on a mismatch. */
export async function assertPinnedCodehashes(client: PublicClient, addresses: ChainAddresses): Promise<void> {
  const bad = await checkPinnedCodehashes(client, addresses);
  if (bad.length > 0) {
    const detail = bad.map((m) => `${m.role} @ ${m.address}: expected ${m.expected}, got ${m.actual}`).join("\n  ");
    throw new Error(`PINNED CODEHASH MISMATCH on chain ${addresses.chainId} — refusing to start:\n  ${detail}`);
  }
}
