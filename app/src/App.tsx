import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import { AppLayout, Dashboard, Agents, Activity, Account } from '@/pages/';

function App() {

  return (
    <div>
      <Routes>
        <Route
          element={
            <AppLayout />
          }
        >
          <Route path="/agents" element={<Agents />} />
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