/**
 * NFR-14 — multi-provider RPC configuration and health reporting.
 *
 * Offline only: these assert the configuration and reporting logic, not that
 * a provider is reachable. The one security-relevant assertion is that no
 * function here can leak an endpoint URL — they embed API keys, and one has
 * already reached a transcript that way.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  chainFor,
  failoverTransport,
  MAX_BLOCKS_BEHIND,
  providersHealthy,
  rpcUrls,
  safeHost,
  type ProviderHealth,
} from "../chain/clients.js";

const KEYED = "https://base-sepolia.g.alchemy.com/v2/SUPERSECRETKEY";

function env(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  env({ EVM_RPC_URLS: undefined, EVM_RPC_URL: undefined });
});

describe("endpoint configuration", () => {
  it("reads a comma-separated list in preference order", () => {
    env({ EVM_RPC_URLS: "https://a.example/1, https://b.example/2 ,https://c.example/3" });
    expect(rpcUrls()).toEqual(["https://a.example/1", "https://b.example/2", "https://c.example/3"]);
  });

  it("still accepts the single-endpoint form, so existing deployments keep working", () => {
    env({ EVM_RPC_URL: "https://only.example/rpc" });
    expect(rpcUrls()).toEqual(["https://only.example/rpc"]);
  });

  it("prefers the list when both are set", () => {
    env({ EVM_RPC_URLS: "https://a.example/1", EVM_RPC_URL: "https://legacy.example/1" });
    expect(rpcUrls()).toEqual(["https://a.example/1"]);
  });

  it("fails loudly when nothing is configured rather than defaulting to a public node", () => {
    expect(() => rpcUrls()).toThrow(/no RPC endpoint configured/);
  });

  it("builds a transport for one or many endpoints", () => {
    expect(failoverTransport(["https://a.example/1"])).toBeTypeOf("function");
    expect(failoverTransport(["https://a.example/1", "https://b.example/2"])).toBeTypeOf("function");
  });
});

describe("URLs never leak", () => {
  it("safeHost keeps the host and drops the key-bearing path", () => {
    const host = safeHost(KEYED);
    expect(host).toBe("base-sepolia.g.alchemy.com");
    expect(host).not.toContain("SUPERSECRETKEY");
  });

  it("safeHost degrades rather than echoing an unparseable value back", () => {
    expect(safeHost("not a url")).toBe("invalid-url");
  });
});

describe("chain selection", () => {
  it("resolves Base and Base Sepolia", () => {
    expect(chainFor(8453).id).toBe(8453);
    expect(chainFor(84532).id).toBe(84532);
  });

  it("refuses any other chain — Base only", () => {
    expect(() => chainFor(1)).toThrow(/Base only/);
  });
});

describe("health assessment", () => {
  const ok = (blocksBehind: bigint | null, healthy = true): ProviderHealth => ({
    host: "a.example",
    ok: healthy,
    blockNumber: 100n,
    blocksBehind,
    latencyMs: 10,
    error: null,
  });

  it("is healthy when one provider is at the head", () => {
    expect(providersHealthy([ok(0n)])).toBe(true);
  });

  it("is unhealthy when every provider trails past the threshold", () => {
    // The dangerous failure: the endpoint answers, so nothing looks broken,
    // but every quote and budget read describes an older chain.
    expect(providersHealthy([ok(MAX_BLOCKS_BEHIND + 1n), ok(50n)])).toBe(false);
  });

  it("tolerates lag up to the threshold", () => {
    expect(providersHealthy([ok(MAX_BLOCKS_BEHIND)])).toBe(true);
  });

  it("does not count an unreachable provider as healthy", () => {
    expect(providersHealthy([ok(0n, false)])).toBe(false);
  });

  it("is unhealthy when nothing is configured at all", () => {
    expect(providersHealthy([])).toBe(false);
  });
});
