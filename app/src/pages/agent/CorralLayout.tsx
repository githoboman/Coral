import { useState } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { MdOutlineMenuOpen } from "react-icons/md";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { useTheme } from "@/hooks/useTheme";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { WalletDrawer } from "@/components/agent/WalletDrawer";
import { NotificationBell } from "@/components/agent/NotificationBell";

/**
 * Corral app shell — sidebar + top header — copied design-for-design from the
 * corral reference (`corral/src/app/app/layout.tsx`), adapted to our Vite /
 * React-Router app and wired to real data: the header agent-status pill reflects
 * live policy (budget %, expiry), the theme toggle uses our useTheme, and wallet
 * connect uses dapp-kit. Wraps the agent routes via <Outlet />.
 */

interface TabItem {
  name: string;
  href: string;
  icon: string;
}

const NAV_TABS: TabItem[] = [
  { name: "New Chat", href: "/agent", icon: "/assets/icons/plus.svg" },
  { name: "Policy", href: "/agent/policy", icon: "/assets/icons/shield.svg" },
  { name: "Activities", href: "/agent/activity", icon: "/assets/icons/list.svg" },
  { name: "History", href: "/agent/history", icon: "/assets/icons/history.svg" },
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
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const account = useCurrentAccount();
  const { status, policy } = useAgentWallet();

  const isTabActive = (href: string) =>
    location.pathname === href ||
    (href !== "/agent" && location.pathname.startsWith(href + "/"));

  const tabClass = (href: string) => {
    const base = isCollapsed
      ? "flex h-[48px] w-[48px] items-center justify-center rounded-xl transition-all active:scale-[0.98] mx-auto"
      : "flex h-[48px] items-center gap-3 rounded-xl px-5 text-[0.92rem] font-semibold transition-all active:scale-[0.98]";
    const active =
      "bg-[#F3F2EF] border border-[#E7E7E4] shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-zinc-900 dark:bg-[#2F2F2F] dark:border-black dark:text-zinc-200";
    const inactive =
      "border border-transparent text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100/50 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900/30";
    return `${base} ${isTabActive(href) ? active : inactive}`;
  };

  const usedPct = policy ? Math.min(100, Math.round(policy.usedPercent)) : 0;
  const active = status?.bound && policy?.isActive;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 font-sans transition-colors duration-200">
      {/* Sidebar */}
      <aside
        className={`flex h-full flex-col border-r border-[#E7E7E4] bg-white/40 dark:border-zinc-800 dark:bg-[#242424] transition-all duration-300 ${
          isCollapsed ? "w-[80px] px-4 py-6" : "w-[260px] p-6"
        }`}
      >
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
          {isCollapsed ? (
            <img src="/assets/coral-mark.svg" alt="Coral" className="w-9 h-9" />
          ) : (
            <span className="flex items-center gap-2 text-[1.4rem] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-none">
              <img src="/assets/coral-mark.svg" alt="" className="w-7 h-7" />
              Coral
            </span>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer"
          >
            <MdOutlineMenuOpen
              className={`text-2xl transform transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        <nav className="mt-8 flex flex-col gap-3">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              to={tab.href}
              className={tabClass(tab.href)}
              title={isCollapsed ? tab.name : undefined}
            >
              <img
                src={tab.icon}
                alt=""
                className="w-[17px] h-[17px] flex-shrink-0 [filter:brightness(0)_opacity(0.55)] dark:[filter:brightness(0)_invert(1)_opacity(0.7)]"
              />
              {!isCollapsed && tab.name}
            </Link>
          ))}
        </nav>

        <div className="mt-auto">
          <Link
            to="/agent/settings"
            className={tabClass("/agent/settings")}
            title={isCollapsed ? "Settings" : undefined}
          >
            <img
              src="/assets/icons/settings.svg"
              alt=""
              className="w-[17px] h-[17px] flex-shrink-0 [filter:brightness(0)_opacity(0.55)] dark:[filter:brightness(0)_invert(1)_opacity(0.7)]"
            />
            {!isCollapsed && "Settings"}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#FAF9F6] dark:bg-[#262626]">
        <header className="flex h-[72px] items-center justify-between border-b border-white/40 bg-white/25 px-8 backdrop-blur-[64px] dark:border-white/15 dark:bg-[#232323]">
          {/* Agent status pill (live) */}
          <div className="flex items-center gap-3.5 bg-[#F8F9FA]/80 border border-[#E7E7E4] rounded-full px-4 py-2 text-[0.8rem] font-semibold text-zinc-500 dark:bg-[#2F2F2F] dark:border-black dark:text-[#5E5E5E]">
            <span className="flex items-center gap-1.5 font-medium text-black dark:text-[#5E5E5E]">
              <span className={`w-2 h-2 rounded-full ${active ? "bg-[#10B981] animate-pulse" : "bg-zinc-400"}`} />
              Agent:{" "}
              <span className="text-zinc-900 dark:text-[#5E5E5E] font-bold">
                {active ? "Active" : "Idle"}
              </span>
            </span>
            <span className="w-[2px] h-3.5 bg-[#D2D2CD] dark:bg-white/40" />
            <span className="flex items-center gap-2 font-medium text-black dark:text-[#5E5E5E]">
              Budget:
              <span className="relative flex items-center w-16 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <span
                  className="absolute left-0 top-0 h-full bg-zinc-900 dark:bg-zinc-100 rounded-full transition-all"
                  style={{ width: `${usedPct}%` }}
                />
              </span>
              <span className="text-zinc-900 dark:text-white font-mono font-bold">{usedPct}%</span>
            </span>
            <span className="w-[2px] h-3.5 bg-[#D2D2CD] dark:bg-white/40" />
            <span className="text-black dark:text-[#5E5E5E] font-medium">
              Expires in:{" "}
              <span className="text-zinc-900 dark:text-white font-mono font-bold">
                {policy ? formatExpiry(Number(policy.expiryTimestampMs)) : "--:--:--"}
              </span>
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className="flex h-10 w-10 items-center justify-center bg-transparent text-[#5E5E5E] hover:text-zinc-950 active:scale-[0.98] dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
              title="Toggle theme"
            >
              <img
                src={isDark ? "/assets/icons/sun.svg" : "/assets/icons/moon.svg"}
                alt="Toggle theme"
                width={18}
                height={18}
                className="object-contain flex-shrink-0 dark:[filter:brightness(0)_invert(1)]"
              />
            </button>
            <NotificationBell />
            {account ? (
              <>
                {/* Connected: wallet icon opens the slide-out drawer */}
                <button
                  onClick={() => setWalletOpen(true)}
                  className="flex h-10 w-10 items-center justify-center bg-transparent text-[#5E5E5E] hover:text-zinc-950 active:scale-[0.98] dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                  title="Wallet"
                >
                  <img
                    src="/assets/icons/wallet.svg"
                    alt="Wallet"
                    width={17}
                    height={17}
                    className="object-contain flex-shrink-0 dark:[filter:brightness(0)_invert(1)]"
                  />
                </button>
                <button
                  onClick={() => setWalletOpen(true)}
                  className="flex h-[42px] items-center justify-center rounded-full bg-zinc-950 text-[0.92rem] font-medium text-white px-5 shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer ml-1 font-mono"
                >
                  {account.address.slice(0, 6)}…{account.address.slice(-4)}
                </button>
              </>
            ) : (
              /* Not connected: real dapp-kit connect, styled to the Corral pill */
              <div className="[&_button]:!rounded-full [&_button]:!bg-zinc-950 [&_button]:!text-white [&_button]:!px-5 [&_button]:!h-[42px] [&_button]:!text-[0.92rem] dark:[&_button]:!bg-zinc-50 dark:[&_button]:!text-zinc-950 ml-1">
                <ConnectButton connectText="Connect Wallet" />
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {walletOpen && account && <WalletDrawer onClose={() => setWalletOpen(false)} />}
    </div>
  );
}
