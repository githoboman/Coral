import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import { AppLayout, Dashboard, Activity, Account, OnchainAnalysis } from '@/pages/';
import { TelegramProvider } from '@/components/TelegramProvider';

function App() {

  return (
    <TelegramProvider>
      <div>
        <Routes>
          <Route
            element={
              <AppLayout />
            }
          >

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
    </TelegramProvider>
  );
}

export default App;