import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import Home from '@/pages/landing/Home';
import LandingPageLayout from '@/pages/landing/Layout';
import { AppLayout, Dashboard, Agents, Notifications, Settings } from '@/pages/app/';

function App() {

  return (
    <div>
      <Routes>
        <Route
          path="/"
          element={
            <LandingPageLayout />
          }
        >
          <Route index element={<Home />} />
        </Route>
        <Route
          element={
            <AppLayout />
          }
        >
          <Route path="/agents" element={<Agents />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/c/" element={<Dashboard />}>
            <Route path="/c/:chatId" element={<Dashboard />} />
          </Route>
        </Route>
      </Routes>

      <ToastContainer />
    </div>
  );
}

export default App;