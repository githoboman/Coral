/**
 * Policy diff (FR-11.2): what widened, what narrowed.
 *
 * Policies are immutable (FR-2.9), so "editing" one means revoking and
 * installing a replacement. At that moment the user has exactly one question,
 * and it is not "what fields changed" — it is **"am I giving this thing more
 * power than before?"**
 *
 * So the classification is only ever widened or narrowed, and where a change
 * is ambiguous it is reported as **widened**. Under-reporting a widening is
 * the failure that costs money; over-reporting one costs a second look.
 *
 * Like `policySummary`, this lives in core rather than the frontend: the
 * comparison has to be made by the code that understands the invariants, not
 * by a component that only understands layout.
 */

import type { Address, TargetConstraint, ValidatedPolicy } from "./policy.js";

export type DiffField = "budget" | "asset" | "venue" | "expiry" | "usage" | "slippage" | "native" | "destination";

/** How much attention a change deserves. `high` means it removes a protection. */
export type DiffSeverity = "high" | "normal";

export interface PolicyChange {
  readonly field: DiffField;
  readonly detail: string;
  readonly severity: DiffSeverity;
}

export interface PolicyDiff {
  readonly widened: PolicyChange[];
  readonly narrowed: PolicyChange[];
  readonly hasChanges: boolean;
  /** True when anything widened. The one bit a confirm button should gate on. */
  readonly grantsMorePower: boolean;
}

function key(t: TargetConstraint): string {
  return `${t.address}:${t.selector}`;
}

function pinsRecipient(t: TargetConstraint): boolean {
  return t.param_rules.some((r) => r.rule === "EQ_ACCOUNT");
}

function assetLabel(symbol: string, address: Address | null): string {
  return address === null ? symbol : `${symbol} (${address})`;
}

function days(seconds: number): number {
  const rem = seconds % 86_400;
  return (seconds - rem) / 86_400;
}

function pct(bps: number): string {
  const rem = bps % 100;
  const whole = (bps - rem) / 100;
  return rem === 0 ? String(whole) : `${String(whole)}.${String(rem).padStart(2, "0").replace(/0+$/, "")}`;
}

/**
 * Compare an existing policy with its proposed replacement.
 *
 * Both must already be validated — the diff describes two things that are each
 * individually safe, and says how their power differs.
 */
