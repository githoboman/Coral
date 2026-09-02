/**
 * The policy review screen (FR-11.1) — the screen the product rests on.
 *
 * Everything rendered here comes from `policySummary()` in `@corral/core`.
 * That is the requirement, not a preference: the sentence a user reads before
 * signing has to be produced by the same code that validates the configuration
 * going on-chain, or it is just a second description that is free to drift
 * from what is actually enforced.
 *
 * So this component contains no rules. It arranges sentences. If a caption
 * here disagreed with the policy, the fix would be in core.
 */
import type { PolicySummary, RawPolicy } from "@corral/core";

import { summarise } from "../lib/display";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-white/5 py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-xs uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="text-sm text-white/90">{children}</dd>
    </div>
  );
}

export function PolicyReview({ policy, summary }: { policy?: RawPolicy; summary?: PolicySummary }) {
  const s = summary ?? (policy ? summarise(policy) : null);
  if (!s) return null;

  return (
    <section aria-labelledby="worst-case-heading" className="space-y-6">
      {/* The worst case, first and largest. If a user reads one thing, this. */}
      <div className="rounded-lg border border-white/15 bg-white/[0.03] p-6">
        <h2 id="worst-case-heading" className="text-xs uppercase tracking-wider text-white/40">
          The worst that can happen
        </h2>
        <p className="mt-3 text-lg leading-relaxed text-white">{s.worstCase}</p>
      </div>

      {/* Warnings before details: anything that deserves a second look should
          be seen before the reader settles into the table below. */}
      {s.warnings.length > 0 ? (
        <ul className="space-y-2" aria-label="Things to check">
          {s.warnings.map((w) => (
            <li key={w} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-100">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="rounded-lg border border-white/10 p-5">
        <Row label="Can spend">
          <ul className="space-y-1">
            {s.spendCaps.map((c) => (
              <li key={c.address ?? "native"}>
                <span className="font-medium">{c.display}</span> in total
                {c.perExecutionDisplay ? <span className="text-white/50"> · at most {c.perExecutionDisplay} per run</span> : null}
              </li>
            ))}
            {s.spendCaps.length === 0 ? <li className="text-white/50">Nothing — this agent has no budget.</li> : null}
          </ul>
        </Row>

        <Row label="Can send to">
          {s.destinations.kind === "account-only" ? (
            <span>Only your own account.</span>
          ) : s.destinations.kind === "allowlist" ? (
            <ul className="space-y-1">
              {s.destinations.addresses.map((a) => (
                <li key={a} className="font-mono text-xs break-all">
                  {a}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-amber-200">Any address. Check this is what you meant.</span>
          )}
        </Row>

        <Row label="Can use">
          <ul className="space-y-1">
            {s.venues.map((v) => (
              <li key={`${v.address}-${v.selector}`}>
                <span className="font-medium">{v.label}</span>
                <span className="text-white/50"> · {v.action.toLowerCase()}</span>
                {/* The address is always shown: a label is display only, and a
                    hostile one must not be able to stand in for identity. */}
                <div className="font-mono text-[11px] break-all text-white/35">{v.address}</div>
              </li>
            ))}
          </ul>
        </Row>

        <Row label="Native currency">{s.usage.maxNativeDisplay}</Row>

        <Row label="How often">
          At most {s.usage.maxExecutions} times in total, and no more than {s.usage.maxPer24h} in any 24 hours.
        </Row>

        <Row label="Price floor">Every trade must return at least {s.usage.minOutputPct}% of the quoted amount.</Row>

        <Row label="Runs until">
          {s.window.endsAt} <span className="text-white/50">({s.window.days} days)</span>
        </Row>
      </dl>

      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-5">
        <h3 className="text-xs uppercase tracking-wider text-emerald-300/70">What this guarantees</h3>
        <ul className="mt-3 space-y-2 text-sm text-white/85">
          {s.guarantees.map((g) => (
            <li key={g} className="flex gap-2">
              <span aria-hidden className="text-emerald-400">
                ✓
              </span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* The full rendering, for anyone who wants to read it as prose. */}
      <details className="rounded-lg border border-white/10 p-5">
        <summary className="cursor-pointer text-sm text-white/70">Read this in full</summary>
        <ul className="mt-3 space-y-2 text-sm text-white/80">
          {s.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
