import { Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import Home from '@/pages/Home';
import LandingPageLayout from '@/pages/Layout';

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
      </Routes>

      <ToastContainer />
    </div>
  );
}

export default App;