import { FiShield, FiClock, FiList, FiDroplet, FiZap } from "react-icons/fi";

/**
 * Single source of truth for the "how Coral works" explainer — the policy
 * settings (with real SUI amounts/limits) and every agent task. Rendered in two
 * places: an expandable section on the landing page (variant="dark") and a help
 * popup inside the dashboard (variant="app"). Content matches the actual policy
 * fields (budget/assets/expiry/gas) and intent actions (TradeIntentSchema).
 */

export interface PolicyField {
  name: string;
  what: string;
  detail: string;
  example: string;
}

export const POLICY_FIELDS: PolicyField[] = [
  {
    name: "Budget Cap",
    what: "The most the agent can ever spend, total.",
    detail:
      "Denominated in the spent token's base units. SUI has 9 decimals, so 1 SUI = 1,000,000,000. The Move contract sums every trade's spend and aborts any action that would push past this cap — it cannot be exceeded, even by a compromised server.",
    example: "50 SUI → 50000000000",
  },
  {
    name: "Allowed Tokens",
    what: "The only assets the agent may touch.",
    detail:
      "A whitelist (e.g. SUI, USDC). Any token not on this list is mathematically blocked on-chain — the agent literally cannot trade it, regardless of what it's instructed.",
    example: "SUI, USDC",
  },
  {
    name: "Expiry",
    what: "When the delegation automatically ends.",
    detail:
      "The policy is time-gated by the on-chain Clock. After expiry the agent can no longer act — no manual revoke needed. A countdown shows in the header while active.",
    example: "24 hours",
  },
  {
    name: "Gas Reserve",
    what: "SUI kept aside so the agent can always pay fees.",
    detail:
      "Base units of SUI reserved for transaction gas, so the agent can keep signing actions (and you can always revoke). Separate from the trading budget.",
    example: "0.1 SUI → 100000000",
  },
];

export interface WalletInfo {
  name: string;
  who: string;
  detail: string;
}

export const WALLETS: WalletInfo[] = [
  {
    name: "Your Wallet",
    who: "The wallet you connect (you sign)",
    detail:
      "You use it to create the policy and to revoke — that's it. You sign those two actions once each. It holds your own funds; the agent never touches it.",
  },
  {
    name: "Agent Wallet",
    who: "The agent's own account (it signs autonomously)",
    detail:
      "A separate on-chain wallet the agent controls. DeepBook trades are signed FROM this wallet with no approval from you — that's the autonomy. It needs a little SUI for gas, so fund it from the wallet drawer (Receive shows its address + QR).",
  },
];

export interface AgentTask {
  icon: React.ReactNode;
  name: string;
  prompt: string;
  detail: string;
}

export const AGENT_TASKS: AgentTask[] = [
  {
    icon: <FiZap />,
    name: "Market Swap",
    prompt: "“Swap 1 SUI to USDC.”",
    detail: "Swaps a fixed amount immediately at the current DeepBook market price.",
  },
  {
    icon: <FiDroplet />,
    name: "Percentage Swap",
    prompt: "“Swap 30% of my SUI to USDC.”",
    detail: "Computes a percentage of the agent's live balance, then swaps that amount at market.",
  },
  {
    icon: <FiList />,
    name: "Limit Order",
    prompt: "“Buy 10 SUI at 0.20.”",
    detail: "Places a resting DeepBook limit order at your target price; it fills only when the market reaches it.",
  },
  {
    icon: <FiShield />,
    name: "Conditional Swap",
    prompt: "“Buy SUI if it drops below 0.20.”",
    detail: "Watches the DeepBook mid-price and executes once, automatically, the moment your condition is met.",
  },
  {
    icon: <FiClock />,
    name: "Scheduled Swap",
    prompt: "“Swap 5 SUI to USDC at 15:00 UTC.”",
    detail: "Fires at a target time. The on-chain Clock gate enforces ‘not before’, so it can't run early.",
  },
  {
    icon: <FiList />,
    name: "Cancel",
    prompt: "“Cancel my open orders.”",
    detail: "Cancels the agent's resting orders and frees the reserved budget.",
  },
];

