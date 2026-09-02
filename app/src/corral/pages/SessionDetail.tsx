/**
 * One agent: what it may do, what it has done, and how to stop it.
 *
 * Order is deliberate: what is left, then what is coming, then what it may do,
 * then what it has done. Someone opening this page in a hurry is far more
 * likely to be worried than curious, so the numbers that answer "how exposed
 * am I right now" come first. The kill switch is not on this page at all — it
 * is in the shell header, one tap away from here and from everywhere else
 * (FR-11.4).
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ActivityFeed } from "../components/ActivityFeed";
import { BudgetMeters } from "../components/BudgetMeters";
import { PlanPreview, type StrategyPreview } from "../components/PlanPreview";
import { PolicyReview } from "../components/PolicyReview";
import { Empty, ErrorState, Loading, Ended } from "../components/States";
import { API_BASE, ApiError, corralApi, type ExecutionView, type SessionView } from "../lib/api";
import { amount } from "../lib/display";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

export default function SessionDetail() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<Load<SessionView>>({ state: "loading" });
  const [executions, setExecutions] = useState<Load<ExecutionView[]>>({ state: "loading" });
  const [upcoming, setUpcoming] = useState<StrategyPreview[]>([]);

  const load = useCallback(async () => {
    setSession({ state: "loading" });
    try {
      setSession({ state: "ready", data: await corralApi.session(id) });
    } catch (e) {
      setSession({ state: "error", error: e instanceof ApiError ? e.message : "Could not load this agent." });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/corral/sessions/${id}/upcoming`, { credentials: "include" });
      if (res.ok) setUpcoming(((await res.json()) as { strategies: StrategyPreview[] }).strategies);
    } catch {
      // A missing preview is a missing nicety, not a broken page.
    }
    try {
      setExecutions({ state: "ready", data: await corralApi.executions(id) });
    } catch (e) {
      // The feed failing must not take the safety-critical half of the page
      // with it: the meters and the kill switch stay usable.
      setExecutions({ state: "error", error: e instanceof ApiError ? e.message : "Could not load the history." });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (session.state === "loading") return <Loading what="this agent" />;
  if (session.state === "error") {
    return <ErrorState title="We could not load this agent" detail={session.error} onRetry={() => void load()} />;
  }

  const s = session.data;
  const assets = s.policy.asset_scope.map((a) => ({ symbol: a.symbol, address: a.address }));
  const running = s.status === "ACTIVE" && !s.signerDisabled;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-white/40">Agent</p>
        <h1 className="font-mono text-sm break-all text-white/80">{s.account}</h1>
        {!running ? <Ended status={s.signerDisabled && s.status === "ACTIVE" ? "REVOKED" : s.status} /> : null}
      </header>

      {/* The kill switch lives in the shell header, one tap from here and
          from every other screen in this area (FR-11.4). */}

      <section aria-labelledby="budget-heading" className="space-y-4">
        <h2 id="budget-heading" className="text-xs uppercase tracking-wider text-white/40">
          What is left
        </h2>
        <BudgetMeters budgets={s.budgets} assets={assets} />
      </section>

      {running && upcoming.length > 0 ? (
        <PlanPreview
          strategies={upcoming}
          format={(base) => amount(base, assets[0]?.address ?? null).replace(/ .*$/, "")}
        />
      ) : null}

      <section aria-labelledby="policy-heading" className="space-y-4">
        <h2 id="policy-heading" className="text-xs uppercase tracking-wider text-white/40">
          What it is allowed to do
        </h2>
        <PolicyReview policy={s.policy} />
      </section>

      <section aria-labelledby="activity-heading" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="activity-heading" className="text-xs uppercase tracking-wider text-white/40">
            What it has done
          </h2>
          <a href={corralApi.csvUrl(s.id)} className="text-xs text-white/50 underline hover:text-white/80">
            Download as CSV
          </a>
        </div>

        {executions.state === "loading" ? <Loading what="the history" /> : null}
        {executions.state === "error" ? (
          <ErrorState title="We could not load the history" detail={executions.error} onRetry={() => void load()} />
        ) : null}
        {executions.state === "ready" && executions.data.length === 0 ? (
          <Empty
            title="Nothing has run yet"
            body="When this agent trades, every attempt shows up here — including the ones that were stopped, and why."
          />
        ) : null}
        {executions.state === "ready" && executions.data.length > 0 ? (
          <ActivityFeed executions={executions.data} assets={assets} />
        ) : null}
      </section>
    </div>
  );
}