export function policyDiff(from: ValidatedPolicy, to: ValidatedPolicy): PolicyDiff {
  const widened: PolicyChange[] = [];
  const narrowed: PolicyChange[] = [];

  // ── Budgets ──
  for (const b of to.budgets) {
    const before = from.budgets.find((x) => x.asset.address === b.asset.address);
    if (!before) {
      widened.push({
        field: "asset",
        detail: `The agent can now spend ${assetLabel(b.asset.symbol, b.asset.address)}, which it could not before.`,
        severity: "high",
      });
      continue;
    }
    if (b.max_total > before.max_total) {
      widened.push({
        field: "budget",
        detail: `The total ${b.asset.symbol} it can spend went up, from ${before.max_total.toString(10)} to ${b.max_total.toString(10)} (smallest units).`,
        severity: "normal",
      });
    } else if (b.max_total < before.max_total) {
      narrowed.push({
        field: "budget",
        detail: `The total ${b.asset.symbol} it can spend went down, from ${before.max_total.toString(10)} to ${b.max_total.toString(10)} (smallest units).`,
        severity: "normal",
      });
    }
  }
  for (const b of from.budgets) {
    if (!to.budgets.some((x) => x.asset.address === b.asset.address)) {
      narrowed.push({
        field: "asset",
        detail: `The agent can no longer spend ${assetLabel(b.asset.symbol, b.asset.address)}.`,
        severity: "normal",
      });
    }
  }

  // ── Venues, and the protections attached to them ──
  const fromTargets = new Map(from.target_scope.map((t) => [key(t), t]));
  const toTargets = new Map(to.target_scope.map((t) => [key(t), t]));

  for (const [k, t] of toTargets) {
    const before = fromTargets.get(k);
    if (!before) {
      widened.push({
        field: "venue",
        detail: `The agent can now call a new contract: ${t.address} (${t.action.toLowerCase()}).`,
        severity: "high",
      });
      continue;
    }
    // The single most dangerous change a replacement can make.
    if (pinsRecipient(before) && !pinsRecipient(t)) {
      widened.push({
        field: "destination",
        detail: `Funds sent through ${t.address} no longer have to come back to your own account.`,
        severity: "high",
      });
    } else if (!pinsRecipient(before) && pinsRecipient(t)) {
      narrowed.push({
        field: "destination",
        detail: `Funds sent through ${t.address} must now come back to your own account.`,
        severity: "normal",
      });
    }
  }
  for (const [k, t] of fromTargets) {
    if (!toTargets.has(k)) {
      narrowed.push({
        field: "venue",
        detail: `The agent can no longer call ${t.address}.`,
        severity: "normal",
      });
    }
  }

  // A new action kind is new capability even if no target changed.
  for (const a of to.action_scope) {
    if (!from.action_scope.includes(a)) {
      widened.push({ field: "venue", detail: `The agent can now perform ${a} actions.`, severity: "high" });
    }
  }
  for (const a of from.action_scope) {
    if (!to.action_scope.includes(a)) {
      narrowed.push({ field: "venue", detail: `The agent can no longer perform ${a} actions.`, severity: "normal" });
    }
  }

  // ── Window ──
  const fromWindow = from.valid_until - from.valid_after;
  const toWindow = to.valid_until - to.valid_after;
  if (toWindow > fromWindow) {
    widened.push({
      field: "expiry",
      detail: `The permission lasts longer: ${String(days(toWindow))} days instead of ${String(days(fromWindow))}.`,
      severity: "normal",
    });
  } else if (toWindow < fromWindow) {
    narrowed.push({
      field: "expiry",
      detail: `The permission is shorter: ${String(days(toWindow))} days instead of ${String(days(fromWindow))}.`,
      severity: "normal",
    });
  }

  // ── Usage ──
  if (to.max_executions > from.max_executions) {
    widened.push({
      field: "usage",
      detail: `It can run more times in total: ${String(to.max_executions)} instead of ${String(from.max_executions)}.`,
      severity: "normal",
    });
  } else if (to.max_executions < from.max_executions) {
    narrowed.push({
      field: "usage",
      detail: `It can run fewer times in total: ${String(to.max_executions)} instead of ${String(from.max_executions)}.`,
      severity: "normal",
    });
  }
  if (to.max_executions_per_24h > from.max_executions_per_24h) {
    widened.push({
      field: "usage",
      detail: `It can run more often: up to ${String(to.max_executions_per_24h)} times a day instead of ${String(from.max_executions_per_24h)}.`,
      severity: "normal",
    });
  } else if (to.max_executions_per_24h < from.max_executions_per_24h) {
    narrowed.push({
      field: "usage",
      detail: `It can run less often: up to ${String(to.max_executions_per_24h)} times a day instead of ${String(from.max_executions_per_24h)}.`,
      severity: "normal",
    });
  }

  // ── Slippage: a LOWER floor is less protection, so it widens. ──
  if (to.min_output_bps < from.min_output_bps) {
    widened.push({
      field: "slippage",
      detail: `Trades may return less: at least ${pct(to.min_output_bps)}% of the quote instead of ${pct(from.min_output_bps)}%.`,
      severity: "normal",
    });
  } else if (to.min_output_bps > from.min_output_bps) {
    narrowed.push({
      field: "slippage",
      detail: `Trades must return more: at least ${pct(to.min_output_bps)}% of the quote instead of ${pct(from.min_output_bps)}%.`,
      severity: "normal",
    });
  }

  // ── Native value ──
  if (to.max_native_value > from.max_native_value) {
    widened.push({
      field: "native",
      detail:
        from.max_native_value === 0n
          ? `The agent can now spend the chain's own currency, which it could not before.`
          : `The agent can spend more of the chain's own currency than before.`,
      severity: from.max_native_value === 0n ? "high" : "normal",
    });
  } else if (to.max_native_value < from.max_native_value) {
    narrowed.push({
      field: "native",
      detail:
        to.max_native_value === 0n
          ? `The agent can no longer spend the chain's own currency at all.`
          : `The agent can spend less of the chain's own currency than before.`,
      severity: "normal",
    });
  }

  return {
    widened,
    narrowed,
    hasChanges: widened.length > 0 || narrowed.length > 0,
    grantsMorePower: widened.length > 0,
  };
}
