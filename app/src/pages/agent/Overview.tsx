import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiUser, FiCpu, FiTrendingUp, FiArrowRight, FiArrowDown, FiShield,
  FiCheckCircle, FiXCircle, FiClock, FiActivity, FiExternalLink, FiRefreshCw,
} from "react-icons/fi";
import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { useAgentWallet, type AgentAlert } from "@/hooks/useAgentWallet";

/**
 * Overview — the "what's going on" dashboard. Shows the full flow of the agent
 * system on one auto-refreshing screen:
 *   1. The three balances (owner wallet, agent gas wallet, DeepBook trading account)
 *   2. A money-flow diagram explaining how funds move
 *   3. Live on-chain policy status (budget bar, expiry, allowed tokens, state)
 *   4. The chronological action log (swaps, orders, deposits, revoke)
 * All data is live from the same shared hook + dapp-kit balance reads. No mocks.
 */

const MIST = 1_000_000_000;
const network = import.meta.env.VITE_SUI_NETWORK || "testnet";
const explorerTx = (d: string) => `https://suiscan.xyz/${network}/tx/${d}`;
const explorerAddr = (a: string) => `https://suiscan.xyz/${network}/account/${a}`;

const STATUS_ICON: Record<AgentAlert["level"], React.ReactNode> = {
  success: <FiCheckCircle className="text-emerald-500" />,
  error: <FiXCircle className="text-red-500" />,
  warning: <FiClock className="text-amber-500" />,
  info: <FiActivity className="text-[var(--brand)]" />,
};

