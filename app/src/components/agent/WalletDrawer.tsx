import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiCopy, FiX, FiLogOut, FiArrowUpRight, FiUser, FiCpu, FiExternalLink,
  FiAlertTriangle, FiArrowUpRight as FiSend, FiDownloadCloud, FiChevronLeft, FiCheckCircle,
} from "react-icons/fi";
import { TokenSUI } from "@web3icons/react";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from "@mysten/dapp-kit";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { QrCode } from "@/components/agent/QrCode";

type Which = "owner" | "agent";
type View =
  | { kind: "main" }
  | { kind: "send"; which: Which }
  | { kind: "receive"; which: Which };

/**
 * Slide-out wallet drawer. The whole point of this rewrite is to make the TWO
 * wallets unmistakable:
 *   • Your Wallet  — the connected owner wallet. Signs policy + revoke.
 *   • Agent Wallet — the autonomous account the agent trades from. Must be funded
 *     with SUI (gas) for any on-chain action to work.
 * Both show a live SUI balance; the agent card nudges you to fund it when low.
 */
const MIST = 1_000_000_000;
const FUND_THRESHOLD = 1; // SUI — below this, the agent can't reliably trade/revoke

export function WalletDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { status, agentSend, ownerSend } = useAgentWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState<"owner" | "agent" | null>(null);
  const [view, setView] = useState<View>({ kind: "main" });

  const ownerAddr = account?.address ?? "";
  const agentAddr = status?.agentAddress ?? "";
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";

  const { data: ownerBal } = useSuiClientQuery(
    "getBalance",
    { owner: ownerAddr },
    { enabled: !!ownerAddr, refetchInterval: 15_000 },
  );
  const { data: agentBal } = useSuiClientQuery(
    "getBalance",
    { owner: agentAddr },
    { enabled: !!agentAddr, refetchInterval: 15_000 },
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const toSui = (b: any) => (b ? Number(b.totalBalance) / MIST : 0);
  const ownerSui = toSui(ownerBal);
  const agentSui = toSui(agentBal);

  const copy = (which: "owner" | "agent", addr: string) => {
    if (!addr) return;
    navigator.clipboard?.writeText(addr);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const faucetUrl = `https://faucet.sui.io/?network=${network}&address=${agentAddr}`;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20 dark:bg-black/40 transition-opacity" onClick={close} />
      <div
        className="fixed right-0 top-0 z-[100] h-screen w-[380px] max-w-full flex flex-col bg-surface/95 backdrop-blur-2xl border-l border-line shadow-[-12px_0_48px_rgba(0,0,0,0.15)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-2">
            {view.kind !== "main" && (
              <button onClick={() => setView({ kind: "main" })} className="w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer" title="Back">
                <FiChevronLeft className="text-[18px]" />
              </button>
            )}
            <div>
              <h2 className="text-[20px] font-bold text-ink leading-tight">
                {view.kind === "send" ? "Send" : view.kind === "receive" ? "Receive" : "Wallets"}
              </h2>
              <p className="text-[12px] text-muted mt-0.5">
                {view.kind === "main"
                  ? "Two accounts — you sign, the agent trades."
                  : `${view.which === "owner" ? "Your" : "Agent"} wallet`}
              </p>
            </div>
          </div>
          <button onClick={close} className="w-8 h-8 flex items-center justify-center text-muted hover:text-ink transition-colors cursor-pointer">
            <FiX className="text-[22px]" />
          </button>
        </div>

        {/* SEND view */}
        {view.kind === "send" && (
          <SendPanel
            which={view.which}
            fromAddr={view.which === "owner" ? ownerAddr : agentAddr}
            maxSui={view.which === "owner" ? ownerSui : agentSui}
            onSend={async (recipient, symbol, amount) =>
              view.which === "owner"
                ? ownerSend(recipient, amount)
                : agentSend(recipient, symbol, amount)
            }
            onDone={() => setView({ kind: "main" })}
          />
        )}

        {/* RECEIVE view */}
        {view.kind === "receive" && (
          <ReceivePanel
            which={view.which}
            address={view.which === "owner" ? ownerAddr : agentAddr}
            onCopy={() => copy(view.which, view.which === "owner" ? ownerAddr : agentAddr)}
            copied={copied === view.which}
          />
        )}

        {/* Body (main) */}
        {view.kind === "main" && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* YOUR WALLET (owner) */}
          <div>
            <WalletCard
              tone="owner"
              icon={<FiUser />}
              label="Your Wallet"
              role="Signs policy & revoke"
              address={ownerAddr}
              sui={ownerSui}
              network={network}
              copied={copied === "owner"}
              onCopy={() => copy("owner", ownerAddr)}
            />
            <SendReceiveRow onSend={() => setView({ kind: "send", which: "owner" })} onReceive={() => setView({ kind: "receive", which: "owner" })} />
          </div>

          {/* AGENT WALLET */}
          {agentAddr ? (
            <div>
              <WalletCard
                tone="agent"
                icon={<FiCpu />}
                label="Agent Wallet"
                role="Trades autonomously · needs SUI for gas"
                address={agentAddr}
                sui={agentSui}
                network={network}
                copied={copied === "agent"}
                onCopy={() => copy("agent", agentAddr)}
              />
              <SendReceiveRow onSend={() => setView({ kind: "send", which: "agent" })} onReceive={() => setView({ kind: "receive", which: "agent" })} />
              {agentSui < FUND_THRESHOLD && (
                <div className="mt-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-amber-600 dark:text-amber-400 mb-1">
                    <FiAlertTriangle /> Fund the agent to trade
                  </div>
                  <p className="text-[12px] text-muted leading-relaxed mb-3">
                    The agent needs SUI in <span className="font-semibold">its own</span> wallet (above) to pay gas
                    and settle swaps — not your wallet. Send testnet SUI to the agent address.
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={faucetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-ink text-canvas text-[13px] font-semibold py-2.5 transition-all active:scale-[0.98]"
                    >
                      Open faucet <FiExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => copy("agent", agentAddr)}
                      className="rounded-full border border-line bg-surface text-[13px] font-semibold text-ink px-4 py-2.5 hover:bg-surface-3 transition-all cursor-pointer"
                    >
                      {copied === "agent" ? "Copied!" : "Copy address"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface-3 p-4 text-[13px] text-muted">
              No agent wallet yet. Initialize the agent from the chat to create its account.
            </div>
          )}

          <button
            onClick={() => { close(); navigate("/agent/activity"); }}
            className="w-full flex items-center justify-between bg-surface border border-line rounded-[14px] px-4 py-3.5 shadow-sm hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <span className="text-[14px] font-medium text-ink">View agent activity</span>
            <FiArrowUpRight className="text-[18px] text-muted" />
          </button>
        </div>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-line px-5 py-5">
          <button
            onClick={() => disconnect(undefined, { onSuccess: close })}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-danger/15 text-danger border border-danger/30 text-[15px] font-semibold hover:bg-danger/25 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <FiLogOut className="text-[15px]" />
            Disconnect your wallet
          </button>
        </div>
      </div>
    </>
  );
}

function WalletCard({
  tone,
  icon,
  label,
  role,
  address,
  sui,
  network,
  copied,
  onCopy,
}: {
  tone: "owner" | "agent";
  icon: React.ReactNode;
  label: string;
  role: string;
  address: string;
  sui: number;
  network: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const accent =
    tone === "agent"
      ? "border-[#FF6A4D]/30 bg-[#FF6A4D]/[0.06]"
      : "border-line bg-surface-3";
  const badge =
    tone === "agent"
      ? "bg-[#FF6A4D]/15 text-[#FF6A4D]"
      : "bg-ink/10 text-ink";
  const short = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—";
  const explorer = `https://${network === "mainnet" ? "" : network + "."}suivision.xyz/account/${address}`;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-[16px] ${badge}`}>{icon}</span>
          <div>
            <div className="text-[14px] font-bold text-ink leading-none">{label}</div>
            <div className="text-[11px] text-muted mt-1">{role}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold font-mono text-ink leading-none">
            {sui.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
          <div className="text-[10px] text-muted mt-1 flex items-center justify-end gap-1">
            <TokenSUI variant="background" size={11} className="rounded-full overflow-hidden" /> SUI
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line/60 pt-2.5">
        <span className="text-[12px] font-mono text-muted">{short}</span>
        <div className="flex items-center gap-2">
          <button onClick={onCopy} className="text-muted hover:text-ink transition-colors cursor-pointer" title="Copy">
            {copied ? <span className="text-[11px] font-semibold text-positive">copied</span> : <FiCopy className="w-3.5 h-3.5" />}
          </button>
          {address && (
            <a href={explorer} target="_blank" rel="noreferrer" className="text-muted hover:text-ink transition-colors" title="Explorer">
              <FiExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Send / Receive action row under a wallet card. */
function SendReceiveRow({ onSend, onReceive }: { onSend: () => void; onReceive: () => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button
        onClick={onSend}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface text-[13px] font-semibold text-ink py-2.5 hover:bg-surface-3 transition-all active:scale-[0.98] cursor-pointer"
      >
        <FiSend className="w-4 h-4" /> Send
      </button>
      <button
        onClick={onReceive}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface text-[13px] font-semibold text-ink py-2.5 hover:bg-surface-3 transition-all active:scale-[0.98] cursor-pointer"
      >
        <FiDownloadCloud className="w-4 h-4" /> Receive
      </button>
    </div>
  );
}

/** Receive panel: QR + address to fund a wallet. */
function ReceivePanel({ which, address, onCopy, copied }: { which: Which; address: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col items-center text-center">
      <p className="text-[13px] text-muted mb-5 max-w-[260px]">
        Send SUI or tokens to this {which === "agent" ? "agent" : ""} address to fund it. Scan the code or copy the address.
      </p>
      <QrCode value={address} size={180} />
      <div className="mt-5 w-full rounded-2xl border border-line bg-surface-3 p-4">
        <div className="text-[11px] font-bold text-faint uppercase tracking-wider mb-1.5">Address</div>
        <div className="font-mono text-[12.5px] text-ink break-all leading-relaxed">{address}</div>
      </div>
      <button
        onClick={onCopy}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full bg-ink text-canvas text-[14px] font-semibold py-3 transition-all active:scale-[0.98] cursor-pointer"
      >
        {copied ? <><FiCheckCircle className="w-4 h-4" /> Copied!</> : <><FiCopy className="w-4 h-4" /> Copy address</>}
      </button>
    </div>
  );
}

/** Send panel: amount + recipient, signs a transfer. */
function SendPanel({
  which,
  fromAddr,
  maxSui,
  onSend,
  onDone,
}: {
  which: Which;
  fromAddr: string;
  maxSui: number;
  onSend: (recipient: string, symbol: string, amount: number) => Promise<{ digest?: string }>;
  onDone: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [symbol] = useState("SUI"); // SUI transfers cover the funding use-case
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okDigest, setOkDigest] = useState<string | null>(null);
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";

  const amt = Number(amount);
  const valid = recipient.startsWith("0x") && recipient.length >= 10 && amt > 0 && amt <= maxSui;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await onSend(recipient.trim(), symbol, amt);
      setOkDigest(r.digest ?? "sent");
    } catch (e: any) {
      setErr(e?.message ?? "Send failed");
    } finally {
      setBusy(false);
    }
  };

  if (okDigest) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-positive/15 text-positive flex items-center justify-center mb-4">
          <FiCheckCircle className="w-7 h-7" />
        </div>
        <h3 className="text-[18px] font-bold text-ink mb-1">Sent</h3>
        <p className="text-[13px] text-muted mb-5">{amt} {symbol} sent from the {which} wallet.</p>
        {okDigest !== "sent" && (
          <a
            href={`https://${network === "mainnet" ? "" : network + "."}suivision.xyz/txblock/${okDigest}`}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-bold text-[#4F46E5] dark:text-[#818CF8] hover:underline inline-flex items-center gap-1.5 mb-5"
          >
            View transaction <FiExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        <button onClick={onDone} className="w-full rounded-full bg-ink text-canvas text-[14px] font-semibold py-3 transition-all active:scale-[0.98] cursor-pointer">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      <div className="rounded-2xl border border-line bg-surface-3 p-3 text-[12px] text-muted">
        From <span className="font-mono text-ink">{fromAddr.slice(0, 8)}…{fromAddr.slice(-6)}</span> · balance{" "}
        <span className="font-mono font-bold text-ink">{maxSui.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI</span>
      </div>

      <div>
        <label className="text-[12px] font-semibold text-muted block mb-1.5">Recipient address</label>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="0x…"
          className="w-full rounded-xl bg-surface border border-line px-4 py-3 text-[14px] font-mono text-ink outline-none focus:border-ink/40"
        />
      </div>

      <div>
        <label className="text-[12px] font-semibold text-muted block mb-1.5">Amount (SUI)</label>
        <div className="relative">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            className="w-full rounded-xl bg-surface border border-line px-4 py-3 pr-16 text-[14px] font-mono text-ink outline-none focus:border-ink/40"
          />
          <button
            onClick={() => setAmount(String(Math.max(0, maxSui - (which === "owner" ? 0.05 : 0.05))))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-brand hover:underline"
          >
            MAX
          </button>
        </div>
        {amt > maxSui && <p className="text-[11px] text-danger mt-1">Amount exceeds balance.</p>}
      </div>

      {err && <div className="rounded-xl bg-danger/10 border border-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}

      <button
        onClick={submit}
        disabled={!valid || busy}
        className="w-full rounded-full bg-ink text-canvas text-[14px] font-semibold py-3 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer inline-flex items-center justify-center gap-2"
      >
        {busy ? "Sending…" : <><FiSend className="w-4 h-4" /> Send {symbol}</>}
      </button>
      {which === "owner" && (
        <p className="text-[11px] text-muted text-center">You'll sign this transfer in your wallet.</p>
      )}
    </div>
  );
}
