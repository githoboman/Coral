/**
 * The Corral API client.
 *
 * Every type here is imported from `@corral/core` or derived from it. The
 * frontend does not define what a Policy or an ExecutionStatus is (FR-11.9) —
 * a second definition is a second thing to keep in sync, and the one that
 * drifts is always the one on the screen the user reads before signing.
 *
 * Reads are allowed to fail. Nothing here retries a policy rejection, and
 * nothing here can cause an execution: the API surface it talks to only reads
 * state and starts a revoke.
 */
import type { CorralEvent, ExecutionStatus, RawPolicy } from "@corral/core";

export const API_BASE = import.meta.env["VITE_API_BASE"] ?? "/api";

export interface BudgetMeter {
  readonly asset: string;
  readonly limit: string;
  readonly spent: string;
  readonly remaining: string;
  readonly usage: { readonly used: number; readonly limit: number };
  /** Always "on-chain" — FR-6.4 requires the source to be shown, not implied. */
  readonly source: string;
  readonly readAt: string;
}

export interface SessionView {
  readonly id: string;
  readonly chainId: number;
  readonly account: string;
  readonly agentSigner: string;
  readonly permissionId: string;
  readonly status: string;
  readonly signerDisabled: boolean;
  readonly validAfter: number;
  readonly validUntil: number;
  readonly policy: RawPolicy;
  readonly budgets: readonly BudgetMeter[];
}

export interface TradeView {
  readonly assetIn: string | null;
  readonly amountIn: string | null;
  readonly assetOut: string | null;
  readonly quotedOut: string | null;
  readonly realisedOut: string | null;
  readonly slippageBps: number | null;
  readonly venue: string | null;
}

export interface GasView {
  readonly gasUsed: string;
  readonly effectiveGasPriceWei: string | null;
  readonly costWei: string | null;
  readonly paidBy: string;
  readonly note: string;
}

export interface ExecutionView {
  readonly id: string;
  readonly status: ExecutionStatus | string;
  readonly seq: number;
  readonly scheduledFor: string;
  readonly intentHash: string | null;
  readonly txHash: string | null;
  readonly blockNumber: string | null;
  readonly trade: TradeView | null;
  /** Separate from `trade` on purpose — gas is not part of the budget (FR-6.5). */
  readonly gas: GasView | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export interface RevokeTicket {
  readonly ownerTransaction: { readonly to: string; readonly data: string; readonly value?: string };
  readonly disclosure: string;
  readonly fallbackPage: string;
}

/**
 * A failure the UI can render without leaking internals.
 *
 * `code` is a `@corral/core` error code when the server sent one; the UI maps
 * it through `userMessage()` and never shows a raw string (FR-11.8).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    // Network-level failure. Distinguished from a server error because the
    // UI's advice differs: one is "check your connection", the other is ours.
    throw new ApiError(0, "NETWORK_UNAVAILABLE", "Could not reach Corral.");
  }

  if (!res.ok) {
    let code: string | null = null;
    let message = `Request failed (${String(res.status)})`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      code = body.code ?? null;
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const corralApi = {
  health: () => request<{ database: boolean; engine: boolean; queue?: unknown }>("/corral/health"),

  session: (id: string) => request<SessionView>(`/corral/sessions/${id}`),

  executions: (id: string, limit = 50) =>
    request<ExecutionView[]>(`/corral/sessions/${id}/executions?limit=${String(limit)}`),

  events: (id: string, limit = 50) => request<CorralEvent[]>(`/corral/sessions/${id}/events?limit=${String(limit)}`),

  /**
   * Start a revoke. The server disables the off-chain signer before this
   * resolves, then hands back a transaction for the OWNER to send — Corral
   * cannot revoke on their behalf and holds no key that could.
   */
  prepareRevoke: (id: string) => request<RevokeTicket>(`/corral/sessions/${id}/revoke/prepare`, { method: "POST" }),

  /** Public, unauthenticated: anyone can verify an account without trusting us. */
  verify: (address: string) =>
    request<{ account: string; sessions: unknown[] }>(`/corral/verify/${address.toLowerCase()}`),

  csvUrl: (id: string) => `${API_BASE}/corral/sessions/${id}/executions.csv`,
};
