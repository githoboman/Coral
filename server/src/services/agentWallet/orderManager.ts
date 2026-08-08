import { AgentDeepBookClient, type DeepBookSetup } from "./deepbookClient.js";
import { getBudgetTracker } from "./budgetTracker.js";
import { getAgentPtbBuilder } from "./ptbBuilder.js";
import { getAgentExecutor } from "./executor.js";
import { deepbookProtocolId, assetTypeFor } from "./config.js";
import type { AgentWalletRecord } from "./types.js";

export type OrderState = "open" | "partially_filled" | "filled" | "cancelled" | "expired";

export interface TrackedOrder {
  orderId: string;
  clientOrderId: string;
  poolKey: string;
  totalQuantity: bigint;
  filledQuantity: bigint;
  state: OrderState;
  /** Budget allocation id to release once the order leaves the book. */
  allocationId: string;
  policyId: string;
}

/**
 * Tracks the lifecycle of the agent's open DeepBook orders and reconciles them
 * against on-chain status on a polling loop. Handles partial fills (filled vs total
 * quantity), automatic cleanup when an order leaves the book, and manual/auto
 * cancellation. Auto-cancel-on-expiry/revocation is driven by callers passing
 * cancelAll() into the revocation PTB; this class owns the per-order bookkeeping.
 */
export class OrderManager {
  private orders = new Map<string, TrackedOrder>();
  private pollTimer: NodeJS.Timeout | null = null;

  /** Register an order placed by the swap agent so its fills can be tracked. */
  track(order: TrackedOrder): void {
    this.orders.set(order.orderId, order);
  }

  list(): TrackedOrder[] {
    return [...this.orders.values()];
  }

  /**
   * Poll each tracked order's on-chain status and update fill state. When an order
   * is fully gone from the book, finalize it and release its budget allocation.
   */
  async reconcile(setup: DeepBookSetup): Promise<void> {
    const db = new AgentDeepBookClient(setup);
    const tracker = getBudgetTracker();

    for (const order of this.orders.values()) {
      if (order.state === "filled" || order.state === "cancelled" || order.state === "expired") {
        continue;
      }

      const status = await db.orderStatus(order.orderId);
      if (!status) {
        // Gone from the book: filled or swept. Treat as filled, release allocation.
        order.state = "filled";
        order.filledQuantity = order.totalQuantity;
        tracker.release(order.policyId, order.allocationId);
        continue;
      }

      const filled = BigInt(status.filled_quantity);
      const total = BigInt(status.quantity);
      order.filledQuantity = filled;
      order.totalQuantity = total;
      order.state = filled === 0n ? "open" : filled < total ? "partially_filled" : "filled";

      if (order.state === "filled") {
        tracker.release(order.policyId, order.allocationId);
      }
    }
  }

  /**
   * Cancel a tracked order on-chain through the guarded PTB. A cancel is validated
   * and logged but records no spend (amount 0). Releases the allocation on success.
   */
  async cancel(
    wallet: AgentWalletRecord,
    setup: DeepBookSetup,
    orderId: string,
  ): Promise<{ ok: boolean; reason?: string; digest?: string }> {
    const order = this.orders.get(orderId);
    if (!order) return { ok: false, reason: `Order ${orderId} not tracked` };
    if (!wallet.policyId || !wallet.capabilityId) {
      return { ok: false, reason: "Agent wallet not bound to a policy" };
    }

    const db = new AgentDeepBookClient(setup);
    const tx = getAgentPtbBuilder().buildCancel(
      {
        policyId: wallet.policyId,
        capabilityId: wallet.capabilityId,
        protocol: deepbookProtocolId(),
        tokenIn: assetTypeFor(setup.poolKey.split("_")[0]),
        tokenOut: assetTypeFor(setup.poolKey.split("_")[1]),
      },
      db.cancelOrderFragment(orderId),
    );

    const result = await getAgentExecutor().execute(wallet, tx);
    if (!result.success) return { ok: false, reason: result.error };

    order.state = "cancelled";
    getBudgetTracker().release(order.policyId, order.allocationId);
    return { ok: true, digest: result.digest };
  }

  /**
   * Start a background reconcile loop. Polls every intervalMs (default 10s, matching
   * the PRD's monitoring cadence). Idempotent — repeated starts are ignored.
   */
  startPolling(setup: DeepBookSetup, intervalMs = 10_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.reconcile(setup).catch((err) =>
        console.error("[OrderManager] reconcile error:", err?.message || err),
      );
    }, intervalMs);
    // Don't keep the process alive solely for polling.
    this.pollTimer.unref?.();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Drop finalized orders to keep the map small. */
  prune(): void {
    for (const [id, o] of this.orders) {
      if (o.state === "filled" || o.state === "cancelled" || o.state === "expired") {
        this.orders.delete(id);
      }
    }
  }
}

let instance: OrderManager | null = null;
export function getOrderManager(): OrderManager {
  if (!instance) instance = new OrderManager();
  return instance;
}
