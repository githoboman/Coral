// src/pages/app/Layout.tsx
import { Outlet, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Sidebar } from '@/components/app/Sidebar';
import { BottomBar } from '@/components/app/BottomBar';
import { useAuth } from '@/hooks/useAuth';

export default function AppLayout() {
  const { signOut } = useAuth();
  const location = useLocation();

  const navItems = [
    { 
      name: 'Tasks', 
      to: '/app/tasks', 
      icon: '📋',
      active: location.pathname === '/app/tasks' || location.pathname === '/app'
    },
    { 
      name: 'Alerts', 
      to: '/app/alerts', 
      icon: '🔔',
      active: location.pathname === '/app/alerts'
    },
    { 
      name: 'Analytics', 
      to: '/app/analytics', 
      icon: '📊',
      active: location.pathname === '/app/analytics'
    },
    { 
      name: 'Settings', 
      to: '/app/settings', 
      icon: '⚙️',
      active: location.pathname === '/app/settings'
    },
  ];

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gradient-to-b from-[#010103] to-[#010102] text-white">
        {/* Desktop Layout */}
        <div className="hidden lg:flex h-screen">
          <div className="flex w-full">
            {/* Sidebar */}
            <Sidebar navItems={navItems} onSignOut={signOut} />
            
            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <main className="flex-1 overflow-y-auto p-6">
                <Outlet />
              </main>
            </div>
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden flex flex-col h-screen">
          {/* Main Content */}
          <main className="flex-1 overflow-y-auto p-4">
            <Outlet />
          </main>
          
          {/* Bottom Bar */}
          <BottomBar navItems={navItems} onSignOut={signOut} />
        </div>
      </div>
    </AuthProvider>
  );
}