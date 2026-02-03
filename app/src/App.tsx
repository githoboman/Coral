import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import { AppLayout, Dashboard, Activity, Account, OnchainAnalysis, Leaderboard } from '@/pages/';
import { TelegramProvider } from '@/components/TelegramProvider';
import { SplashScreen } from '@/components/ui/SplashScreen';

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
      <div className={`app-container ${showSplash ? 'splash-visible' : ''}`}>
        {showSplash && <SplashScreen />}
        <Routes>
          <Route
            element={
              <AppLayout />
            }
          >

            <Route path="/onchain" element={<OnchainAnalysis />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/account" element={<Account />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/" element={<Dashboard />}>
              <Route path="/:chatId" element={<Dashboard />} />
            </Route>
          </Route>
        </Routes>

        <ToastContainer />
      </div>
    </TelegramProvider>
  );
}

export default App;