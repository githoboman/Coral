import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiExternalLink, FiArrowRight, FiClock, FiZap, FiInbox } from "react-icons/fi";
import { useAgentWallet, type AgentAlert } from "@/hooks/useAgentWallet";

/**
 * Agent History — redesigned with orange/white/black palette.
 * Timeline line uses orange gradient; dots orange for success, red for error.
 * Explorer links in orange. All cards hover-lift with orange border.
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
  const d    = new Date(ts);
  const today = new Date();
  const yest  = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString())  return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function History() {
  const navigate = useNavigate();
  const { account, alerts } = useAgentWallet();

  const records: TxRecord[] = useMemo(
    () =>
      alerts
        .map((a) => ({
          id:        a.id,
          title:     a.title,
          message:   a.message,
          level:     a.level,
          timestamp: a.timestamp,
          digest:    a.meta?.digest   as string | undefined,
          orderId:   a.meta?.orderId  as string | undefined,
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
            className="
              mt-5 inline-flex items-center gap-2
              rounded-full bg-[var(--brand)] text-white
              px-5 py-2.5 text-sm font-bold shadow-md
              hover:bg-[var(--brand-hover)] hover:shadow-[0_6px_20px_rgba(255,107,0,0.3)]
              hover:-translate-y-0.5
              transition-all duration-150 active:scale-[0.97] cursor-pointer
            "
          >
            <FiZap className="w-4 h-4" /> Instruct the agent
          </button>
        }
      />
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--canvas)] px-8 py-8 font-sans transition-colors duration-200">
      <div className="max-w-3xl mx-auto">

        {/* Page header */}
        <div className="flex items-end justify-between mb-8 whisk-in">
          <div>
            <h1 className="text-[30px] font-bold text-[var(--ink)] leading-tight">History</h1>
            <p className="text-[14px] text-[var(--muted)] mt-1">
              Settled on-chain executions by your agent
            </p>
          </div>
          <span className="
            text-[12px] font-mono font-bold text-[var(--brand)]
            bg-[var(--brand-dim)] border border-[var(--brand)]/25
            rounded-full px-3 py-1.5
          ">
            {records.length} tx
          </span>
        </div>

        {/* Timeline groups */}
        <div className="space-y-8">
          {grouped.map(([day, items], gi) => (
            <div key={day} className={`whisk-in whisk-d${Math.min(gi + 1, 6)}`}>

              {/* Day label */}
              <div className="flex items-center gap-2 mb-3">
                <FiClock className="w-3.5 h-3.5 text-[var(--brand)]" />
                <span className="text-[11px] font-bold text-[var(--brand)] uppercase tracking-wider">
                  {day}
                </span>
              </div>

              {/* Items */}
              <div className="relative pl-5 space-y-3">
                {/* Vertical orange timeline line */}
                <div
                  className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full"
                  style={{
                    background: "linear-gradient(to bottom, var(--brand), transparent)",
                    opacity: 0.4,
                  }}
                />

                {items.map((r) => (
                  <div
                    key={r.id}
                    className="
                      relative
                      bg-[var(--surface)] border border-[var(--line)]
                      rounded-2xl p-4 shadow-sm
                      card-hover
                    "
                  >
                    {/* Timeline dot */}
                    <span
                      className={`
                        absolute -left-[25px] top-5
                        w-2.5 h-2.5 rounded-full
                        ring-4 ring-[var(--canvas)]
                        ${r.level === "error" ? "bg-[var(--danger)]" : "bg-[var(--brand)]"}
                      `}
                    />

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14.5px] font-semibold text-[var(--ink)]">
                          {r.title}
                        </div>
                        <div className="text-[12.5px] text-[var(--muted)] break-words mt-0.5">
                          {r.message}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-[var(--faint)] whitespace-nowrap mt-0.5">
                        {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--line)]">
                      <a
                        href={`https://testnet.suivision.xyz/txblock/${r.digest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="
                          inline-flex items-center gap-1.5
                          text-[12px] font-bold text-[var(--brand)]
                          hover:underline transition-colors
                        "
                      >
                        View transaction <FiExternalLink className="w-3 h-3" />
                      </a>
                      {r.orderId && (
                        <span className="text-[11px] font-mono text-[var(--faint)]">
                          order {r.orderId.slice(0, 8)}…
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[11px] text-[var(--faint)]">
                        {r.digest!.slice(0, 8)}…{r.digest!.slice(-6)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer link */}
        <button
          onClick={() => navigate("/agent/activity")}
          className="
            mt-8 inline-flex items-center gap-2
            text-[13px] font-semibold text-[var(--muted)]
            hover:text-[var(--brand)] transition-colors cursor-pointer
          "
        >
          See full activity log <FiArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="
      h-full w-full bg-[var(--canvas)]
      flex flex-col items-center justify-center
      px-6 text-center font-sans
      transition-colors duration-200
    ">
      <div className="
        w-14 h-14 rounded-2xl
        bg-[var(--brand-dim)] border border-[var(--brand)]/25
        flex items-center justify-center mb-4
        whisk-pop
      ">
        <FiInbox className="w-6 h-6 text-[var(--brand)]" />
      </div>
      <h1 className="text-[20px] font-bold text-[var(--ink)] mb-1.5 whisk-in whisk-d2">
        {title}
      </h1>
      <p className="text-[14px] text-[var(--muted)] max-w-[360px] whisk-in whisk-d3">
        {body}
      </p>
      {action}
    </div>
  );
}
