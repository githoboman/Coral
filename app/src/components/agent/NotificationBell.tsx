import { useState, useRef, useEffect } from "react";
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiInfo } from "react-icons/fi";
import { useAgentWallet, type AgentAlert } from "@/hooks/useAgentWallet";

/**
 * Header notification bell — a real dropdown of the agent's alert feed
 * (useAgentWallet().alerts) with an unread badge. Unread = alerts newer than the
 * last time the user opened the panel (persisted to localStorage).
 */
const SEEN_KEY = "coral_alerts_seen_ts";

const ICON: Record<AgentAlert["level"], React.ReactNode> = {
  info: <FiInfo className="w-4 h-4 text-blue-500" />,
  warning: <FiAlertTriangle className="w-4 h-4 text-amber-500" />,
  error: <FiXCircle className="w-4 h-4 text-red-500" />,
  success: <FiCheckCircle className="w-4 h-4 text-emerald-500" />,
};

export function NotificationBell() {
  const { alerts } = useAgentWallet();
  const [open, setOpen] = useState(false);
  const [seenTs, setSeenTs] = useState<number>(() => Number(localStorage.getItem(SEEN_KEY) || 0));
  const ref = useRef<HTMLDivElement>(null);

  const unread = alerts.filter((a) => a.timestamp > seenTs).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && alerts.length) {
      const ts = Date.now();
      localStorage.setItem(SEEN_KEY, String(ts));
      setSeenTs(ts);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative flex h-10 w-10 items-center justify-center bg-transparent text-[#5E5E5E] hover:text-zinc-950 active:scale-[0.98] dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        title="Notifications"
      >
        <img
          src="/assets/icons/bell.svg"
          alt="Notifications"
          width={16}
          height={16}
          className="object-contain flex-shrink-0 dark:[filter:brightness(0)_invert(1)]"
        />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF6A4D] text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-h-[420px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_rgba(0,0,0,0.18)] z-[120] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-[14px] font-bold text-ink">Notifications</span>
            <span className="text-[11px] text-muted">{alerts.length} total</span>
          </div>
          {alerts.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-faint">
              No notifications yet. Agent activity will appear here.
            </div>
          ) : (
            <ul className="overflow-y-auto divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-3 hover:bg-surface-3 transition-colors">
                  <span className="mt-0.5 flex-shrink-0">{ICON[a.level]}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink truncate">{a.title}</p>
                    <p className="text-[12px] text-muted break-words">{a.message}</p>
                    <p className="text-[10px] text-faint mt-0.5 font-mono">
                      {new Date(a.timestamp).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
