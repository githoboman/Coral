import { Routes, Route } from 'react-router-dom';

import Home from './pages/landing/Home';
import LandingPageLayout from './pages/landing/Layout';
import AppLayout from './pages/app/Layout'
import Dashboard from './pages/app/Dashboard'
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
          <Route path="/dashboard/" element={<Dashboard />} />
        </Route>
      </Routes>
    </div>
  );
}

export default App;