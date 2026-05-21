import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import {
  AppLayout,
  Dashboard,
  Activity,
  Account,
  OnchainAnalysis,
  Leaderboard,
  Signin,
  Maintenance,
} from "@/pages/";

import Subscription from "@/pages/Subscription";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { SileoToaster } from "@/components/SileoToaster";
import BadgeMint from "@/pages/BadgeMint";

function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Capture referral code before any routing redirects happen
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const refCode = searchParams.get("ref");
    if (refCode) {
      const expires = new Date();
      expires.setTime(expires.getTime() + 7 * 24 * 60 * 60 * 1000);
      document.cookie = `tovira_referral=${refCode};expires=${expires.toUTCString()};path=/`;
      console.log("[REFERRAL] Captured at App mount:", refCode);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`app-container ${showSplash ? "splash-visible" : ""}`}>
      {showSplash && <SplashScreen />}
      <Routes>
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/signin" element={<Signin />} />
        <Route element={<AppLayout />}>
          <Route path="/onchain" element={<OnchainAnalysis />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/account" element={<Account />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/badge" element={<BadgeMint />} />
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:chatId?" element={<Dashboard />} />
        </Route>
      </Routes>

      <SileoToaster />
    </div>
  );
}

export default App;