export function CoralGuide({ variant = "app" }: { variant?: "app" | "dark" }) {
  const dark = variant === "dark";
  const card = dark
    ? "bg-white/[0.03] border-white/10"
    : "bg-surface-3 border-line";
  const heading = dark ? "text-white" : "text-ink";
  const sub = dark ? "text-white/50" : "text-muted";
  const body = dark ? "text-white/70" : "text-ink/80";
  const mono = dark ? "text-[#FF9472]" : "text-brand";
  const sectionLabel = dark ? "text-white/40" : "text-faint";

  return (
    <div className="space-y-8 text-left">
      {/* Step overview */}
      <div>
        <p className={`text-[12px] font-bold uppercase tracking-wider mb-3 ${sectionLabel}`}>
          The flow
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { n: "1", t: "Set a policy", d: "Define budget, tokens, expiry. Sign once — this is your only approval." },
            { n: "2", t: "Instruct in words", d: "Tell the agent what to do in plain language. It parses and checks your policy." },
            { n: "3", t: "It acts on-chain", d: "Real DeepBook trades execute. Revoke any time and it stops instantly." },
          ].map((s) => (
            <div key={s.n} className={`rounded-2xl border p-4 ${card}`}>
              <div className={`w-6 h-6 rounded-full text-[12px] font-bold flex items-center justify-center mb-2 ${dark ? "bg-[#FF6A4D]/15 text-[#FF9472]" : "bg-brand/15 text-brand"}`}>
                {s.n}
              </div>
              <div className={`text-[13px] font-semibold mb-0.5 ${heading}`}>{s.t}</div>
              <div className={`text-[12px] leading-snug ${sub}`}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two wallets */}
      <div>
        <p className={`text-[12px] font-bold uppercase tracking-wider mb-3 ${sectionLabel}`}>
          Two wallets — how they differ
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {WALLETS.map((w, i) => (
            <div key={w.name} className={`rounded-2xl border p-4 ${i === 1 ? (dark ? "border-[#FF6A4D]/30 bg-[#FF6A4D]/[0.06]" : "border-brand/30 bg-brand/[0.05]") : card}`}>
              <div className={`text-[14px] font-bold mb-0.5 ${heading}`}>{w.name}</div>
              <div className={`text-[12px] font-semibold mb-1.5 ${mono}`}>{w.who}</div>
              <div className={`text-[12px] leading-relaxed ${sub}`}>{w.detail}</div>
            </div>
          ))}
        </div>
        <p className={`text-[12px] leading-relaxed mt-3 ${body}`}>
          <span className="font-semibold">Why two?</span> For the agent to trade on its own without
          asking you to sign every swap, it needs its own key. Your policy is the on-chain leash that
          keeps it safe.
        </p>
      </div>

      {/* Policy settings */}
      <div>
        <p className={`text-[12px] font-bold uppercase tracking-wider mb-3 ${sectionLabel}`}>
          Your policy — the on-chain rules
        </p>
        <div className="space-y-2.5">
          {POLICY_FIELDS.map((f) => (
            <div key={f.name} className={`rounded-2xl border p-4 ${card}`}>
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className={`text-[14px] font-bold ${heading}`}>{f.name}</span>
                <span className={`text-[11px] font-mono font-bold ${mono}`}>{f.example}</span>
              </div>
              <div className={`text-[13px] font-medium mb-1 ${heading} opacity-90`}>{f.what}</div>
              <div className={`text-[12px] leading-relaxed ${sub}`}>{f.detail}</div>
            </div>
          ))}
        </div>
        <p className={`text-[12px] leading-relaxed mt-3 ${body}`}>
          <span className="font-semibold">How much SUI do I need?</span> The agent is its own
          on-chain wallet, so fund it with a little SUI for gas (≈0.1 SUI is plenty for a demo).
          Your <span className="font-semibold">Budget Cap</span> is the spending limit; the demo
          defaults to 50 SUI so swaps fit comfortably.
        </p>
      </div>

      {/* Agent tasks */}
      <div>
        <p className={`text-[12px] font-bold uppercase tracking-wider mb-3 ${sectionLabel}`}>
          What you can ask the agent to do
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {AGENT_TASKS.map((t) => (
            <div key={t.name} className={`rounded-2xl border p-4 ${card}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[15px] ${mono}`}>{t.icon}</span>
                <span className={`text-[14px] font-bold ${heading}`}>{t.name}</span>
              </div>
              <div className={`text-[12.5px] font-medium mb-1 ${heading} opacity-90`}>{t.prompt}</div>
              <div className={`text-[12px] leading-relaxed ${sub}`}>{t.detail}</div>
            </div>
          ))}
        </div>
        <p className={`text-[12px] leading-relaxed mt-3 ${body}`}>
          Every one of these is checked against your policy <span className="font-semibold">on-chain before it runs</span> —
          budget, token whitelist, and expiry. If a request violates the policy, the contract aborts it.
        </p>
      </div>
    </div>
  );
}
