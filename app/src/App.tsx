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
  Agent,
} from "@/pages/";

import Subscription from "@/pages/Subscription";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { SileoToaster } from "@/components/SileoToaster";
import BadgeMint from "@/pages/BadgeMint";

function App() {
  const [showSplash, setShowSplash] = useState(true);



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
          <Route path="/agent" element={<Agent />} />
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:chatId?" element={<Dashboard />} />
        </Route>
      </Routes>

      <SileoToaster />
    </div>
  );
}

export default App;
