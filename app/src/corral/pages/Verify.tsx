/**
 * The public verification view (FR-7.6, journey J5).
 *
 * No authentication, by design. Anyone can check what an account's agents were
 * permitted to do and what they actually did, without taking our word for any
 * of it — the journal entries this renders are on-chain and independently
 * readable. A product whose safety claims can only be checked by trusting the
 * product is not making a safety claim.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { PolicyReview } from "../components/PolicyReview";
import { Empty, ErrorState, Loading } from "../components/States";
import { ApiError, corralApi } from "../lib/api";
import type { RawPolicy } from "@corral/core";

interface PublicSession {
  readonly permissionId: string;
  readonly status: string;
  readonly validAfter: number;
  readonly validUntil: number;
  readonly policy: RawPolicy;
  readonly journal: { seq: number; intentHash: string; txHash: string; status: string }[];
}

export default function Verify() {
  const { address = "" } = useParams();
  const [state, setState] = useState<
    { state: "loading" } | { state: "ready"; sessions: PublicSession[] } | { state: "error"; error: string }
  >({ state: "loading" });

  const load = useCallback(async () => {
    setState({ state: "loading" });
    try {
      const res = await corralApi.verify(address);
      setState({ state: "ready", sessions: res.sessions as PublicSession[] });
    } catch (e) {
      setState({ state: "error", error: e instanceof ApiError ? e.message : "Could not load this account." });
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-white/40">Public record</p>
        <h1 className="font-mono text-sm break-all text-white/80">{address}</h1>
        <p className="max-w-prose text-sm text-white/50">
          Every entry below is recorded on Base and can be checked independently. You do not have to trust Corral to
          read it.
        </p>
      </header>

      {state.state === "loading" ? <Loading what="this account" /> : null}
      {state.state === "error" ? (
        <ErrorState title="We could not load this account" detail={state.error} onRetry={() => void load()} />
      ) : null}
      {state.state === "ready" && state.sessions.length === 0 ? (
        <Empty title="No agents on this account" body="This address has never had a Corral agent installed." />
      ) : null}

      {state.state === "ready"
        ? state.sessions.map((s) => (
            <section key={s.permissionId} className="space-y-5 rounded-lg border border-white/10 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs break-all text-white/50">{s.permissionId}</span>
                <span className="text-xs uppercase tracking-wider text-white/40">{s.status}</span>
              </div>

              <PolicyReview policy={s.policy} />

              <div>
                <h3 className="text-xs uppercase tracking-wider text-white/40">On-chain journal</h3>
                {s.journal.length === 0 ? (
                  <p className="mt-2 text-sm text-white/50">This agent never executed anything.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {s.journal.map((j) => (
                      <li key={j.txHash} className="flex flex-wrap gap-x-3 font-mono text-[11px] text-white/50">
                        <span>#{j.seq}</span>
                        <a
                          href={`https://sepolia.basescan.org/tx/${j.txHash}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all underline hover:text-white/80"
                        >
                          {j.txHash}
                        </a>
                        <span>{j.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))
        : null}
    </div>
  );
}
