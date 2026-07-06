import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowUp } from "react-icons/fi";
import { GoArrowUpRight } from "react-icons/go";
import { useAgentWallet, type IntentResult, type DeepBookSetup } from "@/hooks/useAgentWallet";
import { AgentBotIcon } from "@/components/agent/AgentBotIcon";

/**
 * Chat-style agent surface — orange/white/black redesign with whisk-motion
 * message entrances, orange send button pulse, and themed suggestion cards.
 */

const DEMO_DEEPBOOK = (agentAddress: string): DeepBookSetup => ({
  agentAddress,
  balanceManagerId:
    import.meta.env.VITE_AGENT_BALANCE_MANAGER ||
    "0xb79410bd70cc766ae137e1e74db412934d4a13678b8b6c67115d26814451ad93",
  poolKey: "SUI_DBUSDC",
});

const SUGGESTIONS = [
  { category: "Swap",       icon: "/assets/icons/swap.svg",         text: "Swap 1 SUI to USDC" },
  { category: "Percentage", icon: "/assets/icons/analyze.svg",      text: "Swap 30% of my SUI to USDC" },
  { category: "Conditional",icon: "/assets/icons/limit.svg",        text: "Buy SUI if it drops below 0.20" },
  { category: "Limit Order",icon: "/assets/icons/limit_circle.svg", text: "Place a limit order to buy 10 SUI at 0.20" },
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
  const [input,    setInput]    = useState("");
  const endRef  = useRef<HTMLDivElement>(null);
  const thinking = busy === "thinking";
  const bound    = status?.bound ?? false;

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

  // ── Gated: no wallet ───────────────────────────────────────────────
  if (!account?.address) {
    return (
      <Centered>
        <Hero subtitle="Connect your wallet from the header to start instructing the agent." />
      </Centered>
    );
  }

  // ── Gated: no policy ──────────────────────────────────────────────
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
              className="
                rounded-full bg-[var(--brand)] text-white px-6 py-3
                text-sm font-bold shadow-md
                hover:bg-[var(--brand-hover)] hover:shadow-[0_6px_20px_rgba(255,107,0,0.35)]
                hover:-translate-y-0.5
                disabled:opacity-50 disabled:pointer-events-none
                transition-all duration-150 active:scale-[0.96] cursor-pointer
              "
            >
              {busy === "init" ? "Initializing…" : "Initialize agent"}
            </button>
          ) : (
            <button
              onClick={() => navigate("/agent/policy")}
              className="
                rounded-full bg-[var(--brand)] text-white px-6 py-3
                text-sm font-bold shadow-md
                hover:bg-[var(--brand-hover)] hover:shadow-[0_6px_20px_rgba(255,107,0,0.35)]
                hover:-translate-y-0.5
                transition-all duration-150 active:scale-[0.96] cursor-pointer
              "
            >
              Create policy
            </button>
          )}
        </div>
        {error && <p className="mt-4 text-[13px] text-[var(--danger)]">{error}</p>}
      </Centered>
    );
  }

  // ── Chat surface ───────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full bg-[var(--canvas)] overflow-hidden font-sans transition-colors duration-200">
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-6 pb-32 pt-6 flex flex-col">
          {messages.length === 0 ? (

            /* ── Empty state / suggestion cards ── */
            <div className="flex-1 flex flex-col items-center justify-center max-w-[720px] mx-auto w-full">
              {/* Bot icon */}
              <div className="
                w-16 h-16 rounded-2xl flex items-center justify-center mb-4
                bg-[var(--brand-dim)] border border-[var(--brand)]/25
                shadow-sm
              ">
                <AgentBotIcon
                  className="[&_path]:fill-[var(--brand)]"
                  width={34}
                  height={38}
                />
              </div>

              <h2 className="text-[18px] font-bold text-[var(--ink)] text-center mb-2">
                How can Coral help you on-chain today?
              </h2>
              <p className="text-[13px] text-[var(--muted)] text-center mb-8">
                Type a command or choose a suggestion below
              </p>

              <div className="grid grid-cols-2 gap-3 w-full">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.text}
                    onClick={() => send(s.text)}
                    disabled={thinking}
                    className={`
                      whisk-in whisk-d${i + 1}
                      card-hover
                      bg-[var(--surface)] border border-[var(--line)]
                      rounded-2xl p-5 text-left
                      disabled:opacity-50 cursor-pointer
                      flex flex-col gap-2.5 shadow-sm
                    `}
                  >
                    <span className="flex items-center gap-1.5 text-[var(--brand)] text-[13px] font-semibold tracking-wide">
                      <img
                        src={s.icon}
                        alt=""
                        width={18}
                        height={18}
                        className="object-contain flex-shrink-0 [filter:invert(45%)_sepia(90%)_saturate(600%)_hue-rotate(10deg)_brightness(95%)]"
                      />
                      {s.category}
                    </span>
                    <span className="text-[var(--ink)] font-medium text-[14px] leading-snug">
                      {s.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>

          ) : (

            /* ── Messages ── */
            <div className="max-w-[720px] w-full mx-auto space-y-5 flex-1">
              {messages.map((m) =>
                m.sender === "user" ? (
                  <div key={m.id} className="flex justify-end w-full whisk-slide-right">
                    <div className="
                      bg-[var(--brand)] text-white
                      px-5 py-3.5 rounded-[22px] rounded-tr-sm
                      text-[14.5px] max-w-[82%] shadow-md
                      font-medium leading-relaxed
                    ">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-3 w-full whisk-in">
                    <div className="
                      w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0
                      bg-[var(--brand-dim)] border border-[var(--brand)]/25
                    ">
                      <AgentBotIcon
                        className="[&_path]:fill-[var(--brand)]"
                        width={16}
                        height={16}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      {m.result && <ResultCard result={m.result} />}
                    </div>
                  </div>
                ),
              )}

              {/* Thinking state */}
              {thinking && (
                <div className="flex items-center gap-3 whisk-in">
                  <div className="
                    w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0
                    bg-[var(--brand-dim)] border border-[var(--brand)]/25
                  ">
                    <AgentBotIcon
                      className="[&_path]:fill-[var(--brand)]"
                      width={16}
                      height={16}
                    />
                  </div>
                  <div className="
                    bg-[var(--surface)] border border-[var(--line)]
                    px-5 py-3.5 rounded-2xl shadow-sm
                    flex items-center gap-3
                  ">
                    <span className="text-[13px] text-[var(--muted)]">Parsing strategy…</span>
                    <div className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span
                          key={d}
                          className="w-1.5 h-1.5 rounded-full bg-[var(--brand)]"
                          style={{
                            animation: `thinking-dot 1.2s ease-in-out ${d}ms infinite`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* ── Floating input bar ── */}
        <div className="
          absolute bottom-2 left-0 right-0 px-6
          flex justify-center
          bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)]/90 to-transparent
          pt-10 pb-3
        ">
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="
              flex items-center justify-between w-full max-w-[720px]
              bg-[var(--surface)] border border-[var(--line)]
              rounded-full pl-5 pr-2 py-2
              shadow-lg
              focus-within:border-[var(--brand)]
              focus-within:shadow-[0_0_0_3px_rgba(255,107,0,0.15)]
              transition-all duration-200
            "
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Instruct the agent…"
              disabled={thinking}
              className="
                bg-transparent border-0 outline-none w-full
                text-[var(--ink)] placeholder:text-[var(--faint)]
                text-[0.92rem] pr-4
              "
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              className="
                bg-[var(--brand)] text-white
                rounded-full w-[38px] h-[38px]
                flex items-center justify-center
                flex-shrink-0
                hover:bg-[var(--brand-hover)]
                hover:shadow-[0_4px_14px_rgba(255,107,0,0.40)]
                disabled:opacity-35 disabled:pointer-events-none
                active:scale-90
                transition-all duration-150 cursor-pointer
                whisk-pulse-ring
              "
            >
              <FiArrowUp className="text-[1.1rem]" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────── */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full bg-[var(--canvas)] items-center justify-center flex-col px-6 transition-colors duration-200">
      {children}
    </div>
  );
}

function Hero({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center text-center max-w-[460px] whisk-in">
      <div className="
        w-16 h-16 rounded-2xl flex items-center justify-center mb-4
        bg-[var(--brand-dim)] border border-[var(--brand)]/25
        shadow-sm
      ">
        <AgentBotIcon
          className="[&_path]:fill-[var(--brand)]"
          width={34}
          height={38}
        />
      </div>
      <h2 className="text-[22px] font-bold text-[var(--ink)] mb-2">
        How can Coral help you on-chain today?
      </h2>
      <p className="text-[14px] text-[var(--muted)]">{subtitle}</p>
    </div>
  );
}

/** Renders a real IntentResult as the Corral "Strategy Parsed" + outcome card. */
function ResultCard({ result }: { result: IntentResult }) {
  const { intent, ok, armed, message, outcome } = result;
  const armedLabel =
    armed === "conditional" ? "Watching price" : armed === "scheduled" ? "Scheduled" : null;

  return (
    <div className="
      bg-[var(--surface)] border border-[var(--line)]
      rounded-[24px] p-5 shadow-sm w-full
      card-hover
    ">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <img
          src="/assets/icons/bot_blue.svg"
          alt=""
          width={24}
          height={24}
          className="object-contain flex-shrink-0"
        />
        <span className="text-[15px] font-bold text-[var(--ink)]">Strategy Parsed</span>
      </div>

      {/* Intent details */}
      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-[18px] p-4 space-y-2.5">
        <Row label="Action"     value={intent.action.replace(/_/g, " ")} />
        {intent.tokenIn  && intent.tokenOut && <Row label="Pair"       value={`${intent.tokenIn} / ${intent.tokenOut}`} />}
        {intent.amount   != null && <Row label="Amount"      value={String(intent.amount)} />}
        {intent.percentage != null && <Row label="Percentage" value={`${intent.percentage}%`} />}
        {intent.price    != null && <Row label="Price"       value={String(intent.price)} />}
        {intent.condition  && <Row label="Condition"  value={intent.condition} />}
        {intent.schedule   && <Row label="Schedule"   value={intent.schedule} />}
      </div>

      <p className="text-[12px] text-[var(--muted)] mt-3">
        Understood: <span className="text-[var(--ink)]">{intent.summary}</span>
      </p>

      {/* Outcome badge */}
      <div
        className={`
          mt-4 flex items-center justify-between gap-3
          rounded-xl border px-4 py-3
          ${ok
            ? "border-[var(--positive)]/30 bg-[var(--positive)]/10"
            : "border-[var(--danger)]/30 bg-[var(--danger)]/10"
          }
        `}
      >
        <span className={`text-[13px] font-semibold ${ok ? "text-[var(--positive)]" : "text-[var(--danger)]"}`}>
          {armedLabel ? `⏳ ${message}` : ok ? `✅ ${message}` : `⚠️ ${message}`}
        </span>
        {ok && (
          <span className="bg-[var(--surface)] text-[var(--positive)] px-2.5 py-0.5 rounded-md text-xs font-bold flex-shrink-0">
            {armedLabel ?? "Success"}
          </span>
        )}
      </div>

      {/* Explorer link */}
      {outcome?.digest && (
        <a
          href={`https://testnet.suivision.xyz/txblock/${outcome.digest}`}
          target="_blank"
          rel="noreferrer"
          className="
            mt-3 inline-flex items-center gap-1.5
            text-[var(--brand)] hover:underline
            text-[13px] font-bold transition-colors
          "
        >
          View TX <GoArrowUpRight className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13.5px]">
      <span className="text-[var(--muted)] font-medium capitalize">{label}:</span>
      <span className="font-mono font-bold text-[var(--ink)] capitalize">{value}</span>
    </div>
  );
}
