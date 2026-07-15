import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { MdOutlineMenuOpen } from "react-icons/md";
import { ConnectButton, useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { useTheme } from "@/hooks/useTheme";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { WalletDrawer } from "@/components/agent/WalletDrawer";
import { NotificationBell } from "@/components/agent/NotificationBell";
import { HelpModal } from "@/components/agent/HelpModal";
import { Tutorial, hasSeenTutorial, markTutorialSeen } from "@/components/agent/Tutorial";

/**
 * Coral app shell — redesigned with orange/white/black palette,
 * whisk-motion sidebar, and full light/dark mode coverage.
 */

interface TabItem {
  name: string;
  href: string;
  icon: string;
}

const NAV_TABS: TabItem[] = [
  { name: "New Chat",   href: "/agent",          icon: "/assets/icons/plus.svg"    },
  { name: "Policy",     href: "/agent/policy",   icon: "/assets/icons/shield.svg"  },
  { name: "Activities", href: "/agent/activity", icon: "/assets/icons/list.svg"    },
  { name: "History",    href: "/agent/history",  icon: "/assets/icons/history.svg" },
];

function formatExpiry(expiryMs: number): string {
  const diff = expiryMs - Date.now();
  if (diff <= 0) return "Expired";
  const s = Math.floor(diff / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export default function CorralLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isDark    = theme === "dark";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [walletOpen, setWalletOpen]   = useState(false);
  const [helpOpen,   setHelpOpen]     = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const account        = useCurrentAccount();
  const { status, policy } = useAgentWallet();

  // Show the first-run tutorial once the user has connected (so it lands in the
  // real app, not on a blank pre-connect screen). Persisted so it shows once.
  useEffect(() => {
    if (account?.address && !hasSeenTutorial()) {
      const t = setTimeout(() => {
        // Persist "seen" the instant we show it, so a re-render/StrictMode
        // double-invoke or an unmount can never re-trigger and trap the page.
        markTutorialSeen();
        setTutorialOpen(true);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [account?.address]);

  const { data: agentBal } = useSuiClientQuery(
    "getBalance",
    { owner: status?.agentAddress ?? "" },
    { enabled: !!status?.agentAddress, refetchInterval: 20_000 },
  );
  const agentSui      = agentBal ? Number(agentBal.totalBalance) / 1_000_000_000 : null;
  const agentNeedsFunds = status?.agentAddress != null && agentSui != null && agentSui < 1;

  const isTabActive = (href: string) =>
    location.pathname === href ||
    (href !== "/agent" && location.pathname.startsWith(href + "/"));

  /** Nav item classes — orange active indicator */
  const tabClass = (href: string) => {
    const base = isCollapsed
      ? "relative flex h-[48px] w-[48px] items-center justify-center rounded-xl transition-all duration-150 mx-auto group"
      : "relative flex h-[48px] items-center gap-3 rounded-xl px-4 text-[0.9rem] font-semibold transition-all duration-150 group";

    if (isTabActive(href)) {
      return `${base} bg-[var(--brand-dim)] text-[var(--brand)]`;
    }
    return `${base} text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)]`;
  };

  const usedPct    = policy ? Math.min(100, Math.round(policy.usedPercent)) : 0;
  const active     = status?.bound && policy?.isActive;
  const agentState = !account
    ? "Disconnected"
    : !status
    ? "Not initialized"
    : !status.bound
    ? "No policy"
    : policy?.isActive
    ? "Active"
    : "Paused";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--canvas)] font-sans transition-colors duration-200">

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside
        className={`
          flex h-full flex-col
          border-r border-[var(--line)]
          bg-[var(--surface)]
          transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          ${isCollapsed ? "w-[72px] px-3 py-6" : "w-[240px] p-5"}
        `}
      >
        {/* Logo row */}
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"} mb-8`}>
          {isCollapsed ? (
            <img src="/assets/coral-mark.svg" alt="Coral" className="w-8 h-8" />
          ) : (
            <span className="flex items-center gap-2 text-[1.3rem] font-bold tracking-tight text-[var(--ink)] leading-none select-none">
              <img src="/assets/coral-mark.svg" alt="" className="w-7 h-7" />
              Coral
            </span>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="
              flex items-center justify-center w-8 h-8 rounded-lg
              text-[var(--faint)] hover:text-[var(--brand)] hover:bg-[var(--brand-dim)]
              transition-all duration-150 cursor-pointer
            "
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <MdOutlineMenuOpen
              className={`text-xl transform transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1.5">
          {NAV_TABS.map((tab, i) => (
            <Link
              key={tab.href}
              to={tab.href}
              className={`${tabClass(tab.href)} whisk-in whisk-d${i + 1}`}
              title={isCollapsed ? tab.name : undefined}
            >
              {/* Orange left-bar indicator */}
              {isTabActive(tab.href) && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--brand)]" />
              )}
              <img
                src={tab.icon}
                alt=""
                className={`w-[18px] h-[18px] flex-shrink-0 transition-all duration-150 ${
                  isTabActive(tab.href)
                    ? "[filter:invert(45%)_sepia(90%)_saturate(600%)_hue-rotate(10deg)_brightness(95%)]"
                    : isDark
                    ? "[filter:brightness(0)_invert(0.65)]"
                    : "[filter:brightness(0)_opacity(0.45)]"
                }`}
              />
              {!isCollapsed && tab.name}
            </Link>
          ))}
        </nav>

        {/* Settings (bottom) */}
        <div className="mt-auto">
          <Link
            to="/agent/settings"
            className={tabClass("/agent/settings")}
            title={isCollapsed ? "Settings" : undefined}
          >
            {isTabActive("/agent/settings") && (
              <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--brand)]" />
            )}
            <img
              src="/assets/icons/settings.svg"
              alt=""
              className={`w-[18px] h-[18px] flex-shrink-0 transition-all duration-150 ${
                isTabActive("/agent/settings")
                  ? "[filter:invert(45%)_sepia(90%)_saturate(600%)_hue-rotate(10deg)_brightness(95%)]"
                  : isDark
                  ? "[filter:brightness(0)_invert(0.65)]"
                  : "[filter:brightness(0)_opacity(0.45)]"
              }`}
            />
            {!isCollapsed && "Settings"}
          </Link>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[var(--canvas)]">

        {/* Header */}
        <header className="
          flex h-[68px] items-center justify-between
          border-b border-[var(--line)]
          bg-[var(--surface)]/80
          backdrop-blur-[40px]
          px-6
          transition-colors duration-200
        ">
          {/* Agent status pill */}
          <div className="
            flex items-center gap-3
            bg-[var(--surface-2)] border border-[var(--line)]
            rounded-full px-4 py-2
            text-[0.78rem] font-medium text-[var(--muted)]
          ">
            {/* Status dot */}
            <span className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  active
                    ? "bg-[var(--positive)] animate-pulse"
                    : agentState === "Paused"
                    ? "bg-amber-400"
                    : "bg-[var(--faint)]"
                }`}
              />
              Agent:{" "}
              {status && !status.bound ? (
                <button
                  onClick={() => navigate("/agent/policy")}
                  className="text-[var(--brand)] font-bold hover:underline cursor-pointer"
                >
                  Set up →
                </button>
              ) : (
                <span className="text-[var(--ink)] font-bold">{agentState}</span>
              )}
            </span>

            <span className="w-px h-3.5 bg-[var(--line-strong)]" />

            {/* Budget bar */}
            <span className="flex items-center gap-2 font-medium text-[var(--ink)]">
              Budget:
              <span className="relative flex items-center w-14 h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
                <span
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${usedPct}%`,
                    background: usedPct > 80
                      ? "#EF4444"
                      : usedPct > 50
                      ? "#FF8C00"
                      : "var(--brand)",
                  }}
                />
              </span>
              <span className="font-mono font-bold text-[var(--ink)]">{usedPct}%</span>
            </span>

            <span className="w-px h-3.5 bg-[var(--line-strong)]" />

            <span className="font-medium text-[var(--ink)]">
              Expires:{" "}
              <span className="font-mono font-bold text-[var(--ink)]">
                {policy ? formatExpiry(Number(policy.expiryTimestampMs)) : "--:--:--"}
              </span>
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {/* Help */}
            <button
              onClick={() => setHelpOpen(true)}
              className="
                flex h-9 w-9 items-center justify-center rounded-full
                border border-[var(--line)]
                bg-[var(--surface-2)]
                text-[13px] font-bold text-[var(--muted)]
                hover:text-[var(--brand)] hover:border-[var(--brand)] hover:bg-[var(--brand-dim)]
                active:scale-95 transition-all duration-150 cursor-pointer
              "
              title="How Coral works"
            >
              ?
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="
                flex h-9 w-9 items-center justify-center rounded-full
                text-[var(--muted)]
                hover:text-[var(--brand)] hover:bg-[var(--brand-dim)]
                active:scale-[0.96] transition-all duration-150 cursor-pointer
              "
              title="Toggle theme"
            >
              <img
                src={isDark ? "/assets/icons/sun.svg" : "/assets/icons/moon.svg"}
                alt="Toggle theme"
                width={18}
                height={18}
                className={`object-contain flex-shrink-0 transition-all ${
                  isDark ? "[filter:brightness(0)_invert(1)]" : "[filter:brightness(0)_opacity(0.55)]"
                }`}
              />
            </button>

            <NotificationBell />

            {account ? (
              <>
                {/* Wallet icon */}
                <button
                  onClick={() => setWalletOpen(true)}
                  className="
                    relative flex h-9 w-9 items-center justify-center rounded-full
                    text-[var(--muted)]
                    hover:text-[var(--brand)] hover:bg-[var(--brand-dim)]
                    active:scale-[0.96] transition-all duration-150 cursor-pointer
                  "
                  title={agentNeedsFunds ? "Agent wallet low on SUI — fund it to trade" : "Wallets"}
                >
                  <img
                    src="/assets/icons/wallet.svg"
                    alt="Wallet"
                    width={17}
                    height={17}
                    className={`object-contain flex-shrink-0 ${
                      isDark ? "[filter:brightness(0)_invert(0.7)]" : "[filter:brightness(0)_opacity(0.5)]"
                    }`}
                  />
                  {agentNeedsFunds && (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-[var(--surface)] animate-pulse" />
                  )}
                </button>

                {/* Address pill */}
                <button
                  onClick={() => setWalletOpen(true)}
                  className="
                    flex h-[38px] items-center gap-2 rounded-full ml-1 px-4
                    bg-[var(--ink)] text-[var(--canvas)]
                    text-[0.85rem] font-semibold
                    hover:opacity-85 active:scale-[0.97]
                    transition-all duration-150 cursor-pointer shadow-sm
                  "
                  title="You (owner) — signs policy & revoke"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-50 hidden sm:inline">You</span>
                  <span className="font-mono">{account.address.slice(0, 6)}…{account.address.slice(-4)}</span>
                </button>
              </>
            ) : (
              <div className="[&_button]:!rounded-full [&_button]:!bg-[var(--brand)] [&_button]:!text-white [&_button]:!px-5 [&_button]:!h-[38px] [&_button]:!text-[0.85rem] [&_button]:!font-semibold ml-1">
                <ConnectButton connectText="Connect Wallet" />
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {walletOpen && account && <WalletDrawer onClose={() => setWalletOpen(false)} />}
      {helpOpen   && <HelpModal onClose={() => setHelpOpen(false)} onReplayTutorial={() => { setHelpOpen(false); setTutorialOpen(true); }} />}
      {tutorialOpen && <Tutorial onClose={() => setTutorialOpen(false)} />}
    </div>
  );
}
