/**
 * The policy diff shown when a new session replaces an old one (FR-11.2).
 *
 * The user has one question at this moment: **am I giving this thing more
 * power than before?** So widenings come first, in full, before anything else
 * — a screen that leads with reassuring narrowings and buries the widening
 * further down is technically complete and practically dishonest.
 *
 * The classification comes from `policyDiff()` in `@corral/core`, which
 * resolves ambiguity toward "widened" for the same reason.
 */
import { policyDiff, type PolicyChange, type RawPolicy } from "@corral/core";

function ChangeList({ changes, tone }: { changes: PolicyChange[]; tone: "wider" | "narrower" }) {
  const wider = tone === "wider";
  return (
    <ul className="space-y-2">
      {changes.map((c) => (
        <li
          key={c.detail}
          className={`rounded-md border p-3 text-sm ${
            wider
              ? c.severity === "high"
                ? "border-red-500/50 bg-red-500/10 text-red-100"
                : "border-amber-500/40 bg-amber-500/5 text-amber-100"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
          }`}
        >
          {c.detail}
          {wider && c.severity === "high" ? (
            <span className="mt-1 block text-xs opacity-80">This removes a protection you had before.</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function PolicyDiff({ from, to }: { from: RawPolicy; to: RawPolicy }) {
  const d = policyDiff(from as Parameters<typeof policyDiff>[0], to as Parameters<typeof policyDiff>[1]);

  if (!d.hasChanges) {
    return (
      <div className="rounded-lg border border-white/10 p-5">
        <p className="text-sm text-white/70">This agent has exactly the same limits as the one it replaces.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="diff-heading" className="space-y-5">
      <h2 id="diff-heading" className="text-xs uppercase tracking-wider text-white/40">
        What changes
      </h2>

      {/* Widenings first, always. */}
      {d.widened.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">This agent gets more power than the old one</h3>
          <ChangeList changes={d.widened} tone="wider" />
        </div>
      ) : (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-100">
          This agent gets no new powers. Everything it can do, the old one could do too.
        </p>
      )}

      {d.narrowed.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">This agent is more limited than the old one</h3>
          <ChangeList changes={d.narrowed} tone="narrower" />
        </div>
      ) : null}

      <p className="text-xs text-white/40">
        Replacing an agent revokes the old one. Revoking does not undo anything it already did.
      </p>
    </section>
  );
}
