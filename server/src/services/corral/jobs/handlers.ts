/**
 * The engine's job handlers, in one place (spec §6.3).
 *
 * Every handler must be safe to run twice — the queue is at-least-once, and
 * at-most-once *execution* comes from the ledger's idempotency key, never from
 * a handler being careful. None of these can widen a policy: they read chain
 * state, record what they find, and pause when something disagrees.
 *
 * `execution.run` is supplied by the caller because it needs the adapter,
 * signer and chain clients the deployment chooses. The safety jobs only need
 * a read client, so they are built here.
 */
import type { PublicClient } from "viem";

import type { ChainAddresses } from "../../evm/addresses.js";
import { checkProviders, providersHealthy } from "../../evm/chain/clients.js";
import { query } from "../db/pool.js";
import { detectAndPause } from "../reconcile/anomalies.js";
import { recordAnomaly } from "../reconcile/budget.js";
import { monitorActiveSessions } from "./moduleMonitor.js";
import { recoverStranded } from "./recover.js";
import type { JobHandler } from "./worker.js";

export interface SafetyHandlerDeps {
  readonly client: PublicClient;
  readonly addresses: ChainAddresses;
}

/** `execution.recover` — resolve stranded rows against the chain (C-504). */
export function recoverHandler(deps: SafetyHandlerDeps): JobHandler {
  return async () => {
    const results = await recoverStranded(deps.client, deps.addresses);
    const resolved = results.filter((r) => r.resolution !== "STILL_PENDING").length;
    return { kind: "DONE", note: `${String(resolved)}/${String(results.length)} resolved` };
  };
}

/** `module.monitor` — detect module-set changes and pause (C-506, FR-1.5). */
export function moduleMonitorHandler(deps: SafetyHandlerDeps): JobHandler {
  return async () => {
    const results = await monitorActiveSessions(deps.client, deps.addresses);
    const changed = results.filter((r) => r.changed).length;
    return { kind: "DONE", note: `${String(results.length)} checked, ${String(changed)} changed` };
  };
}

/** `anomaly.scan` — the SEC-9 detectors across every active session. */
export function anomalyScanHandler(): JobHandler {
  return async () => {
    const sessions = await query<{ id: string }>(`SELECT id FROM corral_sessions WHERE status = 'ACTIVE' LIMIT 500`);
    let paused = 0;
    for (const s of sessions) {
      const { paused: didPause } = await detectAndPause(s.id);
      if (didPause) paused += 1;
    }
    return { kind: "DONE", note: `${String(sessions.length)} scanned, ${String(paused)} paused` };
  };
}

/**
 * `rpc.health` — per-provider lag check (NFR-14).
 *
 * Records an anomaly rather than pausing anything. A stale provider is an
 * infrastructure fault, not a policy event, and pausing every session because
 * one endpoint fell behind would be its own outage.
 */
export function rpcHealthHandler(chainId: number): JobHandler {
  return async () => {
    const health = await checkProviders(chainId);
    if (!providersHealthy(health)) {
      await recordAnomaly(null, "RPC_DEGRADED", {
        // Hosts only. The URLs carry API keys.
        providers: health.map((h) => ({ host: h.host, ok: h.ok, blocksBehind: h.blocksBehind?.toString(10) ?? null })),
      });
      return { kind: "DONE", note: "degraded — anomaly recorded" };
    }
    return { kind: "DONE", note: `${String(health.filter((h) => h.ok).length)}/${String(health.length)} healthy` };
  };
}

/** The safety handlers, ready to merge with the deployment's `execution.run`. */
export function safetyHandlers(deps: SafetyHandlerDeps): Record<string, JobHandler> {
  return {
    "execution.recover": recoverHandler(deps),
    "module.monitor": moduleMonitorHandler(deps),
    "anomaly.scan": anomalyScanHandler(),
    "rpc.health": rpcHealthHandler(deps.addresses.chainId),
  };
}
