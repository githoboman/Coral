import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiShield, FiEdit2, FiHexagon, FiDollarSign, FiActivity, FiCheckCircle, FiXCircle, FiClock } from "react-icons/fi";
import { MdLockOutline } from "react-icons/md";
import { RiShareBoxLine } from "react-icons/ri";
import { IoMdStopwatch } from "react-icons/io";
import { useAgentWallet, type AgentAlert, type PolicyState } from "@/hooks/useAgentWallet";

type LevelFilter = "all" | "success" | "error" | "warning" | "info";

/**
 * Agent Activity Log + live Move Policy sidebar — ported from the Corral (Figma)
 * `activities` screen into our Vite app and wired to real data: the activity log
 * is the agent alert feed (`/api/agent/alerts`) and the sidebar reads live policy
 * state (`/api/agent/policy`). No mocks.
 */

const STATUS_RING: Record<AgentAlert["level"], string> = {
  success: "bg-[#E4F4EE] dark:bg-[#132D21] text-emerald-600",
  warning: "bg-[#FBF1D9] dark:bg-[#332B14] text-amber-600",
  error: "bg-[#BA1A1A1A] dark:bg-[#3F1A1C] text-red-500",
  info: "bg-[#ECECF9] dark:bg-[#1E293B] text-indigo-500",
};

