import { useState } from "react";
import {
  FiShield,
  FiHexagon,
  FiArrowUp,
  FiStopCircle,
  FiPause,
  FiPlay,
  FiX,
  FiBell,
  FiCheckCircle,
  FiAlertTriangle,
  FiInfo,
  FiXCircle,
} from "react-icons/fi";
import { GoArrowUpRight } from "react-icons/go";
import { TokenSUI, TokenUSDC } from "@web3icons/react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  useAgentWallet,
  type CreatePolicyForm,
  type AgentAlert,
  type IntentResult,
  type DeepBookSetup,
  type PolicyState,
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

const SUGGESTIONS = [
  { category: "Swap", text: "Swap 1 SUI to USDC" },
  { category: "Percentage", text: "Swap 30% of my SUI to USDC" },
  { category: "Conditional", text: "Buy SUI if it drops below 0.20" },
  { category: "Limit Order", text: "Place a limit order to buy 10 SUI at 0.20" },
];

const ASSET_OPTIONS = ["SUI", "USDC"] as const;

const ALERT_ICON: Record<AgentAlert["level"], React.ReactNode> = {
  info: <FiInfo className="w-4 h-4 text-blue-500" />,
  warning: <FiAlertTriangle className="w-4 h-4 text-amber-500" />,
  error: <FiXCircle className="w-4 h-4 text-red-500" />,
  success: <FiCheckCircle className="w-4 h-4 text-emerald-500" />,
};

/** Real token glyph for SUI/USDC, falling back to a generic shape. */
function TokenIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const s = symbol.toUpperCase();
  if (s.includes("USDC")) return <TokenUSDC variant="branded" size={size} />;
  if (s.includes("SUI")) return <TokenSUI variant="background" size={size} className="rounded-full overflow-hidden" />;
  return <FiHexagon className="text-[0.8rem]" />;
}

/**
 * Owner-facing control surface for the Autonomous Agent Wallet (PRD §7). Restyled
 * to the Corral design system (Figma) — light/dark cards, a chat-style command
 * surface, a "Strategy Parsed" result card, an executed-tx card, and a live policy
 * drawer. All on-chain mutations are signed by the connected owner wallet via
 * dapp-kit; agent actions run server-side. Every control is wired to the real
 * useAgentWallet hook — no mocks.
 */
