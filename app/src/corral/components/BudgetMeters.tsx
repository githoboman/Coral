/**
 * Budget meters (FR-11.3, FR-6.4).
 *
 * Two requirements are doing work here and both are about honesty rather than
 * layout:
 *
 *  - Every figure is labelled with its **source and freshness**. "on-chain,
 *    12s ago" is a materially different claim from "£375 remaining", and the
 *    difference is what a user needs to decide whether to act on it.
 *  - Gas never appears here. It is a real cost, but it is not part of the
 *    asset budget (FR-6.5), and a meter that mixes them tells the user their
 *    limit is smaller than it is.
 */
import type { BudgetMeter } from "../lib/api";
import { amount, freshness, isStale, percentUsed } from "../lib/display";

function symbolFor(policyAssets: { symbol: string; address: string | null }[], asset: string): string {
  return policyAssets.find((a) => (a.address ?? "").toLowerCase() === asset.toLowerCase())?.symbol ?? "";
}

export function BudgetMeters({
  budgets,
  assets,
  now = Date.now(),
}: {
  budgets: readonly BudgetMeter[];
  assets: { symbol: string; address: string | null }[];
  now?: number;
}) {
  if (budgets.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No budget figures yet. They appear once the session has been read back from the chain.
      </p>
    );
  }

  return (
    <ul className="space-y-5">
      {budgets.map((b) => {
        const symbol = symbolFor(assets, b.asset);
        const pct = percentUsed(b.spent, b.limit);
        const stale = isStale(b.readAt, now);
        return (
          <li key={b.asset}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-white">{symbol || `${b.asset.slice(0, 10)}…`}</span>
              <span className="text-sm text-white/70">
                {amount(b.remaining, b.asset, symbol)} left of {amount(b.limit, b.asset, symbol)}
              </span>
            </div>

            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${symbol || b.asset} budget used`}
            >
              <div
                className={`h-full ${pct >= 100 ? "bg-white/70" : pct >= 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                style={{ width: `${String(pct)}%` }}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {/* FR-6.4: source and freshness, always, next to the number. */}
              <span className={stale ? "text-amber-300" : "text-white/40"}>
                {b.source}, {freshness(b.readAt, now)}
                {stale ? " — may be out of date" : ""}
              </span>
              <span className="text-white/40">
                {b.usage.used} of {b.usage.limit} runs used
              </span>
            </div>
          </li>
        );
      })}

      <li className="pt-1 text-xs text-white/35">
        Network fees are paid in ETH and are counted separately from these limits.
      </li>
    </ul>
  );
}