function formatRemaining(expiryMs: number): string {
  const diff = expiryMs - Date.now();
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60000) % 60;
  const h = Math.floor(diff / 3600000) % 24;
  const d = Math.floor(diff / 86400000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export default function Activities() {
  const navigate = useNavigate();
  const { account, status, policy, alerts } = useAgentWallet();
  const [filter, setFilter] = useState<LevelFilter>("all");

  const stats = {
    total: alerts.length,
    success: alerts.filter((a) => a.level === "success").length,
    failed: alerts.filter((a) => a.level === "error").length,
    last: alerts[0]?.timestamp,
  };
  const visible = filter === "all" ? alerts : alerts.filter((a) => a.level === filter);

  if (!account?.address) {
    return (
      <div className="h-full w-full bg-[#F7F7F5] dark:bg-[#262626] flex items-center justify-center text-[#5E5E5E] dark:text-zinc-400 font-sans">
        Connect your wallet to view agent activity.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#FAF9F6] dark:bg-[#262626] overflow-hidden font-sans transition-colors duration-200">
      {/* Left: Activity Log */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#F7F7F5] dark:bg-[#262626] p-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-[30px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">Activity Log</h1>
            <p className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 mt-1">
              On-chain executions and agent operations
            </p>
          </div>
          <button
            onClick={() => navigate("/agent")}
            className="flex items-center gap-1.5 px-4 py-2 border-2 border-[#CFC4C5] dark:border-black bg-white dark:bg-[#2F2F2F] rounded-full text-[14px] font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all"
          >
            <FiEdit2 className="text-[16px]" />
            Manage agent
          </button>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard icon={<FiActivity className="w-4 h-4" />} label="Total actions" value={String(stats.total)} />
          <StatCard icon={<FiCheckCircle className="w-4 h-4 text-emerald-500" />} label="Successful" value={String(stats.success)} />
          <StatCard icon={<FiXCircle className="w-4 h-4 text-red-500" />} label="Failed" value={String(stats.failed)} />
          <StatCard
            icon={<FiClock className="w-4 h-4" />}
            label="Last activity"
            value={stats.last ? new Date(stats.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-4">
          {(["all", "success", "error", "warning", "info"] as LevelFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-semibold capitalize transition-all border ${
                filter === f
                  ? "bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 border-transparent"
                  : "bg-white dark:bg-[#2F2F2F] text-[#5E5E5E] dark:text-zinc-400 border-[#E7E7E4] dark:border-black hover:border-zinc-300"
              }`}
            >
              {f === "error" ? "Failed" : f}
            </button>
          ))}
        </div>

        <div className="bg-[#FAFAF9] dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-[28px] shadow-sm overflow-hidden flex flex-col">
          <div className="grid grid-cols-12 px-6 py-4 border-b border-[#F1F1EF] dark:border-zinc-800 text-[13px] font-mono font-bold text-[#5E5E5E] dark:text-zinc-400 bg-[#F3F2EF80] dark:bg-black/20">
            <div className="col-span-1" />
            <div className="col-span-5">Action</div>
            <div className="col-span-4">Details</div>
            <div className="col-span-2 text-right">Time</div>
          </div>

          {visible.length === 0 ? (
            <div className="px-6 py-16 text-center text-[14px] text-[#9a9a97] dark:text-zinc-500">
              {alerts.length === 0 ? (
                <>
                  No agent activity yet. Instruct the agent from the{" "}
                  <button onClick={() => navigate("/agent")} className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
                    Agent
                  </button>{" "}
                  page to see executions here.
                </>
              ) : (
                <>No {filter === "error" ? "failed" : filter} activity.</>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#F1F1EF] dark:divide-zinc-800">
              {visible.map((item) => {
                const digest = (item.meta?.digest as string | undefined) ?? undefined;
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 px-6 py-4 items-center hover:bg-zinc-50/40 dark:hover:bg-zinc-800/10 transition-all"
                  >
                    <div className="col-span-1 flex items-center">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${STATUS_RING[item.level]}`}>
                        <FiShield className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="col-span-5">
                      <div className={`text-[15px] ${item.level === "error" ? "text-red-500" : "text-zinc-900 dark:text-zinc-100"}`}>
                        {item.title}
                      </div>
                      <div className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 capitalize">{item.level}</div>
                    </div>
                    <div className="col-span-4 text-[14px] text-zinc-700 dark:text-zinc-300 break-words pr-2">
                      {item.message}
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-3">
                      <span className="text-[13px] font-mono font-bold text-[#5E5E5E] dark:text-zinc-300">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {digest ? (
                        <a
                          href={`https://testnet.suivision.xyz/txblock/${digest}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#5E5E5E] dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                          title="View on explorer"
                        >
                          <RiShareBoxLine className="text-[18px]" />
                        </a>
                      ) : (
                        <MdLockOutline className="text-[18px] text-[#5E5E5E] dark:text-zinc-600" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-[92%] my-auto bg-[#E7E7E4] dark:bg-zinc-800 flex-shrink-0" />

      {/* Right: live Move Policy sidebar */}
      <PolicySidebar status={status?.bound ?? false} policy={policy} onEdit={() => navigate("/agent")} />
    </div>
  );
}

function PolicySidebar({
  status,
  policy,
  onEdit,
}: {
  status: boolean;
  policy: PolicyState | null;
  onEdit: () => void;
}) {
  const cap = policy ? Number(policy.budgetCap) : 0;
  const spent = policy ? Number(policy.budgetSpent) : 0;
  const usedPct = policy ? Math.min(100, Math.round(policy.usedPercent)) : 0;
  const assets = policy?.allowedAssets ?? [];

  return (
    <div className="w-[360px] flex flex-col h-full overflow-y-auto bg-[#F3F2EF] dark:bg-[#242424] p-8 space-y-6">
      <div className="flex justify-between items-start pt-2">
        <div>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">Move Policy</h2>
          <p className="text-[14px] text-[#5E5E5E] dark:text-zinc-400 mt-0.5">Active constraints on agent</p>
        </div>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3.5 py-1.5 border border-[#E7E7E4] dark:border-black bg-[#F3F2EF] dark:bg-[#2F2F2F] rounded-lg text-sm font-medium text-[#5E5E5E] dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all"
        >
          <FiEdit2 className="text-[15px]" />
          edit
        </button>
      </div>

      {!status || !policy ? (
        <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-xl p-5 text-[13px] text-[#5E5E5E] dark:text-zinc-400">
          No active policy. Create one from the{" "}
          <button onClick={onEdit} className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
            Agent
          </button>{" "}
          page to delegate trading within limits.
        </div>
      ) : (
        <>
          {/* Budget */}
          <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-[14px] font-bold text-[#5E5E5E] dark:text-zinc-400 tracking-wider">Budget Allocation</h3>
            <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-zinc-950 dark:bg-zinc-50 rounded-full transition-all" style={{ width: `${usedPct}%` }} />
            </div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-[18px] font-bold text-zinc-900 dark:text-zinc-50 font-mono">
                  {spent.toLocaleString()} / {cap.toLocaleString()}
                </div>
                <div className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-500 mt-2">
                  Spent / Cap (base units)
                </div>
              </div>
              <div className="text-[18px] font-bold font-mono text-zinc-900 dark:text-zinc-100">{usedPct}%</div>
            </div>
          </div>

          {/* Allowed scope */}
          <div className="space-y-3">
            <h3 className="text-[17px] font-bold text-[#5E5E5E] dark:text-zinc-400">Allowed Scope</h3>
            <div className="text-[13px] font-semibold text-[#5E5E5E] dark:text-zinc-500">Assets</div>
            <div className="flex flex-wrap gap-2">
              {assets.map((a) => (
                <span
                  key={a}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-black rounded-2xl text-xs font-semibold text-black dark:text-zinc-300 shadow-sm"
                >
                  {a.toUpperCase().includes("USDC") ? <FiDollarSign className="text-[0.8rem]" /> : <FiHexagon className="text-[0.8rem]" />}
                  {a.length > 8 ? `${a.slice(0, 6)}…` : a}
                </span>
              ))}
            </div>
            <div className="text-[13px] font-semibold text-[#5E5E5E] dark:text-zinc-500 pt-2">Protocols</div>
            <span className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-black rounded-2xl text-xs font-bold text-black dark:text-zinc-300 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              DeepBook V3
            </span>
          </div>

          {/* Auto-revoke timer */}
          <div className="bg-white dark:bg-[#2F2F2F] border-2 border-[#E7E7E4] dark:border-black rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#EEEEEE] dark:bg-zinc-950 border border-[#E7E7E4] dark:border-black flex items-center justify-center text-zinc-700 dark:text-zinc-300 flex-shrink-0 shadow-sm">
              <IoMdStopwatch className="text-[26px]" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-zinc-900 dark:text-zinc-50 font-mono">
                {formatRemaining(Number(policy.expiryTimestampMs))}
              </div>
              <div className="text-[14px] text-[#5E5E5E] dark:text-zinc-400 font-bold">Until expiry</div>
            </div>
          </div>

          <div className="text-[12px] font-semibold flex items-center gap-1.5 text-[#5E5E5E] dark:text-zinc-500">
            <span className={`w-2 h-2 rounded-full ${policy.isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
            {policy.isActive ? "Active" : "Paused"}
          </div>
        </>
      )}

      <div className="-mx-8 -mb-8 mt-auto flex items-center justify-center gap-1.5 bg-[#FCFCFB] dark:bg-[#1E1E1E] border-t border-[#E7E7E4] dark:border-zinc-800 text-[#5E5E5E] dark:text-zinc-500 text-[12px] font-semibold py-4">
        <FiShield className="text-[13px]" />
        Policy Enforced On-Chain
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[#5E5E5E] dark:text-zinc-400 text-[12px] font-semibold mb-2">
        {icon}
        {label}
      </div>
      <div className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 font-mono leading-none">{value}</div>
    </div>
  );
}
