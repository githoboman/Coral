import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import { AppLayout, Dashboard, Agents, Activity, Account, OnchainAnalysis } from '@/pages/';
import OAuthCallback from '@/pages/OAuthCallback';

function App() {

  return (
    <div>
      <Routes>
        {/* OAuth callback route (outside AppLayout) */}
        <Route path="/auth/callback" element={<OAuthCallback />} />

        <Route
          element={
            <AppLayout />
          }
        >
          <Route path="/agents" element={<Agents />} />
          <Route path="/onchain" element={<OnchainAnalysis />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<Dashboard />}>
            <Route path="/:chatId" element={<Dashboard />} />
          </Route>
        </Route>
      </Routes>

      <ToastContainer />
    </div>
  );
}

export default App;