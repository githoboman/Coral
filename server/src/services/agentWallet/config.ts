import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

/**
 * Single source of truth for the agent-policy on-chain identifiers and the
 * canonical asset/protocol strings the policy whitelists against. Everything is
 * env-driven so the same code targets testnet today and mainnet later, mirroring
 * how ticketMinter.ts resolves SUI_PACKAGE_ID et al.
 */

export type SuiNetwork = "testnet" | "mainnet";

export function getNetwork(): SuiNetwork {
  return (process.env.SUI_NETWORK as SuiNetwork) || "testnet";
}

/** Shared read/execute client for the agent engine. */
let sharedClient: SuiClient | null = null;
export function getSuiClient(): SuiClient {
  if (!sharedClient) {
    sharedClient = new SuiClient({ url: getFullnodeUrl(getNetwork()) });
  }
  return sharedClient;
}

/** The Sui system Clock object — required for every timestamp check. */
export const CLOCK_OBJECT_ID = "0x6";

export interface AgentPolicyConfig {
  /** Published agent_policy package id. */
  packageId: string;
  /** DeepBook V3 package id (testnet). */
  deepbookPackageId: string;
}

/**
 * Resolve the agent-policy config from env, throwing a clear error if the package
 * hasn't been published yet. Callers that only need read-side helpers (asset type
 * strings) can use the standalone helpers below without triggering this.
 */
export function getAgentPolicyConfig(): AgentPolicyConfig {
  const packageId = process.env.AGENT_POLICY_PACKAGE_ID || "";
  const deepbookPackageId = process.env.DEEPBOOK_PACKAGE_ID || "";

  if (!packageId) {
    throw new Error(
      "AGENT_POLICY_PACKAGE_ID not set. Publish the agent_policy Move package " +
        "to testnet and set the env var to its package id.",
    );
  }
  if (!deepbookPackageId) {
    throw new Error(
      "DEEPBOOK_PACKAGE_ID not set. Set it to the DeepBook V3 testnet package id.",
    );
  }

  return { packageId, deepbookPackageId };
}

/**
 * Canonical coin type strings used both for policy whitelisting and DeepBook calls.
 * These must match exactly the strings passed into create_policy's allowed_assets,
 * because the Move side does exact ascii-string membership checks.
 */
export const ASSET_TYPES: Record<string, string> = {
  SUI: "0x2::sui::SUI",
  // USDC testnet type — overridable via env in case the demo uses a different faucet coin.
  USDC:
    process.env.USDC_TYPE ||
    "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
};

/**
 * On-chain coin decimals per symbol. The agent records spend and sizes amounts in
 * these base units; DeepBook order quantities, by contrast, are in whole tokens.
 */
export const DECIMALS: Record<string, number> = { SUI: 9, USDC: 6 };

/** Decimals for a symbol; defaults to 9 (SUI-like) for unknown coins. */
export function decimalsFor(symbol: string): number {
  return DECIMALS[symbol.toUpperCase()] ?? 9;
}

/** Convert a base-unit amount (bigint) to whole tokens (number) for the DeepBook SDK. */
export function toWholeTokens(amountBaseUnits: bigint, symbol: string): number {
  return Number(amountBaseUnits) / 10 ** decimalsFor(symbol);
}

/** Resolve a short symbol (SUI/USDC) to its fully-qualified coin type string. */
export function assetTypeFor(symbol: string): string {
  const key = symbol.toUpperCase();
  const t = ASSET_TYPES[key];
  if (!t) {
    throw new Error(`Unknown asset symbol '${symbol}'. Known: ${Object.keys(ASSET_TYPES).join(", ")}`);
  }
  return t;
}

/**
 * The protocol identifier whitelisted in the policy for DeepBook. Kept as the
 * DeepBook package id string so validate_action's protocol check is meaningful.
 */
export function deepbookProtocolId(): string {
  return getAgentPolicyConfig().deepbookPackageId;
}
