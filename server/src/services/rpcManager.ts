import axios from 'axios';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

interface RpcEndpoint {
  url: string;
  failures: number;
  lastFailure: number | null;
  latencyMs: number | null;
}

interface JsonRpcRequest {
  method: string;
  params: any[];
}

interface JsonRpcResponse<T = any> {
  jsonrpc: string;
  id: number;
  result: T;
  error?: { code: number; message: string };
}

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════

const RPC_ENDPOINTS_MAINNET: string[] = [
  'https://fullnode.mainnet.sui.io:443',
  'https://mainnet.suiet.app',
  'https://rpc-mainnet.suiscan.xyz',
  'https://mainnet.sui.rpcpool.com',
  'https://sui-mainnet.nodeinfra.com',
  'https://mainnet-rpc.sui.chainbase.online',
  'https://sui-rpc.publicnode.com',
  'https://sui-mainnet-ca-1.cosmostation.io',
  'https://sui-mainnet-ca-2.cosmostation.io',
  'https://sui-mainnet-us-1.cosmostation.io',
  'https://sui-mainnet-us-2.cosmostation.io',
];

const RPC_ENDPOINTS_TESTNET: string[] = [
  'https://fullnode.testnet.sui.io:443',
  'https://testnet.suiet.app',
  'https://rpc-testnet.suiscan.xyz',
  'https://sui-testnet-endpoint.blockvision.org',
  'https://sui-testnet.nodeinfra.com',
];

// How many consecutive failures before an endpoint is temporarily blacklisted
const MAX_FAILURES = 3;
// How long (ms) a blacklisted endpoint is skipped before being retried
const COOLDOWN_MS = 60_000; // 1 minute
// Per-request timeout
const REQUEST_TIMEOUT_MS = 8_000;
// How many endpoints to try before giving up on a request
const MAX_RETRIES = 6;

// ══════════════════════════════════════════════════════════════════════
// MANAGER
// ══════════════════════════════════════════════════════════════════════

export class RpcManager {
  private endpoints: RpcEndpoint[];
  private currentIndex: number = 0;
  private requestId: number = 1;
  private network: string = 'mainnet';

  constructor(urls?: string[]) {
    this.network = process.env.SUI_NETWORK || 'mainnet';
    const finalUrls = urls || (this.network === 'testnet' ? RPC_ENDPOINTS_TESTNET : RPC_ENDPOINTS_MAINNET);
    
    this.endpoints = finalUrls.map((url) => ({
      url,
      failures: 0,
      lastFailure: null,
      latencyMs: null,
    }));
    console.log(
      `[RateLimitSwitch] Initializing with ${this.endpoints.length} RPC endpoints:`,
      urls
    );
  }

  // ── Endpoint selection ─────────────────────────────────────────────

  /**
   * Returns the next healthy endpoint using round-robin.
   * Skips endpoints that are in cooldown from too many failures.
   */
  private getNextEndpoint(): RpcEndpoint | null {
    const now = Date.now();
    const total = this.endpoints.length;

    for (let i = 0; i < total; i++) {
      const idx = (this.currentIndex + i) % total;
      const ep = this.endpoints[idx];

      const inCooldown =
        ep.failures >= MAX_FAILURES &&
        ep.lastFailure !== null &&
        now - ep.lastFailure < COOLDOWN_MS;

      if (!inCooldown) {
        this.currentIndex = (idx + 1) % total;
        return ep;
      }
    }

    // All endpoints are in cooldown — reset all and try the first one
    console.warn('[RateLimitSwitch] All endpoints in cooldown, resetting...');
    this.endpoints.forEach((ep) => {
      ep.failures = 0;
      ep.lastFailure = null;
    });
    this.currentIndex = 1;
    return this.endpoints[0];
  }

  private markFailure(ep: RpcEndpoint) {
    ep.failures += 1;
    ep.lastFailure = Date.now();
    if (ep.failures >= MAX_FAILURES) {
      console.warn(
        `[RateLimitSwitch] Endpoint ${ep.url} blacklisted after ${ep.failures} failures`
      );
    }
  }

  private markSuccess(ep: RpcEndpoint, latencyMs: number) {
    ep.failures = 0;
    ep.lastFailure = null;
    ep.latencyMs = latencyMs;
  }

  // ── Core RPC call ──────────────────────────────────────────────────

  /**
   * Executes a JSON-RPC call against the best available endpoint.
   * Automatically retries on failure up to MAX_RETRIES times,
   * each time switching to the next healthy endpoint.
   */
  async call<T = any>(method: string, params: any[]): Promise<T> {
    const id = this.requestId++;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const ep = this.getNextEndpoint();
      if (!ep) throw new Error('[RateLimitSwitch] No available RPC endpoints');

      const start = Date.now();
      try {
        const response = await axios.post<JsonRpcResponse<T>>(
          ep.url,
          { jsonrpc: '2.0', id, method, params },
          {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (response.data.error) {
          throw new Error(
            `RPC error ${response.data.error.code}: ${response.data.error.message}`
          );
        }

        this.markSuccess(ep, Date.now() - start);
        return response.data.result;
      } catch (err: any) {
        lastError = err;
        this.markFailure(ep);
        console.warn(
          `[RateLimitSwitch] ${ep.url} failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${err?.message}`
        );
      }
    }

    throw new Error(
      `[RateLimitSwitch] All ${MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`
    );
  }

  /**
   * Runs multiple RPC calls in parallel across different endpoints
   * for maximum throughput.
   */
  async callParallel<T = any>(requests: JsonRpcRequest[]): Promise<T[]> {
    return Promise.all(requests.map((r) => this.call<T>(r.method, r.params)));
  }

  // ── Health diagnostics ─────────────────────────────────────────────

  getStatus() {
    const now = Date.now();
    return this.endpoints.map((ep) => ({
      url: ep.url,
      failures: ep.failures,
      latencyMs: ep.latencyMs,
      status:
        ep.failures >= MAX_FAILURES &&
          ep.lastFailure !== null &&
          now - ep.lastFailure < COOLDOWN_MS
          ? 'blacklisted'
          : ep.failures > 0
            ? 'degraded'
            : 'healthy',
    }));
  }
}

// ── Singleton ──────────────────────────────────────────────────────────
export const getRpcManager = (() => {
  let instance: RpcManager;
  return () => {
    if (!instance) instance = new RpcManager();
    return instance;
  };
})();