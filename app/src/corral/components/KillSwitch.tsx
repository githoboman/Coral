/**
 * The kill switch (FR-11.4, FR-8.1/8.2/8.4).
 *
 * Reachable in one tap from every authenticated screen — mounted in the
 * layout, not on a page — because the moment a user wants this is the moment
 * they are least willing to navigate.
 *
 * The flow it implements is the honest one:
 *
 *  1. Press it and Corral disables the off-chain signer **immediately**, before
 *     anything on-chain. That is the sub-second part (NFR-3), and it is what
 *     stops anything new being signed.
 *  2. Corral then hands back a transaction for the OWNER to send. We cannot
 *     revoke on their behalf and hold no key that could — which is the whole
 *     custody claim, visible right here in the flow.
 *  3. The confirmation states plainly what revoke does NOT do (FR-8.4).
 *
 * If this component, the API, or the entire service is down, the standalone
 * page at /revoke still works (FR-8.3). That link is shown here, always, not
 * only on failure — a fallback nobody knows about is not a fallback.
 */
import { useState } from "react";

import { ApiError, corralApi, type RevokeTicket } from "../lib/api";

type Phase = "idle" | "confirming" | "disabling" | "ready" | "failed";

export function KillSwitch({
  sessionId,
  onSend,
  compact = false,
}: {
  sessionId: string;
  /** Send the owner transaction with the connected wallet. */
  onSend?: (tx: RevokeTicket["ownerTransaction"]) => Promise<void>;
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ticket, setTicket] = useState<RevokeTicket | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function begin(): Promise<void> {
    setPhase("disabling");
    setError(null);
    try {
      const t = await corralApi.prepareRevoke(sessionId);
      setTicket(t);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach Corral.");
      setPhase("failed");
    }
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={() => setPhase("confirming")}
        className={
          compact
            ? "rounded-md border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/10"
            : "w-full rounded-lg border border-red-500/50 px-4 py-3 text-base font-semibold text-red-300 hover:bg-red-500/10"
        }
      >
        Stop this agent
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-5">
      {phase === "confirming" ? (
        <>
          <h3 className="text-base font-semibold text-white">Stop this agent?</h3>
          <p className="mt-2 max-w-prose text-sm text-white/75">
            We will stop it from signing anything straight away — that part does not wait for the blockchain. Then you
            sign one transaction to end its permission on-chain.
          </p>
          {/* FR-8.4, stated before the action, not after. */}
          <ul className="mt-3 space-y-1 text-sm text-white/60">
            <li>This does not undo trades that already happened.</li>
            <li>This does not move any of your money.</li>
            <li>Your funds are in your own account, and stay there.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void begin()}
              className="rounded-md bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Yes, stop it
            </button>
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="rounded-md border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {phase === "disabling" ? <p className="text-sm text-white/80">Stopping the agent from signing…</p> : null}

      {phase === "ready" && ticket ? (
        <>
          <h3 className="text-base font-semibold text-white">Signing is already stopped</h3>
          <p className="mt-2 max-w-prose text-sm text-white/75">
            The agent can no longer sign anything. To end its permission on-chain as well, send this transaction from
            your own wallet.
          </p>
          <p className="mt-2 max-w-prose text-sm text-white/50">{ticket.disclosure}</p>
          {onSend ? (
            <button
              type="button"
              onClick={() => void onSend(ticket.ownerTransaction)}
              className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              Send the transaction
            </button>
          ) : null}
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-white/50">Show the transaction</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-[11px] text-white/70">
              {JSON.stringify(ticket.ownerTransaction, null, 2)}
            </pre>
          </details>
        </>
      ) : null}

      {phase === "failed" ? (
        <>
          <h3 className="text-base font-semibold text-white">We could not reach Corral</h3>
          <p className="mt-2 max-w-prose text-sm text-white/75">{error}</p>
          <p className="mt-2 max-w-prose text-sm text-white/75">
            Use the standalone page below. It does not need Corral to be working at all.
          </p>
        </>
      ) : null}

      {/* Always visible. A fallback nobody knows about is not a fallback. */}
      <p className="mt-5 border-t border-white/10 pt-4 text-xs text-white/45">
        If Corral is ever down, you can revoke from{" "}
        <a href="/revoke" className="underline hover:text-white/70">
          the standalone page
        </a>
        . It works with nothing but your wallet and a public Base node.
      </p>
    </div>
  );
}
