/**
 * Account layer (T-007, FR-1.1/1.2, D25): Safe 1.4.1 behind the Safe7579
 * adapter, created through permissionless.js with every address pinned from
 * `addresses.ts`. This module is the only place that knows which account
 * implementation Corral uses; everything else talks to `CorralAccount`.
 *
 * Counterfactual address: permissionless derives it by simulating the
 * factory call against the EntryPoint, so `address` is known before any
 * deployment (FR-1.1) and is a pure function of (owner, saltNonce, pinned
 * config). Changing any pinned address changes every user's address —
 * which is the point of pinning.
 */

import type { Address, Hex, LocalAccount, PublicClient } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { toSafeSmartAccount } from "permissionless/accounts";

import { addressesFor, type ChainAddresses } from "./addresses.js";

export interface CorralAccountParams {
  /** Read-only chain client. */
  readonly client: PublicClient;
  /** The user's root authority. Corral never holds this key (FR-1.4). */
  readonly owner: LocalAccount;
  /** Per-user salt so one owner can hold several accounts. Default 0. */
  readonly saltNonce?: bigint;
}

export interface CorralAccount {
  readonly chainId: number;
  /** Counterfactual (pre-deploy) or actual address — identical by construction. */
  readonly address: Address;
  readonly owner: Address;
  readonly saltNonce: bigint;
  /** `true` once bytecode exists at `address`. */
  isDeployed(): Promise<boolean>;
  /**
   * Factory call that deploys this exact account. Any EOA may broadcast it
   * directly (no bundler needed) — the resulting address is fixed by the
   * factory/data, not by the sender.
   */
  getFactoryArgs(): Promise<{ factory: Address; factoryData: Hex }>;
  /** The permissionless account object, for userOp construction later. */
  readonly inner: Awaited<ReturnType<typeof toSafeSmartAccount>>;
  readonly addresses: ChainAddresses;
}

/**
 * Build the (possibly undeployed) Corral account for an owner.
 *
 * ERC-7579 module set at creation: none beyond the Safe7579 adapter
 * itself. SmartSessions is installed by the owner-initiated session flow
 * (T-008), never here — keeping §2.3 ("no code path may widen a policy")
 * trivially true for this module.
 */
export async function createCorralAccount(params: CorralAccountParams): Promise<CorralAccount> {
  const chainId = params.client.chain?.id;
  if (chainId === undefined) throw new Error("client must have a chain");
  const addresses = addressesFor(chainId);
  const saltNonce = params.saltNonce ?? 0n;

  const inner = await toSafeSmartAccount({
    client: params.client,
    owners: [params.owner],
    version: "1.4.1",
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    safe4337ModuleAddress: addresses.safe7579Adapter.address,
    erc7579LaunchpadAddress: addresses.safe7579Launchpad.address,
    safeSingletonAddress: addresses.safeSingleton.address,
    safeProxyFactoryAddress: addresses.safeProxyFactory.address,
    // Registry-gated module installs: only Rhinestone-attested modules may
    // be installed (FR-1.5 first line of defence; the monitor is the second).
    attesters: [addresses.rhinestoneAttester.address],
    attestersThreshold: 1,
    saltNonce,
  });

  if (entryPoint07Address.toLowerCase() !== addresses.entryPoint.address.toLowerCase()) {
    throw new Error("viem's entryPoint07Address diverged from the pinned EntryPoint — refusing");
  }

  return {
    chainId,
    address: inner.address,
    owner: params.owner.address,
    saltNonce,
    addresses,
    inner,
    async isDeployed() {
      const code = await params.client.getCode({ address: inner.address });
      return code !== undefined && code !== "0x";
    },
    async getFactoryArgs() {
      const { factory, factoryData } = await inner.getFactoryArgs();
      if (!factory || !factoryData) throw new Error("account reports no factory args");
      return { factory, factoryData };
    },
  };
}

/** FR-1.1 helper: the address alone, without building the full account. */
export async function predictAccountAddress(params: CorralAccountParams): Promise<Address> {
  return (await createCorralAccount(params)).address;
}
