import { getPolicyChecker } from "./policyChecker.js";

/**
 * In-app alert feed for the agent wallet — the hackathon-minimum notification
 * layer (toast/banner in the Coral UI). Alerts are buffered per owner in memory
 * and drained by a frontend poll. Telegram/email/WhatsApp are post-hackathon
 * stretch goals and intentionally not wired here.
 */

export type AlertLevel = "info" | "warning" | "error" | "success";

export interface AgentAlert {
  id: string;
  ownerAddress: string;
  level: AlertLevel;
  title: string;
  message: string;
  timestamp: number;
  /** Optional structured context (policyId, orderId, digest, etc.). */
  meta?: Record<string, unknown>;
}

const MAX_PER_OWNER = 100;

export class AgentAlerts {
  private byOwner = new Map<string, AgentAlert[]>();
  private seq = 0;

  push(ownerAddress: string, level: AlertLevel, title: string, message: string, meta?: Record<string, unknown>): AgentAlert {
    const alert: AgentAlert = {
      id: `alert-${Date.now()}-${this.seq++}`,
      ownerAddress,
      level,
      title,
      message,
      timestamp: Date.now(),
      meta,
    };
    const list = this.byOwner.get(ownerAddress) ?? [];
    list.unshift(alert);
    if (list.length > MAX_PER_OWNER) list.length = MAX_PER_OWNER;
    this.byOwner.set(ownerAddress, list);
    return alert;
  }

  /** Newest-first alerts, optionally only those after a given id (for polling). */
  list(ownerAddress: string, sinceId?: string): AgentAlert[] {
    const list = this.byOwner.get(ownerAddress) ?? [];
    if (!sinceId) return list;
    const idx = list.findIndex((a) => a.id === sinceId);
    return idx <= 0 ? (idx === 0 ? [] : list) : list.slice(0, idx);
  }

  clear(ownerAddress: string): void {
    this.byOwner.delete(ownerAddress);
  }

  // ── PRD trigger helpers ──────────────────────────────────────────────

  budgetWarning(ownerAddress: string, spent: bigint, cap: bigint, policyId: string): void {
    this.push(
      ownerAddress,
      "warning",
      "Budget 80% spent",
      `Agent has spent ${spent} of ${cap} budget.`,
      { policyId },
    );
  }

  orderStale(ownerAddress: string, orderId: string, minutes: number): void {
    this.push(
      ownerAddress,
      "warning",
      "Order unfilled",
      `Order ${orderId} has been open for ${minutes} minutes.`,
      { orderId },
    );
  }

  expiryWarning(ownerAddress: string, policyId: string, minutesLeft: number): void {
    this.push(
      ownerAddress,
      "warning",
      "Policy expiring soon",
      `Agent policy expires in ${minutesLeft} minutes.`,
      { policyId },
    );
  }

  revoked(ownerAddress: string, policyId: string): void {
    this.push(ownerAddress, "success", "Agent revoked", "Capability destroyed and funds swept back.", { policyId });
  }

  actionFailed(ownerAddress: string, reason: string, meta?: Record<string, unknown>): void {
    this.push(ownerAddress, "error", "Agent action failed", reason, meta);
  }

  actionSucceeded(ownerAddress: string, title: string, message: string, meta?: Record<string, unknown>): void {
    this.push(ownerAddress, "success", title, message, meta);
  }

  /**
   * Evaluate budget/expiry thresholds against the live policy and emit warnings.
   * Call this after each agent action and on a periodic tick. Idempotency (not
   * re-warning every tick) is the caller's concern for the demo.
   */
  async evaluatePolicy(ownerAddress: string, policyId: string, nowMs = Date.now()): Promise<void> {
    const policy = await getPolicyChecker().readPolicy(policyId);
    if (!policy) return;

    if (policy.budgetCap > 0n) {
      const pct = Number((policy.budgetSpent * 100n) / policy.budgetCap);
      if (pct >= 80) this.budgetWarning(ownerAddress, policy.budgetSpent, policy.budgetCap, policyId);
    }

    const msLeft = Number(policy.expiryTimestamp) - nowMs;
    if (msLeft > 0 && msLeft < 60 * 60 * 1000) {
      this.expiryWarning(ownerAddress, policyId, Math.round(msLeft / 60_000));
    }
  }
}

let instance: AgentAlerts | null = null;
export function getAgentAlerts(): AgentAlerts {
  if (!instance) instance = new AgentAlerts();
  return instance;
}
