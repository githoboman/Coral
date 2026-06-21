import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowUp } from "react-icons/fi";
import { GoArrowUpRight } from "react-icons/go";
import { useAgentWallet, type IntentResult, type DeepBookSetup } from "@/hooks/useAgentWallet";
import { AgentBotIcon } from "@/components/agent/AgentBotIcon";

/**
 * Chat-style agent surface — ported design-for-design from corral's `chat` screen
 * and wired to the real agent: each instruction becomes a user bubble, the parsed
 * `IntentResult` renders as a "Strategy Parsed" card, and a settled trade renders
 * an executed-tx card with an explorer link. No mocks — every send calls the real
 * sendIntent. Pre-policy/pre-wallet states route the user to create them first.
 */

const DEMO_DEEPBOOK = (agentAddress: string): DeepBookSetup => ({
  agentAddress,
  balanceManagerId:
    import.meta.env.VITE_AGENT_BALANCE_MANAGER ||
    "0xb79410bd70cc766ae137e1e74db412934d4a13678b8b6c67115d26814451ad93",
  poolKey: "SUI_DBUSDC",
});

const SUGGESTIONS = [
  { category: "Swap", icon: "/assets/icons/swap.svg", text: "Swap 1 SUI to USDC" },
  { category: "Percentage", icon: "/assets/icons/analyze.svg", text: "Swap 30% of my SUI to USDC" },
  { category: "Conditional", icon: "/assets/icons/limit.svg", text: "Buy SUI if it drops below 0.20" },
  { category: "Limit Order", icon: "/assets/icons/limit_circle.svg", text: "Place a limit order to buy 10 SUI at 0.20" },
];

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text?: string;
  result?: IntentResult;
}

export default function AgentChat() {
  const navigate = useNavigate();
  const { account, status, busy, error, initWallet, sendIntent } = useAgentWallet();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const thinking = busy === "thinking";
  const bound = status?.bound ?? false;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || !status?.agentAddress || !bound) return;
    setMessages((m) => [...m, { id: `u${Date.now()}`, sender: "user", text }]);
    setInput("");
    try {
      const result = await sendIntent(text, DEMO_DEEPBOOK(status.agentAddress));
      setMessages((m) => [...m, { id: `a${Date.now()}`, sender: "agent", result }]);
    } catch {
      /* error surfaced via hook banner */
    }
  };

  // ── Gated states (no wallet / no policy) ────────────────────────────
  if (!account?.address) {
    return (
      <Centered>
        <Hero subtitle="Connect your wallet from the header to start instructing the agent." />
      </Centered>
    );
  }

  if (!status || !bound) {
    return (
      <Centered>
        <Hero
          subtitle={
            !status
              ? "Initialize your agent wallet to begin."
              : "Create a policy to delegate trading within limits, then instruct the agent."
          }
        />
        <div className="mt-6 flex gap-3">
          {!status ? (
            <button
              onClick={() => initWallet()}
              disabled={busy !== "idle"}
              className="rounded-full bg-ink text-canvas px-5 py-2.5 text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {busy === "init" ? "Initializing…" : "Initialize agent"}
            </button>
          ) : (
            <button
              onClick={() => navigate("/agent/policy")}
              className="rounded-full bg-ink text-canvas px-5 py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
            >
              Create policy
            </button>
          )}
        </div>
        {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
      </Centered>
    );
  }

  // ── Chat surface ────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full bg-canvas overflow-hidden font-sans p-4 transition-colors duration-200">
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 pb-32 pt-4 flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-[720px] mx-auto w-full">
              <div className="w-16 h-16 bg-surface-2 rounded-2xl flex items-center justify-center shadow-sm mb-4 border border-line">
                <AgentBotIcon className="text-ink" width={34} height={38} />
              </div>
              <h2 className="text-[18px] font-medium text-ink/90 text-center mb-8">
                How can Coral help you on-chain today?
              </h2>
              <div className="grid grid-cols-2 gap-3.5 w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => send(s.text)}
                    disabled={thinking}
                    className="bg-surface border border-line rounded-2xl p-5 text-left transition-all hover:border-line-strong hover:bg-surface-3 disabled:opacity-50 cursor-pointer active:scale-[0.99] flex flex-col gap-2.5 shadow-sm"
                  >
                    <span className="flex items-center gap-1.5 text-muted text-[14px] font-light tracking-wider">
                      <img src={s.icon} alt="" width={20} height={20} className="object-contain flex-shrink-0 dark:[filter:brightness(0)_invert(0.85)]" />
                      {s.category}
                    </span>
                    <span className="text-ink font-medium text-[15px] leading-snug">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-[720px] w-full mx-auto space-y-6 flex-1">
              {messages.map((m) =>
                m.sender === "user" ? (
                  <div key={m.id} className="flex justify-end w-full">
                    <div className="bg-surface-2 border border-line text-ink px-6 py-3.5 rounded-[24px] rounded-tr-none text-[15px] max-w-[85%] shadow-sm">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-3 w-full">
                    <div className="w-8 h-8 rounded-xl bg-surface-2 flex items-center justify-center border border-line flex-shrink-0">
                      <AgentBotIcon className="text-muted" width={16} height={16} />
                    </div>
                    <div className="flex-1 min-w-0">{m.result && <ResultCard result={m.result} />}</div>
                  </div>
                ),
              )}
              {thinking && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-surface-2 flex items-center justify-center border border-line flex-shrink-0">
                    <AgentBotIcon className="text-muted" width={16} height={16} />
                  </div>
                  <div className="bg-surface border border-line px-5 py-3.5 rounded-2xl shadow-sm flex items-center gap-3">
                    <span className="text-[14px] text-muted">Parsing strategy…</span>
                    <div className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Floating input */}
        <div className="absolute bottom-2 left-0 right-0 px-6 flex justify-center bg-gradient-to-t from-canvas via-canvas/90 to-transparent pt-8 pb-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center justify-between w-full max-w-[720px] bg-surface border border-line rounded-full pl-6 pr-2.5 py-2.5 shadow-md focus-within:border-line-strong transition-all"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Instruct the agent…"
              disabled={thinking}
              className="bg-transparent border-0 outline-none w-full text-ink placeholder-faint text-[0.92rem] pr-4"
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              className="bg-ink text-canvas rounded-full w-[38px] h-[38px] flex items-center justify-center hover:opacity-90 transition-all cursor-pointer active:scale-95 flex-shrink-0 disabled:opacity-40"
            >
              <FiArrowUp className="text-[1.15rem]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full bg-canvas items-center justify-center flex-col px-6 transition-colors duration-200">
      {children}
    </div>
  );
}

