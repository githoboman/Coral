// src/components/auth/AuthProvider.tsx
import React, { useState, useEffect } from 'react';
import { LoginModal, LoginDrawer } from './Login';
import { useAuth } from '@/hooks/useAuth';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const auth = useAuth();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setIsLoginOpen(true);
    } else {
      setIsLoginOpen(false);
    }
  }, [auth.isAuthenticated]);

  const handleSignIn = async () => {
    await auth.signIn();
  };

  return (
    <>
      {children}
      
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !auth.isAuthenticated}
          onClose={() => setIsLoginOpen(false)}
          loading={auth.loading}
          message={auth.message}
          onSignIn={handleSignIn}
          onClearMessage={auth.clearMessage}
          isSupported={auth.isSupported}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !auth.isAuthenticated}
          onClose={() => setIsLoginOpen(false)}
          loading={auth.loading}
          message={auth.message}
          onSignIn={handleSignIn}
          onClearMessage={auth.clearMessage}
          isSupported={auth.isSupported}
        />
      )}
    </>
  );
}