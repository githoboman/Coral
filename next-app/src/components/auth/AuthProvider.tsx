'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useRouter, usePathname } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import 'react-toastify/dist/ReactToastify.css';

interface AuthContextType {
  isOnboarded: boolean;
  userEmail: string | null;
  signOut: () => Promise<void>;
}

export const AuthContext = React.createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const router = useRouter();
  const pathname = usePathname();

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

  // Check if we're on signin page
  const isSigninPage = pathname === '/signin';

  useEffect(() => {
    // Simple loading simulation - actual auth will be handled by Sui wallet hooks
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const signOut = async () => {
    try {
      // Clear auth items
      const authItems = [
        'zklogin_jwt',
        'enoki_jwt',
        'id_token',
        'sui-dapp-kit:wallet-connection-info',
      ];
      authItems.forEach((item) => {
        localStorage.removeItem(item);
        sessionStorage.removeItem(item);
      });

      // Clear tovira-specific cached data
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tovira_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      setUserEmail(null);
      setIsOnboarded(false);

      router.replace('/signin');
      toast.success('Successfully logged out');
    } catch (error: any) {
      toast.error('Failed to log out completely');
    }
  };

  if (isLoading && !isSigninPage) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <AuthContext.Provider
      value={{
        isOnboarded,
        userEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
