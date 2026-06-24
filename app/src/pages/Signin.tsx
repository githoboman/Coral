import { useState, useEffect } from "react";
import { useConnectWallet, useWallets, useCurrentAccount } from "@mysten/dapp-kit";
import { isEnokiWallet, type AuthProvider } from "@mysten/enoki";
import { sileo } from "sileo";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiShield,
  FiClock,
  FiZap,
  FiList,
  FiDroplet,
  FiLock,
  FiCpu,
  FiCheckCircle,
} from "react-icons/fi";
import { POLICY_FIELDS, AGENT_TASKS } from "@/components/agent/CoralGuide";

const SocialIconGoogle = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.43-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const TASK_ICONS = [<FiZap />, <FiDroplet />, <FiList />, <FiShield />, <FiClock />, <FiList />];

export default function Signin() {
  const { mutate: connect } = useConnectWallet();
  const allWallets = useWallets();
  const currentAccount = useCurrentAccount();
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);

  const enokiWallets = allWallets.filter(isEnokiWallet);
  const nativeWallets = allWallets.filter((w) => !isEnokiWallet(w));
  const walletsByProvider = enokiWallets.reduce(
    (map, wallet) => map.set(wallet.provider, wallet),
    new Map<AuthProvider, any>(),
  );
  const googleWallet = walletsByProvider.get("google");

  useEffect(() => {
    if (import.meta.env.VITE_MAINTENANCE_MODE === "true" || (import.meta.env.VITE_MAINTENANCE_MODE as unknown) === true) {
      navigate("/maintenance");
      return;
    }
    if (currentAccount) navigate("/");
  }, [currentAccount, navigate]);

  const handleGoogleSignIn = () => {
    if (googleWallet) {
      setIsConnecting(true);
      connect(
        { wallet: googleWallet },
        {
          onSuccess: () => { setIsConnecting(false); navigate("/"); },
          onError: (error) => { setIsConnecting(false); sileo.error({ title: "Connection Failed", description: error.message || "Failed to connect with Google" }); },
        },
      );
    } else {
      sileo.error({ title: "Google Sign-in Unavailable", description: "Check your Enoki configuration." });
    }
  };

  const handleWalletConnect = (wallet: any) => {
    setIsConnecting(true);
    connect(
      { wallet },
      {
        onSuccess: () => { setIsConnecting(false); navigate("/"); },
        onError: (error) => { setIsConnecting(false); sileo.error({ title: "Connection Failed", description: error.message || "Failed to connect wallet" }); },
      },
    );
  };

  const scrollToConnect = () =>
    document.getElementById("connect")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="relative min-h-screen w-full bg-[#070B0F] text-white overflow-x-hidden">
      {/* ── Ambient background ─────────────────────────────────────────── */}
      <div className="coral-aurora fixed inset-0 bg-[linear-gradient(120deg,rgba(255,106,77,0.10),transparent_35%,rgba(43,135,209,0.08)_60%,transparent_80%)]" />
      <div className="coral-orb pointer-events-none fixed -top-40 -left-32 w-[480px] h-[480px] rounded-full bg-[radial-gradient(circle,rgba(255,106,77,0.20),transparent_70%)] blur-3xl" />
      <div className="coral-orb-slow pointer-events-none fixed top-1/3 -right-40 w-[560px] h-[560px] rounded-full bg-[radial-gradient(circle,rgba(43,135,209,0.16),transparent_70%)] blur-3xl" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.035] bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:54px_54px]" />

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="relative z-20 mx-auto max-w-6xl flex items-center justify-between px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-2">
          <img src="/assets/coral-mark.svg" alt="Coral" className="w-9 h-9 sm:w-10 sm:h-10" />
          <span className="font-bold text-base sm:text-lg tracking-tight">Coral</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] font-medium text-white/50">
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" /> Sui Testnet
          </span>
          <button onClick={scrollToConnect} className="rounded-full bg-white text-[#070B0F] font-semibold text-[12px] sm:text-[13px] px-3.5 sm:px-4 py-1.5 sm:py-2 hover:bg-white/90 transition-all cursor-pointer">
            Launch app
          </button>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pt-8 sm:pt-14 pb-12 sm:pb-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-12 items-center">
        <div className="coral-fade-up coral-d1">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#FF6A4D]/30 bg-[#FF6A4D]/10 px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold text-[#FF9472] mb-5 sm:mb-6">
            <FiCpu className="text-[13px]" /> Agentic Web · Autonomous on-chain trading
          </span>
          <h1 className="text-[32px] sm:text-[48px] lg:text-[58px] font-bold leading-[1.08] sm:leading-[1.05] tracking-tight">
            An AI agent that <span className="coral-shimmer">trades for you</span> — within limits enforced{" "}
            <span className="text-[#FF9472]">on-chain</span>.
          </h1>
          <p className="mt-5 sm:mt-6 text-[15px] sm:text-[17px] leading-relaxed text-white/60 max-w-[560px]">
            Coral holds its own wallet and signs its own DeepBook trades — true autonomy. You set the
            rules once into a Move policy, and the chain enforces them. Even a compromised key
            <span className="text-white/80"> cannot overspend, trade off-whitelist, or act past expiry.</span>
          </p>
          <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
            <button onClick={scrollToConnect} className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#FF6A4D] hover:bg-[#FF7A5E] text-white font-semibold px-6 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(255,106,77,0.35)] cursor-pointer">
              Connect & delegate
              <FiArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="#how" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3.5 font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all">
              See how it works
            </a>
          </div>
          {/* The distinction — the pitch */}
          <div className="mt-8 sm:mt-10 grid grid-cols-3 gap-2.5 sm:gap-3 max-w-[560px]">
            {[
              { k: "Agent decides", v: "Parses your plain-language intent" },
              { k: "Agent signs", v: "Its own key — no per-trade approval" },
              { k: "Policy restricts", v: "Move contract enforces every rule" },
            ].map((c) => (
              <div key={c.k} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[13px] font-bold text-white">{c.k}</div>
                <div className="text-[11px] leading-snug text-white/45 mt-1">{c.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Connect card */}
        <div id="connect" className="coral-fade-up coral-d3 w-full scroll-mt-24">
          <div className="rounded-[28px] border border-white/10 bg-[#0D1117]/70 backdrop-blur-xl p-5 sm:p-7 shadow-[0_30px_80px_-20px_rgba(255,106,77,0.25),0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-3 mb-1">
              <div className="coral-pulse-ring w-12 h-12 rounded-2xl flex items-center justify-center">
                <img src="/assets/coral-mark.svg" alt="" className="w-12 h-12" />
              </div>
              <div>
                <h2 className="text-[20px] font-bold leading-none">Get started</h2>
                <p className="text-[12px] text-white/45 mt-1">Connect a Sui wallet to delegate the agent</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {googleWallet && (
                <button onClick={handleGoogleSignIn} disabled={isConnecting} className="w-full bg-[#1A1F24] hover:bg-[#252A30] border border-white/5 rounded-2xl py-4 px-6 flex items-center justify-center gap-3 transition-all duration-300 disabled:opacity-50 font-medium cursor-pointer hover:border-white/15">
                  <SocialIconGoogle />
                  <span className="text-base">Continue with Google</span>
                </button>
              )}
              {googleWallet && nativeWallets.length > 0 && (
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                  <div className="relative flex justify-center"><span className="bg-[#0D1117] px-4 text-white/30 text-[11px] font-medium uppercase tracking-widest">or connect wallet</span></div>
                </div>
              )}
              {nativeWallets.length > 0 ? (
                nativeWallets.map((wallet) => (
                  <button key={wallet.name} onClick={() => handleWalletConnect(wallet)} disabled={isConnecting} className="w-full bg-[#1A1F24]/50 hover:bg-[#252A30] border border-white/5 rounded-2xl py-4 px-6 flex items-center justify-center gap-3 transition-all duration-300 disabled:opacity-50 font-medium cursor-pointer hover:border-[#FF6A4D]/30">
                    {wallet.icon && <img src={wallet.icon} alt={wallet.name} className="w-5 h-5" />}
                    <span className="text-white/85 text-base">{wallet.name}</span>
                  </button>
                ))
              ) : !googleWallet && (
                <div className="text-center py-6">
                  <p className="text-white/40 text-sm mb-4 leading-relaxed">No wallet detected. Install a Sui wallet extension to continue.</p>
                  <a href="https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#FF6A4D] hover:text-[#FF9472] text-sm font-semibold transition-colors">
                    Install Sui Wallet <FiArrowRight className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>

            {isConnecting ? (
              <div className="flex items-center justify-center gap-3 mt-6">
                <div className="w-5 h-5 border-2 border-[#FF6A4D]/20 border-t-[#FF6A4D] rounded-full animate-spin" />
                <p className="text-[#FF6A4D] text-sm font-medium animate-pulse">Requesting connection…</p>
              </div>
            ) : (
              <p className="text-white/25 text-[11px] mt-6 text-center">
                By connecting you agree to the{" "}
                <span className="text-[#FF9472] cursor-pointer hover:text-white/70">Terms</span> &{" "}
                <span className="text-[#FF9472] cursor-pointer hover:text-white/70">Privacy Policy</span>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 border-t border-white/5 scroll-mt-20">
        <SectionHeader eyebrow="How it works" title="Three steps, one signature" />
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { n: "01", icon: <FiShield />, t: "Set a policy", d: "Define your budget, the tokens the agent may touch, and an expiry. Sign once — this is the only approval you ever give." },
            { n: "02", icon: <FiZap />, t: "Instruct in plain language", d: "“Swap 30% of my SUI to USDC.” The agent parses your intent and checks it against your policy before doing anything." },
            { n: "03", icon: <FiCheckCircle />, t: "It trades — you stay in control", d: "Real DeepBook V3 swaps execute autonomously. Revoke any time and the agent's next action fails on-chain." },
          ].map((s) => (
            <div key={s.n} className="group relative rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-7 hover:border-[#FF6A4D]/30 hover:bg-white/[0.05] transition-all">
              <div className="flex items-center justify-between mb-5">
                <span className="text-[44px] font-bold text-white/10 leading-none group-hover:text-[#FF6A4D]/20 transition-colors">{s.n}</span>
                <span className="w-11 h-11 rounded-2xl bg-[#FF6A4D]/12 text-[#FF9472] flex items-center justify-center text-[20px]">{s.icon}</span>
              </div>
              <h3 className="text-[18px] font-bold mb-2">{s.t}</h3>
              <p className="text-[14px] leading-relaxed text-white/50">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Policy guide ───────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 border-t border-white/5">
        <SectionHeader
          eyebrow="The policy"
          title="The rules you set — enforced by a Move contract"
          subtitle="You configure these once at delegation. The on-chain AgentPolicy checks every action against them; anything outside the rules is aborted by the contract, not by trust."
        />
        <div className="grid md:grid-cols-2 gap-4">
          {POLICY_FIELDS.map((f) => (
            <div key={f.name} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 hover:border-white/20 transition-all">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-[17px] font-bold">{f.name}</h3>
                <span className="text-[12px] font-mono font-bold text-[#FF9472] bg-[#FF6A4D]/10 border border-[#FF6A4D]/20 rounded-lg px-2.5 py-1 whitespace-nowrap">{f.example}</span>
              </div>
              <div className="text-[14px] font-semibold text-white/85 mb-1.5">{f.what}</div>
              <p className="text-[13px] leading-relaxed text-white/45">{f.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-3xl border border-[#FF6A4D]/20 bg-[#FF6A4D]/[0.06] p-6 flex items-start gap-4">
          <FiLock className="text-[22px] text-[#FF9472] flex-shrink-0 mt-0.5" />
          <p className="text-[14px] leading-relaxed text-white/70">
            <span className="font-semibold text-white">How much SUI do I need?</span> The agent is its own
            on-chain wallet, so fund it with a little SUI for gas (≈0.1 SUI is plenty for a demo). Your{" "}
            <span className="font-semibold text-white">budget cap</span> is the spending ceiling — the demo
            defaults to 50 SUI (<span className="font-mono">50,000,000,000</span> base units) so swaps fit comfortably.
          </p>
        </div>
      </section>

      {/* ── Agent capabilities ─────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16 border-t border-white/5">
        <SectionHeader
          eyebrow="Capabilities"
          title="What you can ask the agent to do"
          subtitle="Every request is parsed from natural language, then validated against your policy on-chain before it runs."
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENT_TASKS.map((t, i) => (
            <div key={t.name} className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 hover:border-[#FF6A4D]/30 hover:-translate-y-0.5 transition-all">
              <span className="w-11 h-11 rounded-2xl bg-white/5 text-[#FF9472] flex items-center justify-center text-[20px] mb-4 group-hover:bg-[#FF6A4D]/12 transition-colors">
                {TASK_ICONS[i]}
              </span>
              <h3 className="text-[16px] font-bold mb-2">{t.name}</h3>
              <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2 text-[12.5px] font-mono text-[#FF9472] mb-3">{t.prompt}</div>
              <p className="text-[13px] leading-relaxed text-white/50">{t.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-16 sm:py-20 text-center">
        <h2 className="text-[28px] sm:text-[40px] font-bold tracking-tight">
          Delegate trading, <span className="text-[#FF9472]">keep control</span>.
        </h2>
        <p className="mt-4 text-[16px] text-white/55 max-w-[520px] mx-auto">
          Bounded autonomy for the agentic web — built on Sui, powered by DeepBook V3.
        </p>
        <button onClick={scrollToConnect} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#FF6A4D] hover:bg-[#FF7A5E] text-white font-semibold px-8 py-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(255,106,77,0.35)] cursor-pointer">
          Connect your wallet <FiArrowRight />
        </button>
      </section>

      <footer className="relative z-10 border-t border-white/5 py-8 text-center text-[12px] text-white/30">
        <div className="flex items-center justify-center gap-2 mb-2">
          <img src="/assets/coral-mark.svg" alt="" className="w-5 h-5 opacity-60" />
          <span className="font-semibold text-white/50">Coral</span>
        </div>
        Autonomous Agent Wallet · Sui Overflow 2026 · Agentic Web
      </footer>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-7 sm:mb-9 max-w-2xl">
      <div className="text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.18em] text-[#FF9472] mb-2.5 sm:mb-3">{eyebrow}</div>
      <h2 className="text-[24px] sm:text-[36px] font-bold tracking-tight leading-tight">{title}</h2>
      {subtitle && <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-white/55">{subtitle}</p>}
    </div>
  );
}
