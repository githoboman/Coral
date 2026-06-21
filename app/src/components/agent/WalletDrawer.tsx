import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FiCopy, FiX, FiLogOut, FiArrowUpRight } from "react-icons/fi";
import { TokenSUI } from "@web3icons/react";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from "@mysten/dapp-kit";

/**
 * Slide-out wallet drawer — Corral design (`corral` WalletPopup) rebuilt with
 * REAL data: connected address (copyable), live SUI balance via dapp-kit's
 * getBalance query, a link to the activity log, and a real disconnect. The
 * corral mock's fake send/receive/buy flows are omitted rather than faked.
 */
const MIST = 1_000_000_000;

export function WalletDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: balance } = useSuiClientQuery(
    "getBalance",
    { owner: account?.address ?? "" },
    { enabled: !!account?.address, refetchInterval: 15_000 },
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const addr = account?.address ?? "";
  const short = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
  const sui = balance ? (Number(balance.totalBalance) / MIST).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";

  const copy = () => {
    if (!addr) return;
    navigator.clipboard?.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20 dark:bg-black/40 transition-opacity" onClick={close} />
      <div
        className="fixed right-0 top-0 z-[100] h-screen w-[360px] max-w-full flex flex-col bg-surface/95 backdrop-blur-2xl border-l border-line shadow-[-12px_0_48px_rgba(0,0,0,0.15)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-line flex-shrink-0">
          <div>
            <h2 className="text-[20px] font-medium text-ink leading-tight">Your Wallet</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[12px] text-muted font-mono">{short || "Not connected"}</span>
              {addr && (
                <button onClick={copy} className="text-muted hover:text-ink transition-colors cursor-pointer" title="Copy address">
                  <FiCopy className="text-[12px]" />
                </button>
              )}
              {copied && <span className="text-[11px] text-positive font-semibold">copied</span>}
            </div>
          </div>
          <button onClick={close} className="w-8 h-8 flex items-center justify-center text-muted hover:text-ink transition-colors cursor-pointer">
            <FiX className="text-[22px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div>
            <div className="text-[13px] font-bold text-muted mb-3">Balance</div>
            <div className="bg-surface-3 border border-line rounded-[18px] px-5 py-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TokenSUI variant="background" size={28} className="rounded-full overflow-hidden" />
                <span className="text-[16px] font-semibold text-ink/80">SUI</span>
              </div>
              <div className="text-[26px] font-bold text-ink leading-tight font-mono">
                {sui} <span className="text-[18px] font-semibold text-muted">SUI</span>
              </div>
              <div className="text-[12px] text-muted mt-1">on {import.meta.env.VITE_SUI_NETWORK || "testnet"}</div>
            </div>
          </div>

          <button
            onClick={() => { close(); navigate("/agent/activity"); }}
            className="w-full flex items-center justify-between bg-surface border border-line rounded-[14px] px-4 py-3.5 shadow-sm hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <span className="text-[14px] font-medium text-ink">View agent activity</span>
            <FiArrowUpRight className="text-[18px] text-muted" />
          </button>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-line px-5 py-5">
          <button
            onClick={() => disconnect(undefined, { onSuccess: close })}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-danger/15 text-danger border border-danger/30 text-[15px] font-semibold hover:bg-danger/25 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <FiLogOut className="text-[15px]" />
            Disconnect
          </button>
        </div>
      </div>
    </>
  );
}