function Hero({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center text-center max-w-[460px]">
      <div className="w-16 h-16 bg-surface-2 rounded-2xl flex items-center justify-center shadow-sm mb-4 border border-line">
        <AgentBotIcon className="text-ink" width={34} height={38} />
      </div>
      <h2 className="text-[20px] font-bold text-ink mb-2">How can Coral help you on-chain today?</h2>
      <p className="text-[14px] text-muted">{subtitle}</p>
    </div>
  );
}

/** Renders a real IntentResult as the Corral "Strategy Parsed" + outcome card. */
function ResultCard({ result }: { result: IntentResult }) {
  const { intent, ok, armed, message, outcome } = result;
  const armedLabel = armed === "conditional" ? "Watching price" : armed === "scheduled" ? "Scheduled" : null;

  return (
    <div className="bg-surface border border-line rounded-[28px] p-6 shadow-sm w-full">
      <div className="flex items-center gap-2 mb-5">
        <img src="/assets/icons/bot_blue.svg" alt="" width={28} height={28} className="object-contain flex-shrink-0" />
        <span className="text-[16px] font-bold text-ink">Strategy Parsed</span>
      </div>

      <div className="bg-surface-3 border border-line rounded-[20px] p-5 space-y-3">
        <Row label="Action" value={intent.action.replace(/_/g, " ")} />
        {intent.tokenIn && intent.tokenOut && <Row label="Pair" value={`${intent.tokenIn} / ${intent.tokenOut}`} />}
        {intent.amount != null && <Row label="Amount" value={String(intent.amount)} />}
        {intent.percentage != null && <Row label="Percentage" value={`${intent.percentage}%`} />}
        {intent.price != null && <Row label="Price" value={String(intent.price)} />}
        {intent.condition && <Row label="Condition" value={intent.condition} />}
        {intent.schedule && <Row label="Schedule" value={intent.schedule} />}
      </div>

      <p className="text-[12px] text-muted mt-3">
        Understood: <span className="text-ink">{intent.summary}</span>
      </p>

      <div
        className={`mt-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
          ok ? "border-positive/30 bg-positive/10" : "border-danger/30 bg-danger/10"
        }`}
      >
        <span className={`text-[13px] font-semibold ${ok ? "text-positive" : "text-danger"}`}>
          {armedLabel ? `⏳ ${message}` : ok ? `✅ ${message}` : `⚠️ ${message}`}
        </span>
        {ok && (
          <span className="bg-surface text-positive px-2.5 py-0.5 rounded-md text-xs font-bold flex-shrink-0">
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
          View TX <GoArrowUpRight className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[14px]">
      <span className="text-muted font-medium capitalize">{label}:</span>
      <span className="font-mono font-bold text-ink capitalize">{value}</span>
    </div>
  );
}
