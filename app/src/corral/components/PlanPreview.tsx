/**
 * Plan preview (FR-11.5): the next three runs, before you commit.
 *
 * A schedule is as much a commitment as a budget, and far harder to picture.
 * "Weekly, 125 USDC, for 30 days" is abstract; three dated rows with amounts
 * on them are not.
 *
 * The heading says "expects to", not "will". Every row carries its own caveat
 * from the server, because a preview that reads as a promise is a preview that
 * will eventually be wrong in a way the user feels entitled to complain about.
 */
export interface PreviewRun {
  readonly scheduledFor: string;
  readonly seq: number;
  readonly amountIn: string | null;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly caveat: string;
}

export interface StrategyPreview {
  readonly strategyId: string;
  readonly kind: string;
  readonly runs: PreviewRun[];
  readonly runsRemaining: number | null;
}

function amountText(run: PreviewRun, format: (base: string) => string): string {
  return run.amountIn === null ? `Some of your ${run.assetIn}` : `${format(run.amountIn)} ${run.assetIn}`;
}

export function PlanPreview({
  strategies,
  format,
}: {
  strategies: readonly StrategyPreview[];
  /** Base units → display, supplied by the caller so scale is never guessed. */
  format: (base: string) => string;
}) {
  if (strategies.length === 0) return null;

  return (
    <section aria-labelledby="preview-heading" className="space-y-4">
      <h2 id="preview-heading" className="text-xs uppercase tracking-wider text-white/40">
        What it expects to do next
      </h2>

      {strategies.map((s) => (
        <div key={s.strategyId} className="rounded-lg border border-white/10 p-5">
          {s.runs.length === 0 ? (
            <p className="text-sm text-white/60">
              No more runs are expected — this agent has reached its limit or its end date.
            </p>
          ) : (
            <>
              <ol className="space-y-3">
                {s.runs.map((r) => (
                  <li key={r.seq} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm text-white/90">
                        {amountText(r, format)} <span className="text-white/50">→ {r.assetOut}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">{r.caveat}</p>
                    </div>
                    <time className="text-xs text-white/50" dateTime={r.scheduledFor}>
                      {new Date(r.scheduledFor).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
              {s.runsRemaining !== null ? (
                <p className="mt-4 text-xs text-white/40">
                  {s.runsRemaining} run{s.runsRemaining === 1 ? "" : "s"} left under this agent&rsquo;s limit.
                </p>
              ) : null}
            </>
          )}
        </div>
      ))}

      <p className="text-xs text-white/40">
        These are projections, not promises. Prices move, budgets run down, and conditions may not hold.
      </p>
    </section>
  );
}
