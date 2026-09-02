/**
 * Empty, loading, stale, error and ended states (FR-11.7).
 *
 * "No spinner-only states" is the requirement, and it is a real one: a spinner
 * says "wait" and nothing else, so a user staring at one cannot tell whether
 * their agent is fine, broken, or has quietly stopped. Every state here says
 * what is true and what, if anything, to do about it.
 */
import type { ReactNode } from "react";

export function Panel({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "bad" }) {
  const border =
    tone === "bad" ? "border-red-500/40 bg-red-500/5" : tone === "warn" ? "border-amber-500/40 bg-amber-500/5" : "border-white/10 bg-white/[0.02]";
  return <div className={`rounded-lg border ${border} p-5`}>{children}</div>;
}

export function Loading({ what }: { what: string }) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" aria-hidden />
        {/* Named, not anonymous: "Loading" alone tells the user nothing. */}
        <p className="text-sm text-white/70">Reading {what} from the chain…</p>
      </div>
    </Panel>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Panel>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 max-w-prose text-sm text-white/60">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Panel>
  );
}

/**
 * A failed read.
 *
 * Says whether the user's money is affected, because that is the first thing
 * anyone wants to know when a screen breaks — and for a read failure the
 * answer is always no.
 */
export function ErrorState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <Panel tone="bad">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 max-w-prose text-sm text-white/70">{detail}</p>
      <p className="mt-2 text-sm text-white/50">
        This is a problem reading data, not with your agent. Your limits are enforced on-chain and are unaffected.
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          Try again
        </button>
      ) : null}
    </Panel>
  );
}

/**
 * A reading old enough to act on carefully.
 *
 * Shown rather than hidden: a stale number presented as current is worse than
 * no number, because the user acts on it.
 */
export function Stale({ age, children }: { age: string; children?: ReactNode }) {
  return (
    <Panel tone="warn">
      <p className="text-sm text-white/80">
        These figures were last read from the chain <strong>{age}</strong>. They may be out of date.
      </p>
      {children}
    </Panel>
  );
}

/** A session that has stopped, for a reason the user should be able to read. */
export function Ended({ status }: { status: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    REVOKED: {
      title: "This agent has been revoked",
      body: "It cannot spend anything. Revoking does not undo trades that already happened and does not move money — your funds stayed in your account the whole time.",
    },
    EXPIRED: {
      title: "This agent's permission has ended",
      body: "The end date you set has passed, so it stopped on its own. Nothing needs your attention.",
    },
    PAUSED_MISMATCH: {
      title: "Paused: the on-chain limits do not match what you signed",
      body: "We stopped this agent rather than continue. No money has moved. This needs a human to look at it before it runs again.",
    },
    PAUSED_DRIFT: {
      title: "Paused: our records disagree with the chain",
      body: "We stopped this agent rather than guess which side is right. The chain is authoritative for your money; your limits still hold.",
    },
    PAUSED_MODULE_CHANGE: {
      title: "Paused: your account's modules changed",
      body: "Something was installed or removed on your account. We stopped this agent until you confirm that was you.",
    },
    INSTALL_FAILED: {
      title: "This agent was never activated",
      body: "Setup did not complete, so it was never able to spend anything.",
    },
  };
  const c = copy[status] ?? {
    title: "This agent is not running",
    body: `Current status: ${status}.`,
  };
  return (
    <Panel tone={status.startsWith("PAUSED") ? "warn" : "neutral"}>
      <h3 className="text-base font-semibold text-white">{c.title}</h3>
      <p className="mt-1 max-w-prose text-sm text-white/70">{c.body}</p>
    </Panel>
  );
}
