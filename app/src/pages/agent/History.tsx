import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiExternalLink, FiArrowRight, FiClock, FiZap, FiInbox } from "react-icons/fi";
import { useAgentWallet, type AgentAlert } from "@/hooks/useAgentWallet";

/**
 * Agent History — a clean timeline of the agent's executed on-chain actions,
 * derived from the real alert feed (useAgentWallet().alerts). Unlike the
 * Activities log (every alert), History focuses on settled transactions: it
 * surfaces the ones carrying a tx digest, grouped by day, with explorer links.
 */

interface TxRecord {
  id: string;
  title: string;
  message: string;
  level: AgentAlert["level"];
  timestamp: number;
  digest?: string;
  orderId?: string;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function History() {
  const navigate = useNavigate();
  const { account, alerts } = useAgentWallet();

  // Records that represent a real on-chain action (have a digest), newest first.
  const records: TxRecord[] = useMemo(
    () =>
      alerts
        .map((a) => ({
          id: a.id,
          title: a.title,
          message: a.message,
          level: a.level,
          timestamp: a.timestamp,
          digest: a.meta?.digest as string | undefined,
          orderId: a.meta?.orderId as string | undefined,
        }))
        .filter((r) => r.digest)
        .sort((x, y) => y.timestamp - x.timestamp),
    [alerts],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TxRecord[]>();
    for (const r of records) {
      const k = dayKey(r.timestamp);
      (map.get(k) ?? map.set(k, []).get(k)!).push(r);
    }
    return Array.from(map.entries());
  }, [records]);

  if (!account?.address) {
    return (
      <Empty
        title="Connect your wallet"
        body="Connect from the header to view your agent's transaction history."
      />
    );
  }

  if (records.length === 0) {
    return (
      <Empty
        title="No transactions yet"
        body="Once the agent executes a trade, it appears here with an explorer link."
        action={
          <button
            onClick={() => navigate("/agent")}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink text-canvas px-5 py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
          >
            <FiZap className="w-4 h-4" /> Instruct the agent
          </button>
        }
      />
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-canvas px-8 py-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end justify-between mb-7">
          <div>
            <h1 className="text-[30px] font-bold text-ink leading-tight">History</h1>
            <p className="text-[15px] text-muted mt-1">Settled on-chain executions by your agent</p>
          </div>
          <span className="text-[13px] font-mono font-bold text-muted bg-surface border border-line rounded-full px-3 py-1.5">
            {records.length} tx
          </span>
        </div>

        <div className="space-y-8">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div className="flex items-center gap-2 mb-3">
                <FiClock className="w-3.5 h-3.5 text-faint" />
                <span className="text-[12px] font-bold text-faint uppercase tracking-wider">{day}</span>
              </div>
              <div className="relative pl-5 border-l border-line space-y-3">
                {items.map((r) => (
                  <div
                    key={r.id}
                    className="relative bg-surface border border-line rounded-2xl p-4 shadow-sm hover:border-line-strong transition-colors"
                  >
                    {/* timeline dot */}
                    <span
                      className={`absolute -left-[26px] top-5 w-2.5 h-2.5 rounded-full ring-4 ring-canvas ${
                        r.level === "error" ? "bg-danger" : "bg-positive"
                      }`}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-ink">{r.title}</div>
                        <div className="text-[13px] text-muted break-words mt-0.5 flex items-center gap-1.5">
                          {r.message}
                        </div>
                      </div>
                      <span className="text-[12px] font-mono font-bold text-faint whitespace-nowrap mt-0.5">
                        {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
                      <a
                        href={`https://testnet.suivision.xyz/txblock/${r.digest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#4F46E5] dark:text-[#818CF8] hover:underline"
                      >
                        View transaction <FiExternalLink className="w-3 h-3" />
                      </a>
                      {r.orderId && (
                        <span className="text-[11px] font-mono text-faint">
                          order {r.orderId.slice(0, 8)}…
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[11px] text-faint">
                        {r.digest!.slice(0, 8)}…{r.digest!.slice(-6)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate("/agent/activity")}
          className="mt-8 inline-flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-ink transition-colors"
        >
          See full activity log <FiArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="h-full w-full bg-canvas flex flex-col items-center justify-center px-6 text-center font-sans">
      <div className="w-14 h-14 rounded-2xl bg-surface-2 border border-line flex items-center justify-center mb-4">
        <FiInbox className="w-6 h-6 text-faint" />
      </div>
      <h1 className="text-[20px] font-bold text-ink mb-1.5">{title}</h1>
      <p className="text-[14px] text-muted max-w-[360px]">{body}</p>
      {action}
    </div>
  );
}