export function AgentControls() {
  const {
    account,
    status,
    policy,
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  // Revoke with the DeepBook setup so the server cancels open orders + sweeps
  // funds back before destroying the capability (PRD two-step revoke).
  const runRevoke = () => {
    void revoke(status?.agentAddress ? DEMO_DEEPBOOK(status.agentAddress) : undefined);
  };

  const [form, setForm] = useState<CreatePolicyForm>({
    budgetCap: "500000000", // 500 USDC at 6 decimals, as an example default
    allowedAssets: ["SUI", "USDC"],
    expiryHours: 24,
    gasReserve: "100000000",
  });

  if (!account?.address) {
    return (
      <div className="rounded-[20px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-8 text-center text-sm text-[#5E5E5E] dark:text-zinc-400">
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
  const busyIdle = busy === "idle";

  return (
    <div className="flex gap-4 w-full font-sans">
      {/* ── Main column ────────────────────────────────────────────── */}
      <div className="flex-1 space-y-4 min-w-0">
        {/* Header / wallet identity */}
        <div className="rounded-[20px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-[#F3F2EF] dark:bg-zinc-900 flex items-center justify-center border border-[#E7E7E4] dark:border-zinc-800">
                <FiShield className="w-4 h-4 text-zinc-800 dark:text-zinc-200" />
              </span>
              <h3 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-50">Agent Controls</h3>
            </div>
            {bound && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 border border-[#E7E7E4] dark:border-zinc-700 rounded-full text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-[#F3F2EF] dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
              >
                <FiShield className="text-sm" />
                View active rule
              </button>
            )}
          </div>

          {status ? (
            <div className="space-y-1.5 text-[13px] text-[#5E5E5E] dark:text-zinc-400">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Agent address</span>
                <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200 truncate max-w-[60%]">
                  {status.agentAddress}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Policy</span>
                {bound ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {status.policyId?.slice(0, 12)}…
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">not created</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#5E5E5E] dark:text-zinc-400">No agent wallet yet.</span>
              <button
                onClick={() => initWallet()}
                disabled={!busyIdle}
                className="rounded-full bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 px-4 py-2 text-xs font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {busy === "init" ? "Initializing…" : "Initialize agent"}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl bg-[#FF595B0D] dark:bg-[#2A1A1A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs text-[#FF595B] dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Policy creation — shown once a wallet exists but no policy is bound */}
        {status && !bound && (
          <div className="rounded-[20px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-[18px] font-bold text-zinc-900 dark:text-zinc-50">Create policy</h4>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#E8E8E8] dark:bg-zinc-800 border border-[#E7E7E4] dark:border-zinc-700 text-[#5E5E5E] dark:text-zinc-400">
                On-Chain Enforced
              </span>
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2">
                Maximum Budget Cap (base units)
              </label>
              <input
                value={form.budgetCap}
                onChange={(e) => setForm({ ...form, budgetCap: e.target.value.replace(/\D/g, "") })}
                className="w-full rounded-xl bg-white dark:bg-zinc-900/40 border border-[#6B7280] dark:border-zinc-700 px-4 py-3 text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-400"
                inputMode="numeric"
              />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2.5">
                Allowed Tokens
              </label>
              <div className="flex flex-wrap gap-2">
                {ASSET_OPTIONS.map((a) => {
                  const on = form.allowedAssets.includes(a);
                  return (
                    <button
                      key={a}
                      onClick={() => toggleAsset(a)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-all ${
                        on
                          ? "bg-surface-3 border-line text-ink"
                          : "bg-transparent border-dashed border-line-strong text-faint opacity-70"
                      }`}
                    >
                      <TokenIcon symbol={a} size={16} />
                      {a}
                      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-positive" : "bg-zinc-400"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2">
                  Expiry (hours)
                </label>
                <input
                  type="number"
                  value={form.expiryHours}
                  onChange={(e) => setForm({ ...form, expiryHours: Number(e.target.value) })}
                  className="w-full rounded-xl bg-white dark:bg-zinc-900/40 border border-[#6B7280] dark:border-zinc-700 px-4 py-3 text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-400"
                  min={1}
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2">
                  Gas reserve (base units)
                </label>
                <input
                  value={form.gasReserve}
                  onChange={(e) => setForm({ ...form, gasReserve: e.target.value.replace(/\D/g, "") })}
                  className="w-full rounded-xl bg-white dark:bg-zinc-900/40 border border-[#6B7280] dark:border-zinc-700 px-4 py-3 text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-400"
                  inputMode="numeric"
                />
              </div>
            </div>

            <p className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 leading-relaxed">
              Protocol is restricted to DeepBook. Assets and protocols not listed here are
              mathematically blocked by the Move contract.
            </p>

            <button
              onClick={() => createPolicy(form)}
              disabled={!busyIdle || form.allowedAssets.length === 0}
              className="w-full rounded-full bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 px-4 py-3 text-[14px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-sm"
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

        {/* Natural-language command — the agentic centerpiece. */}
        {bound && (
          <div className="rounded-[28px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <h4 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-50 mb-1">
              How can the agent help you on-chain?
            </h4>
            <p className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 mb-5">
              Instruct in plain language. The agent parses it, checks your policy, then acts.
            </p>

            {/* Suggestion chips */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {SUGGESTIONS.map((item) => (
                <button
                  key={item.text}
                  onClick={() => runInstruction(item.text)}
                  disabled={!busyIdle}
                  className="bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800 rounded-2xl p-4 text-left transition-all hover:border-zinc-300 dark:hover:border-zinc-700 disabled:opacity-50 cursor-pointer active:scale-[0.99] flex flex-col gap-1.5"
                >
                  <span className="text-[#5E5E5E] dark:text-zinc-500 text-[12px] font-medium tracking-wide">
                    {item.category}
                  </span>
                  <span className="text-zinc-900 dark:text-zinc-100 font-medium text-[13.5px] leading-snug">
                    {item.text}
                  </span>
                </button>
              ))}
            </div>

            {/* Input row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runInstruction(instruction);
              }}
              className="flex items-center justify-between gap-2 bg-[#F7F7F5] dark:bg-[#1C1C1C] border border-[#E7E7E4] dark:border-transparent rounded-full pl-5 pr-2 py-2 focus-within:border-zinc-300 dark:focus-within:border-zinc-700 transition-all"
            >
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Instruct the agent…"
                disabled={!busyIdle}
                className="bg-transparent border-0 outline-none w-full text-[14px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
              />
              <button
                type="submit"
                disabled={!busyIdle || !instruction.trim()}
                className="bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 rounded-full w-9 h-9 flex items-center justify-center hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all cursor-pointer active:scale-95 flex-shrink-0 disabled:opacity-50"
              >
                {busy === "thinking" ? <LoadingSpinner /> : <FiArrowUp className="text-lg" />}
              </button>
            </form>

            {/* Strategy-parsed result */}
            {lastResult && <StrategyCard result={lastResult} />}
          </div>
        )}

        {/* Manage agent: pause / resume / revoke */}
        {bound && (
          <div className="rounded-[20px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-5 space-y-3 shadow-sm">
            <h4 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">Manage agent</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => pause()}
                disabled={!busyIdle}
                className="rounded-full border border-[#E7E7E4] dark:border-zinc-700 bg-[#F7F7F5] dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2.5 text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <FiPause className="w-4 h-4" /> {busy === "pausing" ? "Pausing…" : "Pause"}
              </button>
              <button
                onClick={() => resume()}
                disabled={!busyIdle}
                className="rounded-full border border-[#E7E7E4] dark:border-zinc-700 bg-[#F7F7F5] dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2.5 text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <FiPlay className="w-4 h-4" /> {busy === "resuming" ? "Resuming…" : "Resume"}
              </button>
            </div>
            <button
              onClick={runRevoke}
              disabled={!busyIdle}
              className="w-full rounded-full bg-[#FF595B] hover:bg-[#D93025] text-white px-4 py-3 text-[14px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm"
            >
              <FiStopCircle className="w-5 h-5" /> {busy === "revoking" ? "Revoking…" : "Revoke agent access"}
            </button>
            <p className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 leading-relaxed">
              Revoke cancels open orders, sweeps funds back to you, then destroys the agent's
              authority on-chain. Its next action will fail.
            </p>
          </div>
        )}

        {/* Alerts feed */}
        <div className="rounded-[20px] border border-[#E7E7E4] dark:border-black bg-white dark:bg-[#2F2F2F] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FiBell className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            <h4 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">Activity &amp; alerts</h4>
          </div>
          {alerts.length === 0 ? (
            <p className="text-[13px] text-[#9a9a97] dark:text-zinc-500">No alerts yet.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex gap-2.5 rounded-xl bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800 px-3 py-2.5"
                >
                  <span className="mt-0.5 flex-shrink-0">{ALERT_ICON[a.level]}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">{a.title}</p>
                    <p className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 break-words">{a.message}</p>
                    <p className="text-[10px] text-[#9a9a97] dark:text-zinc-600 mt-0.5 font-mono">
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Policy drawer ──────────────────────────────────────────── */}
      {bound && drawerOpen && (
        <PolicyDrawer
          form={form}
          policy={policy}
          policyId={status?.policyId ?? null}
          onClose={() => setDrawerOpen(false)}
          onRevoke={() => {
            setDrawerOpen(false);
            runRevoke();
          }}
        />
      )}
    </div>
  );
}

/** The "Strategy Parsed" + executed result card, bound to a real IntentResult. */
function StrategyCard({ result }: { result: IntentResult }) {
  const { intent, ok, armed, message, outcome } = result;
  const armedLabel = armed === "conditional" ? "Watching price" : armed === "scheduled" ? "Scheduled" : null;

  return (
    <div className="mt-5 bg-[#F7F7F5] dark:bg-[#262626] border border-[#E7E7E4] dark:border-black rounded-[20px] p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-900 border border-[#E7E7E4] dark:border-zinc-800 flex items-center justify-center">
          <FiShield className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />
        </span>
        <span className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">Strategy Parsed</span>
      </div>

      {/* Parsed intent table */}
      <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-2xl p-4 space-y-2.5">
        <Row label="Action" value={intent.action.replace(/_/g, " ")} />
        {intent.tokenIn && intent.tokenOut && <Row label="Pair" value={`${intent.tokenIn} / ${intent.tokenOut}`} />}
        {intent.amount != null && <Row label="Amount" value={String(intent.amount)} />}
        {intent.percentage != null && <Row label="Percentage" value={`${intent.percentage}%`} />}
        {intent.price != null && <Row label="Price" value={String(intent.price)} />}
        {intent.condition && <Row label="Condition" value={intent.condition} />}
        {intent.schedule && <Row label="Schedule" value={intent.schedule} />}
      </div>

      <p className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 mt-3">
        Understood: <span className="text-zinc-800 dark:text-zinc-200">{intent.summary}</span>
      </p>

      {/* Outcome banner */}
      <div
        className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
          ok
            ? "border-[#E6F5EC] dark:border-[#122A1E] bg-[#E6F5EC] dark:bg-[#122A1E]"
            : "border-[#FECACA] dark:border-[#7F1D1D] bg-[#FF595B0D] dark:bg-[#2A1A1A]"
        }`}
      >
        <span
          className={`text-[13px] font-semibold ${
            ok ? "text-emerald-700 dark:text-emerald-300" : "text-[#FF595B] dark:text-red-300"
          }`}
        >
          {armedLabel ? `⏳ ${message}` : ok ? `✅ ${message}` : `⚠️ ${message}`}
        </span>
        {ok && !armed && (
          <span className="bg-white dark:bg-[#0c1f15] text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-md text-xs font-bold flex-shrink-0">
            {armedLabel ?? "Success"}
          </span>
        )}
      </div>

      {outcome?.digest && (
        <a
          href={`https://testnet.suivision.xyz/txblock/${outcome.digest}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[#4F46E5] dark:text-[#818CF8] hover:underline text-[13px] font-bold"
        >
          View TX
          <GoArrowUpRight className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-[#5E5E5E] dark:text-zinc-500 font-medium capitalize">{label}:</span>
      <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200 capitalize">{value}</span>
    </div>
  );
}

/** Format a future epoch-ms into a "Xd Yh Zm" remaining string. */
function formatRemaining(expiryMs: number): { text: string; expired: boolean } {
  const diff = expiryMs - Date.now();
  if (diff <= 0) return { text: "Expired", expired: true };
  const m = Math.floor(diff / 60000) % 60;
  const h = Math.floor(diff / 3600000) % 24;
  const d = Math.floor(diff / 86400000);
  const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { text, expired: false };
}

/**
 * Live policy constraints drawer. Uses real on-chain policy state from
 * GET /api/agent/policy (budget bar, expiry countdown, whitelists) when available,
 * falling back to the just-created form before the read lands.
 */
function PolicyDrawer({
  form,
  policy,
  policyId,
  onClose,
  onRevoke,
}: {
  form: CreatePolicyForm;
  policy: PolicyState | null;
  policyId: string | null;
  onClose: () => void;
  onRevoke: () => void;
}) {
  const assets = policy?.allowedAssets?.length ? policy.allowedAssets : form.allowedAssets;
  const cap = policy ? Number(policy.budgetCap) : Number(form.budgetCap);
  const spent = policy ? Number(policy.budgetSpent) : 0;
  const usedPct = policy ? Math.min(100, Math.round(policy.usedPercent)) : 0;
  const expiry = policy
    ? formatRemaining(Number(policy.expiryTimestampMs))
    : { text: `~${form.expiryHours}h`, expired: false };

  return (
    <div className="w-[300px] flex-shrink-0 h-fit sticky top-4 bg-[#F3F2EF] dark:bg-zinc-900 border border-[#E7E7E4] dark:border-zinc-800 rounded-[2rem] shadow-[0_10px_40px_rgba(0,0,0,0.04)] flex flex-col">
      <div className="p-6 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-[18px] font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
            <FiShield className="text-zinc-800 dark:text-zinc-200" />
            Policy Constraints
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center border border-[#E7E7E4] dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer active:scale-95 transition-all"
          >
            <FiX />
          </button>
        </div>

        {/* Budget usage */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-[#5E5E5E] dark:text-zinc-500 tracking-wider">
              Budget Usage
            </span>
            <span className="text-[13px] font-mono font-bold text-zinc-900 dark:text-zinc-100">{usedPct}%</span>
          </div>
          <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-zinc-950 dark:bg-zinc-50 rounded-full transition-all" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="text-[11px] font-mono text-[#5E5E5E] dark:text-zinc-400 mt-2 text-center font-semibold">
            {spent.toLocaleString()} / {cap.toLocaleString()} used (base units)
          </div>
        </div>

        {/* Asset whitelist */}
        <div>
          <h4 className="text-[11px] font-semibold text-[#5E5E5E] dark:text-zinc-500 tracking-wider mb-2">
            Asset Whitelist
          </h4>
          <div className="flex flex-wrap gap-2">
            {assets.map((a) => (
              <span
                key={a}
                className="flex items-center gap-1.5 bg-surface border border-line rounded-lg px-3 py-2 text-xs font-semibold text-ink shadow-sm"
              >
                <TokenIcon symbol={a} size={16} />
                {a.length > 8 ? `${a.slice(0, 6)}…` : a}
              </span>
            ))}
          </div>
        </div>

        {/* Protocol whitelist (fixed to DeepBook on-chain) */}
        <div>
          <h4 className="text-[11px] font-semibold text-[#5E5E5E] dark:text-zinc-500 tracking-wider mb-2">
            Protocol Whitelist
          </h4>
          <span className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800/50 border border-[#E7E7E4] dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            DeepBook V3
          </span>
        </div>

        {/* Expiry */}
        <div>
          <h4 className="text-[11px] font-semibold text-[#5E5E5E] dark:text-zinc-500 tracking-wider mb-2">
            Time Constraint
          </h4>
          <div className="bg-white dark:bg-zinc-900/60 border border-[#E7E7E4] dark:border-zinc-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-[#5E5E5E] dark:text-zinc-500">Status</span>
              <span
                className={`font-mono font-bold ${
                  policy && !policy.isActive ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {policy ? (policy.isActive ? "Active" : "Paused") : "—"}
              </span>
            </div>
            <div
              className={`text-[12px] font-semibold ${
                expiry.expired ? "text-[#FF595B] dark:text-red-400" : "text-[#5E5E5E] dark:text-zinc-400"
              }`}
            >
              {expiry.expired ? "Agent session expired" : `Agent session ends in ${expiry.text}`}
            </div>
          </div>
        </div>

        {/* Revoke */}
        <button
          onClick={onRevoke}
          className="flex items-center justify-center gap-2 w-full border border-[#FF595B] dark:border-red-600/80 bg-transparent hover:bg-[#FF595B0D] rounded-full py-3 text-[#FF595B] dark:text-red-400 font-medium text-[14px] cursor-pointer active:scale-[0.98] transition-all"
        >
          <FiStopCircle className="text-lg" />
          Revoke agent access
        </button>

        {policyId && (
          <p className="text-[10px] font-mono text-[#9a9a97] dark:text-zinc-600 break-all -mt-3">
            {policyId.slice(0, 18)}…
          </p>
        )}
      </div>
    </div>
  );
}

export default AgentControls;
