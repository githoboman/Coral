'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Sidebar } from '@/components/app/Sidebar';
import { BottomNav } from '@/components/app/BottomNav';
import { MobileTopBar } from '@/components/app/MobileTopBar';
import { WalletPanel } from '@/components/wallet/WalletPanel';
import { useWalletData } from '@/hooks/useWalletData';
import { useAuth } from '@/components/auth/AuthProvider';

interface NavItem {
  name: string;
  to: string;
  iconUrl: string;
  active: boolean;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const currentAccount = useCurrentAccount();
  const { balanceUSD } = useWalletData();
  const { signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);

  const address = currentAccount?.address || null;
  const walletBalanceUSD = balanceUSD;

  // Logic for dashboard check
  const isDashboard = !['/tasks', '/account', '/onchain', '/leaderboard'].some(path => pathname.startsWith(path));

  // Close sidebar on route change
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  const navItems: NavItem[] = [
    { name: 'Chats', to: '/', iconUrl: '/assets/icons/edit.svg', active: pathname === '/' || pathname.startsWith('/c/') },
    { name: 'Analysis', to: '/onchain', iconUrl: '/assets/icons/bar-chart.svg', active: pathname === '/onchain' },
    { name: 'Tasks', to: '/tasks', iconUrl: '/assets/icons/bell.svg', active: pathname === '/tasks' },
    { name: 'Leaderboard', to: '/leaderboard', iconUrl: '/assets/icons/trophy.svg', active: pathname === '/leaderboard' },
  ];

  return (
    <div className="w-full relative bg-black overflow-hidden">
      <div className="absolute inset-0 bg-[#070B0F] -z-10" />

      <div className="flex w-full h-dvh overflow-x-hidden overflow-y-auto">
        {/* Desktop Sidebar */}
        <div className="sticky top-0 p-4 hidden md:flex h-dvh">
          <Sidebar navItems={navItems} />
        </div>

        {/* Main Content */}
        <div className={`h-fit w-full flex-1 ${!isDashboard ? 'pb-20' : ''} md:pb-0`}>
          <MobileTopBar
            balance={walletBalanceUSD}
            isConnected={!!currentAccount}
            onWalletClick={() => setIsWalletOpen(true)}
            onConnectClick={() => router.push('/signin')}
            onMenuClick={isDashboard ? () => setIsSidebarOpen(true) : undefined}
          />
          {children}
          {!isDashboard && (
            <div className="md:hidden">
              <BottomNav navItems={navItems.map(item =>
                item.name === 'Leaderboard'
                  ? { name: 'Profile', to: '/account', iconUrl: '/assets/icons/user.svg' as const, active: pathname === '/account' }
                  : item
              )} />
            </div>
          )}
        </div>

        {/* Desktop Wallet Panel */}
        <WalletPanel
          address={address}
          isOpen={isWalletOpen}
          onToggle={() => setIsWalletOpen(!isWalletOpen)}
          onConnectClick={() => router.push('/signin')}
          onSignOut={signOut}
        />
      </div>
    </div>
  );
}

