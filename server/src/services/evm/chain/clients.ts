/**
 * Chain access with multi-provider failover (NFR-14, D19).
 *
 * D19 made commercial RPC a *permanent* dependency rather than a stopgap on
 * the way to our own nodes. That converts provider availability from someone
 * else's problem into ours: a single endpoint means a provider incident stops
 * every execution, and the failure mode of a stale endpoint is worse than an
 * unreachable one — reads succeed and quietly describe an old chain.
 *
 * Two defences here:
 *
 *  1. `fallback([...])` over every configured endpoint, with viem's latency
 *     and stability ranking, so traffic moves off a degraded provider without
 *     a deploy.
 *  2. `checkProviders()`, which reads each endpoint independently and reports
 *     how far behind the best one it is. NFR-14's alert ("primary more than
 *     20 blocks behind head") needs per-provider visibility, which the
 *     fallback transport deliberately hides.
 *
 * Configuration is `EVM_RPC_URLS` (comma-separated, in preference order).
 * `EVM_RPC_URL` remains accepted as the single-endpoint form so existing
 * scripts and the deployed testnet setup keep working unchanged.
 */
import { createPublicClient, fallback, http, type Chain, type PublicClient, type Transport } from "viem";
import { base, baseSepolia } from "viem/chains";

/** Alert threshold from NFR-14. */
export const MAX_BLOCKS_BEHIND = 20n;

export interface ProviderHealth {
  /** Host only — URLs carry API keys and must never reach a log or a user. */
  readonly host: string;
  readonly ok: boolean;
  readonly blockNumber: bigint | null;
  readonly blocksBehind: bigint | null;
  readonly latencyMs: number;
  readonly error: string | null;
}

/**
 * Endpoint URLs in preference order. Never log the result: these embed API
 * keys, and one has already leaked into a transcript this way.
 */
export function rpcUrls(): string[] {
  const many = process.env["EVM_RPC_URLS"];
  const one = process.env["EVM_RPC_URL"];
  const raw = many && many.trim() !== "" ? many : (one ?? "");
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (urls.length === 0) {
    throw new Error("no RPC endpoint configured: set EVM_RPC_URLS (comma-separated) or EVM_RPC_URL");
  }
  return urls;
}

/** Host of an endpoint, for logs and metrics. Strips credentials and key paths. */
export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export function chainFor(chainId: number): Chain {
  switch (chainId) {
    case base.id:
      return base;
    case baseSepolia.id:
      return baseSepolia;
    default:
      throw new Error(`unsupported chain id ${String(chainId)} — Base only (CLAUDE.md §3)`);
  }
}

/**
 * A transport that ranks endpoints by observed latency and stability and
 * moves off a failing one automatically. With a single endpoint configured
 * this is behaviourally identical to a plain `http()`.
 */
export function failoverTransport(urls: string[] = rpcUrls()): Transport {
  const transports = urls.map((url) => http(url, { timeout: 15_000, retryCount: 2, retryDelay: 250 }));
  if (transports.length === 1) return transports[0] as Transport;
  return fallback(transports, {
    rank: { interval: 30_000, sampleCount: 5, timeout: 3_000 },
    retryCount: 1,
  });
}

export function publicClientFor(chainId: number, urls: string[] = rpcUrls()): PublicClient {
  return createPublicClient({ chain: chainFor(chainId), transport: failoverTransport(urls) });
}

/**
 * Read every endpoint independently and report its lag against the furthest-
 * ahead one. A provider that answers but trails the head is the dangerous
 * case: quotes and budget reads taken from it are simply out of date.
 */
export async function checkProviders(chainId: number, urls: string[] = rpcUrls()): Promise<ProviderHealth[]> {
  const chain = chainFor(chainId);
  const readings = await Promise.all(
    urls.map(async (url): Promise<Omit<ProviderHealth, "blocksBehind">> => {
      const started = Date.now();
      try {
        const client = createPublicClient({ chain, transport: http(url, { timeout: 5_000, retryCount: 0 }) });
        const blockNumber = await client.getBlockNumber();
        return { host: safeHost(url), ok: true, blockNumber, latencyMs: Date.now() - started, error: null };
      } catch (e) {
        return {
          host: safeHost(url),
          ok: false,
          blockNumber: null,
          latencyMs: Date.now() - started,
          // Provider errors embed the request URL, and the URL embeds the key.
          error: e instanceof Error ? e.message.split("\n")[0]?.slice(0, 200) ?? "request failed" : "request failed",
        };
      }
    }),
  );

  const best = readings.reduce<bigint | null>(
    (acc, r) => (r.blockNumber !== null && (acc === null || r.blockNumber > acc) ? r.blockNumber : acc),
    null,
  );
  return readings.map((r) => ({
    ...r,
    blocksBehind: best !== null && r.blockNumber !== null ? best - r.blockNumber : null,
  }));
}

/** True when at least one endpoint is healthy and within the NFR-14 threshold. */
export function providersHealthy(health: readonly ProviderHealth[]): boolean {
  return health.some((h) => h.ok && h.blocksBehind !== null && h.blocksBehind <= MAX_BLOCKS_BEHIND);
}
