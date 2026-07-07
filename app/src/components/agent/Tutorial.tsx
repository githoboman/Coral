import { useState, useEffect } from "react";
import { FiX, FiUser, FiCpu, FiShield, FiZap, FiArrowRight, FiArrowLeft, FiDownloadCloud } from "react-icons/fi";

/**
 * First-run tutorial. A short, dismissible walkthrough that teaches the ONE thing
 * users keep missing: Coral has TWO wallets, and the agent's wallet is a separate
 * account that must be funded. Shown once (persisted to localStorage); can be
 * reopened from the "?" help button.
 */
const SEEN_KEY = "coral_tutorial_seen_v1";

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}
export function markTutorialSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface Step {
  icon: React.ReactNode;
  tone: "brand" | "ink";
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: <FiZap />,
    tone: "brand",
    title: "Welcome to Coral",
    body: (
      <>
        Coral is an AI agent that <b>trades on Sui for you</b> — you set limits once, and they're
        enforced on-chain. Let's cover the one thing that trips people up: <b>there are two wallets.</b>
      </>
    ),
  },
  {
    icon: <FiUser />,
    tone: "ink",
    title: "1 · Your Wallet",
    body: (
      <>
        The wallet you connect. <b>You</b> use it to <b>create the policy</b> and to <b>revoke</b> —
        that's it. You sign those two actions yourself. It holds your own funds; the agent never
        touches it.
      </>
    ),
  },
  {
    icon: <FiCpu />,
    tone: "brand",
    title: "2 · The Agent Wallet",
    body: (
      <>
        A <b>separate on-chain wallet the agent controls.</b> DeepBook trades are signed from{" "}
        <b>this</b> wallet automatically — no approval per swap. That's the autonomy.{" "}
        <b className="text-[#FF6B00]">It needs its own SUI for gas + trading.</b>
      </>
    ),
  },
  {
    icon: <FiDownloadCloud />,
    tone: "brand",
    title: "3 · Fund the Agent Wallet",
    body: (
      <>
        Open the <b>wallet drawer</b> (top-right), find the <b>Agent Wallet</b> card, and hit{" "}
        <b>Receive</b> to get its address + QR — then send it some testnet SUI. Funding <i>your</i>{" "}
        wallet won't work; the agent trades from its own.
      </>
    ),
  },
  {
    icon: <FiShield />,
    tone: "ink",
    title: "4 · Set a policy, then instruct",
    body: (
      <>
        Create a <b>policy</b> (budget, tokens, expiry) — your only signature. Then just tell the
        agent in plain language: <i>"Swap 1 SUI to USDC."</i> Revoke any time and it stops instantly.
      </>
    ),
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    markTutorialSeen();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-[28px] border border-line bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.35)] overflow-hidden whisk-pop">
        {/* Close */}
        <button
          onClick={finish}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer z-10"
          title="Skip"
        >
          <FiX className="w-4 h-4" />
        </button>

        {/* Icon banner */}
        <div className="flex items-center justify-center pt-10 pb-2">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center text-[28px] ${
              step.tone === "brand" ? "bg-[var(--brand-dim)] text-[var(--brand)]" : "bg-ink/10 text-ink"
            }`}
          >
            {step.icon}
          </div>
        </div>

        {/* Content */}
        <div className="px-8 pb-6 text-center">
          <h2 className="text-[20px] font-bold text-ink mb-2">{step.title}</h2>
          <p className="text-[14px] leading-relaxed text-muted">{step.body}</p>
        </div>

        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5 pb-5">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-[var(--brand)]" : "w-1.5 bg-line hover:bg-line-strong"
              }`}
              aria-label={`Step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button
            onClick={() => (i === 0 ? finish() : setI(i - 1))}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink transition-colors cursor-pointer"
          >
            {i === 0 ? "Skip" : <><FiArrowLeft className="w-3.5 h-3.5" /> Back</>}
          </button>
          <button
            onClick={() => (last ? finish() : setI(i + 1))}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] text-white text-[14px] font-bold px-5 py-2.5 shadow-md hover:bg-[var(--brand-hover)] transition-all active:scale-[0.97] cursor-pointer"
          >
            {last ? "Got it" : <>Next <FiArrowRight className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
