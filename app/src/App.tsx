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
import { TelegramProvider } from "@/components/TelegramProvider";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { SileoToaster } from "@/components/SileoToaster";

function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <TelegramProvider>
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
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Dashboard />} />
            <Route path="/chat/:chatId" element={<Dashboard />} />
          </Route>
        </Routes>

        <SileoToaster />
      </div>
    </TelegramProvider>
  );
}

export default App;
