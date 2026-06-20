import { useState } from "react";
import {
  Shield,
  Pause,
  Play,
  Ban,
  Bell,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Wallet,
  Sparkles,
  Send,
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  useAgentWallet,
  type CreatePolicyForm,
  type AgentAlert,
  type IntentResult,
  type DeepBookSetup,
} from "@/hooks/useAgentWallet";

// Default DeepBook setup for the demo — the agent's bootstrapped BalanceManager on
// the testnet SUI/DBUSDC pool. Override via env if a different manager is used.
const DEMO_DEEPBOOK = (agentAddress: string): DeepBookSetup => ({
  agentAddress,
  balanceManagerId:
    import.meta.env.VITE_AGENT_BALANCE_MANAGER ||
    "0xb79410bd70cc766ae137e1e74db412934d4a13678b8b6c67115d26814451ad93",
  poolKey: "SUI_DBUSDC",
});

const EXAMPLE_PROMPTS = [
  "Swap 1 SUI to USDC",
  "Swap 30% of my SUI to USDC",
  "Buy SUI if it drops below 0.20",
];

const ASSET_OPTIONS = ["SUI", "USDC"] as const;

const ALERT_ICON: Record<AgentAlert["level"], React.ReactNode> = {
  info: <Info className="w-4 h-4 text-blue-400" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  error: <XCircle className="w-4 h-4 text-red-400" />,
  success: <CheckCircle2 className="w-4 h-4 text-green-400" />,
};

/**
 * Owner-facing control surface for the Autonomous Agent Wallet (PRD §7). Lets the
 * owner initialize the agent, create a policy (budget/assets/expiry), pause/resume,
 * revoke, and watch the live alert feed. All on-chain mutations are signed by the
 * connected owner wallet via dapp-kit; agent actions run server-side.
 */
