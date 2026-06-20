import { getPolicyChecker } from "./policyChecker.js";

/**
 * Off-chain budget bookkeeping. The hard limit lives in the Move contract's
 * record_spend; this tracker is the soft, gas-saving layer that also accounts for
 * ALLOCATED-but-not-yet-settled spend (e.g. open limit orders) which the on-chain
 * budget_spent doesn't reflect until the order fills.
 *
 *   available = budget_cap - budget_spent(on-chain) - allocated(pending)
 *
 * Allocations are held in memory keyed by policy; they're reconciled away when the
 * corresponding order settles or cancels. This is intentionally not persisted —
 * on restart we re-derive from on-chain spend and any still-open orders.
 */
export class BudgetTracker {
  /** policyId -> (allocationId -> amount) */
  private allocations = new Map<string, Map<string, bigint>>();

  private bucket(policyId: string): Map<string, bigint> {
    let b = this.allocations.get(policyId);
    if (!b) {
      b = new Map();
      this.allocations.set(policyId, b);
    }
    return b;
  }

  /** Sum of pending allocations for a policy. */
  allocated(policyId: string): bigint {
    let sum = 0n;
    for (const v of this.bucket(policyId).values()) sum += v;
    return sum;
  }

  /**
   * How much the agent may still commit right now, factoring on-chain spend and
   * local pending allocations. Reads fresh on-chain state each call.
   */
  async available(policyId: string): Promise<bigint> {
    const policy = await getPolicyChecker().readPolicy(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    const free = policy.budgetCap - policy.budgetSpent - this.allocated(policyId);
    return free > 0n ? free : 0n;
  }

  /**
   * Reserve budget for an in-flight action. Returns false if it wouldn't fit, so
   * the caller can reject before building a PTB. allocationId is typically the
   * order id (for limit orders) or a generated id (for market swaps).
   */
  async tryAllocate(policyId: string, allocationId: string, amount: bigint): Promise<boolean> {
    const free = await this.available(policyId);
    if (amount > free) return false;
    this.bucket(policyId).set(allocationId, amount);
    return true;
  }

  /** Release an allocation once its action settles, fails, or is cancelled. */
  release(policyId: string, allocationId: string): void {
    this.bucket(policyId).delete(allocationId);
  }

  /** Clear all allocations for a policy (e.g. on revocation). */
  clear(policyId: string): void {
    this.allocations.delete(policyId);
  }
}

let instance: BudgetTracker | null = null;
export function getBudgetTracker(): BudgetTracker {
  if (!instance) instance = new BudgetTracker();
  return instance;
}
