import { Routes, Route } from 'react-router-dom';

import Home from './pages/landing/Home';
import LandingPageLayout from './pages/landing/Layout';
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
          path="/dashboard"
          element={
            <>Dashboard</>
          }
        />
      </Routes>
    </div>
  );
}

export default App;