export function AgentControls() {
  const {
    account,
    status,
    alerts,
    busy,
    error,
    initWallet,
    createPolicy,
    pause,
    resume,
    revoke,
    sendIntent,
  } = useAgentWallet();

  const [instruction, setInstruction] = useState("");
  const [lastResult, setLastResult] = useState<IntentResult | null>(null);

  const runInstruction = async (text: string) => {
    if (!text.trim() || !status?.agentAddress) return;
    try {
      const result = await sendIntent(text, DEMO_DEEPBOOK(status.agentAddress));
      setLastResult(result);
      setInstruction("");
    } catch {
      /* error surfaced via hook */
    }
  };

  const [form, setForm] = useState<CreatePolicyForm>({
    budgetCap: "500000000", // 500 USDC at 6 decimals, as an example default
    allowedAssets: ["SUI", "USDC"],
    expiryHours: 24,
    gasReserve: "100000000",
  });

  if (!account?.address) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
        Connect your wallet to manage the autonomous agent.
      </div>
    );
  }

  const toggleAsset = (a: string) =>
    setForm((f) => ({
      ...f,
      allowedAssets: f.allowedAssets.includes(a)
        ? f.allowedAssets.filter((x) => x !== a)
        : [...f.allowedAssets, a],
    }));

  const bound = status?.bound ?? false;

  return (
    <div className="space-y-4">
      {/* Header / wallet identity */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-violet-400" />
          <h3 className="text-base font-semibold text-white">Agent Controls</h3>
        </div>

        {status ? (
          <div className="space-y-1 text-xs text-white/70">
            <div className="flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5" />
              <span className="font-mono truncate">{status.agentAddress}</span>
            </div>
            <div>
              Policy:{" "}
              {bound ? (
                <span className="text-green-400 font-mono">{status.policyId?.slice(0, 10)}…</span>
              ) : (
                <span className="text-amber-400">not created</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/60">No agent wallet yet.</span>
            <button
              onClick={() => initWallet()}
              disabled={busy !== "idle"}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "init" ? "Initializing…" : "Initialize agent"}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Policy creation — shown once a wallet exists but no policy is bound */}
      {status && !bound && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-white">Create policy</h4>

          <label className="block text-xs text-white/70">
            Budget cap (base units)
            <input
              value={form.budgetCap}
              onChange={(e) => setForm({ ...form, budgetCap: e.target.value.replace(/\D/g, "") })}
              className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white"
              inputMode="numeric"
            />
          </label>

          <div className="text-xs text-white/70">
            Allowed assets
            <div className="mt-1 flex gap-2">
              {ASSET_OPTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => toggleAsset(a)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                    form.allowedAssets.includes(a)
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-black/20 border-white/10 text-white/60"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs text-white/70">
            Expiry (hours)
            <input
              type="number"
              value={form.expiryHours}
              onChange={(e) => setForm({ ...form, expiryHours: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white"
              min={1}
            />
          </label>

          <label className="block text-xs text-white/70">
            Gas reserve (base units)
            <input
              value={form.gasReserve}
              onChange={(e) => setForm({ ...form, gasReserve: e.target.value.replace(/\D/g, "") })}
              className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white"
              inputMode="numeric"
            />
          </label>

          <p className="text-[11px] text-white/40">
            Protocol is restricted to DeepBook. The agent can swap, place limit orders,
            and cancel within these limits until expiry.
          </p>

          <button
            onClick={() => createPolicy(form)}
            disabled={busy !== "idle" || form.allowedAssets.length === 0}
            className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy === "creating" || busy === "binding" ? (
              <>
                <LoadingSpinner /> {busy === "binding" ? "Binding…" : "Sign in wallet…"}
              </>
            ) : (
              "Create policy & delegate"
            )}
          </button>
        </div>
      )}

      {/* Natural-language command — the agentic centerpiece. Type an instruction,
          the agent parses it, validates against policy, and acts. */}
      {bound && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h4 className="text-sm font-semibold text-white">Instruct the agent</h4>
          </div>

          <div className="flex gap-2">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runInstruction(instruction)}
              placeholder="e.g. swap 30% of my SUI to USDC"
              disabled={busy !== "idle"}
              className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-violet-500/50 outline-none"
            />
            <button
              onClick={() => runInstruction(instruction)}
              disabled={busy !== "idle" || !instruction.trim()}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 px-3 text-white disabled:opacity-50 flex items-center justify-center"
            >
              {busy === "thinking" ? <LoadingSpinner /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          {/* Example prompts for the demo */}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => runInstruction(p)}
                disabled={busy !== "idle"}
                className="rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-[11px] text-white/60 disabled:opacity-40"
              >
                {p}
              </button>
            ))}
          </div>

          {/* What the agent understood + did */}
          {lastResult && (
            <div
              className={`rounded-lg border px-3 py-2.5 text-xs ${
                lastResult.ok
                  ? "border-green-500/20 bg-green-500/5"
                  : "border-amber-500/20 bg-amber-500/5"
              }`}
            >
              <p className="text-white/50 mb-1">
                Understood: <span className="text-white/80">{lastResult.intent.summary}</span>
              </p>
              <p className={lastResult.ok ? "text-green-300" : "text-amber-300"}>
                {lastResult.armed === "conditional" || lastResult.armed === "scheduled" ? "⏳ " : lastResult.ok ? "✅ " : "⚠️ "}
                {lastResult.message}
              </p>
              {lastResult.outcome?.digest && (
                <a
                  href={`https://testnet.suivision.xyz/txblock/${lastResult.outcome.digest}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-violet-300 hover:underline break-all"
                >
                  View on explorer ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pause / Resume / Revoke — shown when a policy is bound */}
      {bound && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-white">Manage agent</h4>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => pause()}
              disabled={busy !== "idle"}
              className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Pause className="w-3.5 h-3.5" /> {busy === "pausing" ? "Pausing…" : "Pause"}
            </button>
            <button
              onClick={() => resume()}
              disabled={busy !== "idle"}
              className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> {busy === "resuming" ? "Resuming…" : "Resume"}
            </button>
          </div>
          <button
            onClick={() => revoke()}
            disabled={busy !== "idle"}
            className="w-full rounded-lg bg-red-600/90 hover:bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Ban className="w-4 h-4" /> {busy === "revoking" ? "Revoking…" : "Revoke agent"}
          </button>
          <p className="text-[11px] text-white/40">
            Revoke cancels open orders, sweeps funds back to you, then destroys the
            agent's authority on-chain. Its next action will fail.
          </p>
        </div>
      )}

      {/* Alerts feed */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-white/70" />
          <h4 className="text-sm font-semibold text-white">Activity & alerts</h4>
        </div>
        {alerts.length === 0 ? (
          <p className="text-xs text-white/40">No alerts yet.</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.id} className="flex gap-2.5 rounded-lg bg-black/20 px-3 py-2">
                <span className="mt-0.5">{ALERT_ICON[a.level]}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate">{a.title}</p>
                  <p className="text-[11px] text-white/60 break-words">{a.message}</p>
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {new Date(a.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AgentControls;
