import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useCurrentAccount } from "@mysten/dapp-kit";

import {
  AppLayout,
  Dashboard,
  Activity,
  Account,
  OnchainAnalysis,
  Leaderboard,
  Signin,
  Maintenance,
  Agent,
  Activities,
} from "@/pages/";

import Subscription from "@/pages/Subscription";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { SileoToaster } from "@/components/SileoToaster";
import BadgeMint from "@/pages/BadgeMint";
import CorralLayout from "@/pages/agent/CorralLayout";
import AgentChat from "@/pages/agent/AgentChat";
import AgentHistory from "@/pages/agent/History";
import AgentSettings from "@/pages/agent/Settings";
import { AgentWalletProvider } from "@/hooks/useAgentWallet";

function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Brief branded flash, then always reveal the app. A single timer that can't
    // be stranded by StrictMode/HMR double-invokes.
    const timer = setTimeout(() => setShowSplash(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`app-container ${showSplash ? "splash-visible" : ""}`}>
      {showSplash && <SplashScreen />}
      <Routes>
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/signin" element={<Signin />} />
        {/* Home: to the agent app if connected, else to sign-in. */}
        <Route path="/" element={<HomeRedirect />} />

        {/* Agent area — Corral shell + shared state, GATED on a connected wallet. */}
        <Route
          element={
            <RequireWallet>
              <AgentWalletProvider>
                <CorralLayout />
              </AgentWalletProvider>
            </RequireWallet>
          }
        >
          <Route path="/agent" element={<AgentChat />} />
          <Route path="/agent/policy" element={<Agent />} />
          <Route path="/agent/activity" element={<Activities />} />
          <Route path="/agent/history" element={<AgentHistory />} />
          <Route path="/agent/settings" element={<AgentSettings />} />
        </Route>

        {/* Legacy Tovira screens (kept, not in the Coral flow). */}
        <Route element={<AppLayout />}>
          <Route path="/onchain" element={<OnchainAnalysis />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/account" element={<Account />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/badge" element={<BadgeMint />} />
          <Route path="/chat/:chatId?" element={<Dashboard />} />
        </Route>

        {/* Anything else → home (which routes by auth), not a blank screen. */}
        <Route path="*" element={<HomeRedirect />} />
      </Routes>

      <SileoToaster />
    </div>
  );
}

/** Root: send connected users to the agent app, others to sign-in. */
function HomeRedirect() {
  const account = useCurrentAccount();
  return <Navigate to={account ? "/agent" : "/signin"} replace />;
}

/** Gate the agent area on a connected wallet — no wallet ⇒ sign-in. */
function RequireWallet({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  if (!account) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

export default App;
