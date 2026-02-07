'use client';

import React, { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { store } from '@/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { RegisterEnokiWallets } from '@/components/auth/RegisterEnokiWallets';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@mysten/dapp-kit/dist/index.css';

// Configure Sui network
const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const { networkConfig } = createNetworkConfig({
  testnet: {
    url: 'https://fullnode.testnet.sui.io:443',
    network: 'testnet',
  },
  mainnet: {
    url: 'https://fullnode.mainnet.sui.io:443',
    network: 'mainnet',
  },
});

// Create React Query client outside component to avoid recreation
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent SSR hydration mismatch - show loading until client mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#070B0F] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#8BEE1C]/20 border-t-[#8BEE1C] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={network}>
        <WalletProvider autoConnect>
          <RegisterEnokiWallets />
          <Provider store={store}>
            <AuthProvider>
              {children}
            </AuthProvider>
          </Provider>
        </WalletProvider>
      </SuiClientProvider>
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />
    </QueryClientProvider>
  );
}