function short(a?: string | null) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}
function fmtSui(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function Overview() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { status, policy, manager, alerts, refresh, refreshPolicy, refreshManager, refreshAlerts } =
    useAgentWallet();

  const ownerAddr = account?.address ?? "";
  const agentAddr = status?.agentAddress ?? "";

  const { data: ownerBal } = useSuiClientQuery(
    "getBalance",
    { owner: ownerAddr },
    { enabled: !!ownerAddr, refetchInterval: 10_000 },
  );
  const { data: agentBal } = useSuiClientQuery(
    "getBalance",
    { owner: agentAddr },
    { enabled: !!agentAddr, refetchInterval: 10_000 },
  );

  const ownerSui = ownerBal ? Number(ownerBal.totalBalance) / MIST : 0;
  const agentSui = agentBal ? Number(agentBal.totalBalance) / MIST : 0;
  const tradingSui = manager?.balances?.SUI ?? 0;
  const tradingUsdc = manager?.balances?.DBUSDC ?? 0;

  // Auto-refresh the agent-side reads (dapp-kit balances poll on their own above).
  useEffect(() => {
    const tick = () => {
      refresh();
      refreshPolicy();
      refreshManager();
      refreshAlerts();
    };
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, [refresh, refreshPolicy, refreshManager, refreshAlerts]);

  const cap = policy ? Number(policy.budgetCap) / MIST : 0;
  const spent = policy ? Number(policy.budgetSpent) / MIST : 0;
  const usedPct = policy?.usedPercent ?? 0;
  const expiryMs = policy ? Number(policy.expiryTimestampMs) : 0;
  const expired = expiryMs > 0 && expiryMs <= Date.now();
  const policyState = !policy
    ? status?.bound
      ? "syncing"
      : "none"
    : expired
    ? "expired"
    : policy.isActive
    ? "active"
    : "paused";

  const stateBadge: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    expired: "bg-red-500/15 text-red-500",
    revoked: "bg-red-500/15 text-red-500",
    none: "bg-[var(--surface-3)] text-[var(--muted)]",
    syncing: "bg-[var(--surface-3)] text-[var(--muted)]",
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--canvas)] px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold text-[var(--ink)]">Overview</h1>
            <p className="text-[14px] text-[var(--muted)] mt-0.5">
              The full flow — every wallet, the policy, and what the agent is doing. Live.
            </p>
          </div>
          <button
            onClick={() => {
              refresh();
              refreshPolicy();
              refreshManager();
              refreshAlerts();
            }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-3)] transition-all cursor-pointer"
          >
            <FiRefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* ── Money-flow diagram ─────────────────────────────────────── */}
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--muted)] mb-5">
            How funds flow
          </h2>
          <div className="flex flex-col lg:flex-row items-stretch gap-3">
            <FlowNode
              icon={<FiUser />}
              tone="ink"
              title="Your Wallet"
              addr={ownerAddr}
              primary={`${fmtSui(ownerSui)} SUI`}
              caption="You sign policy + revoke"
              onClick={() => ownerAddr && window.open(explorerAddr(ownerAddr), "_blank")}
            />
            <Arrow label="fund gas" />
            <FlowNode
              icon={<FiCpu />}
              tone="brand"
              title="Agent Wallet"
              addr={agentAddr}
              primary={`${fmtSui(agentSui)} SUI`}
              caption="Pays gas · signs trades"
              onClick={() => agentAddr && window.open(explorerAddr(agentAddr), "_blank")}
            />
            <Arrow label="fund trading" />
            <FlowNode
              icon={<FiTrendingUp />}
              tone="brand"
              title="Trading Account"
              addr={manager?.balanceManagerId ?? null}
              primary={`${fmtSui(tradingSui)} SUI`}
              secondary={`${fmtSui(tradingUsdc)} USDC`}
              caption="DeepBook settles here"
              onClick={() =>
                manager?.balanceManagerId &&
                window.open(explorerAddr(manager.balanceManagerId), "_blank")
              }
            />
          </div>
          <p className="text-[12px] text-[var(--muted)] mt-4 leading-relaxed">
            <b>Your wallet</b> funds the <b>agent wallet</b> (gas). The agent moves SUI into its{" "}
            <b>trading account</b>, and DeepBook swaps settle from there — so the agent trades
            autonomously without ever touching your wallet.
          </p>
        </div>

        {/* ── Policy status ──────────────────────────────────────────── */}
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-[var(--ink)]">
              <FiShield className="text-[var(--brand)]" /> On-chain policy
            </h2>
            <span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full ${stateBadge[policyState]}`}>
              {policyState}
            </span>
          </div>

          {policyState === "none" ? (
            <div className="text-center py-6">
              <p className="text-[14px] text-[var(--muted)] mb-4">
                No active policy. Create one to let the agent trade within your limits.
              </p>
              <button
                onClick={() => navigate("/agent/policy")}
                className="rounded-full bg-[var(--brand)] text-white text-[14px] font-bold px-6 py-2.5 hover:bg-[var(--brand-hover)] transition-all cursor-pointer"
              >
                Create policy
              </button>
            </div>
          ) : (
            <>
              {/* Budget bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[13px] mb-1.5">
                  <span className="text-[var(--muted)]">Budget used</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {fmtSui(spent)} / {fmtSui(cap)} SUI ({usedPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
                    style={{ width: `${Math.min(usedPct, 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <MetaTile label="Allowed tokens" value={(policy?.allowedAssets ?? []).join(", ") || "—"} />
                <MetaTile
                  label={expired ? "Expired" : "Expires in"}
                  value={expiryMs ? <ExpiryCountdown expiryMs={expiryMs} /> : "—"}
                />
                <MetaTile label="Remaining" value={`${fmtSui(cap - spent)} SUI`} />
              </div>

              {(expired || policyState === "paused") && (
                <button
                  onClick={() => navigate("/agent/policy")}
                  className="mt-4 w-full rounded-full border border-[var(--line)] text-[13px] font-semibold text-[var(--ink)] py-2.5 hover:bg-[var(--surface-3)] transition-all cursor-pointer"
                >
                  {expired ? "Create a new policy" : "Manage policy"}
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Action log ─────────────────────────────────────────────── */}
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-[var(--ink)]">
              <FiActivity className="text-[var(--brand)]" /> Activity
            </h2>
            <span className="text-[12px] text-[var(--muted)]">{alerts.length} events</span>
          </div>

          {alerts.length === 0 ? (
            <p className="text-[14px] text-[var(--muted)] text-center py-8">
              Nothing yet. Give the agent a command and its actions will appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.slice(0, 40).map((a) => {
                const digest = (a.meta?.digest ?? a.meta?.txDigest) as string | undefined;
                return (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-3"
                  >
                    <div className="mt-0.5 text-[16px]">{STATUS_ICON[a.level]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[var(--ink)] truncate">{a.title}</span>
                        <span className="text-[11px] text-[var(--muted)] flex-shrink-0">{timeAgo(a.timestamp)}</span>
                      </div>
                      <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5 break-words">{a.message}</p>
                      {digest && (
                        <a
                          href={explorerTx(digest)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand)] hover:underline mt-1"
                        >
                          View on explorer <FiExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function FlowNode({
  icon, tone, title, addr, primary, secondary, caption, onClick,
}: {
  icon: React.ReactNode;
  tone: "ink" | "brand";
  title: string;
  addr: string | null;
  primary: string;
  secondary?: string;
  caption: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 text-left rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-4 hover:border-[var(--brand)] transition-all cursor-pointer group"
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-8 h-8 rounded-xl flex items-center justify-center text-[16px] ${
            tone === "brand" ? "bg-[var(--brand-dim)] text-[var(--brand)]" : "bg-[var(--ink)]/10 text-[var(--ink)]"
          }`}
        >
          {icon}
        </span>
        <span className="text-[13px] font-bold text-[var(--ink)]">{title}</span>
      </div>
      <div className="text-[18px] font-bold text-[var(--ink)] leading-tight">{primary}</div>
      {secondary && <div className="text-[13px] font-semibold text-[var(--muted)]">{secondary}</div>}
      <div className="text-[11px] text-[var(--muted)] mt-1.5">{caption}</div>
      <div className="text-[11px] font-mono text-[var(--faint)] mt-1 group-hover:text-[var(--brand)] transition-colors">
        {short(addr)}
      </div>
    </button>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex lg:flex-col items-center justify-center gap-1 px-1 py-2 lg:py-0">
      <FiArrowRight className="hidden lg:block text-[var(--faint)] text-xl" />
      <FiArrowDown className="lg:hidden text-[var(--faint)] text-xl" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">{label}</span>
    </div>
  );
}

function MetaTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">{label}</div>
      <div className="text-[14px] font-semibold text-[var(--ink)] mt-0.5">{value}</div>
    </div>
  );
}

function ExpiryCountdown({ expiryMs }: { expiryMs: number }) {
  const diff = expiryMs - Date.now();
  if (diff <= 0) return <span className="text-red-500">Expired</span>;
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return <>{Math.floor(h / 24)}d {h % 24}h</>;
  return <>{h}h {m}m</>;
}
