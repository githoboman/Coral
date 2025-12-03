import React, { useState, useEffect } from 'react';
import { LoginModal, LoginDrawer } from './Login';
import { OnboardingModal } from './Onboarding';
import { useAuth } from '@/hooks/useAuth';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
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
      setIsOnboardingOpen(false);
    } else {
      setIsLoginOpen(false);
      checkUserOnboardingStatus();
    }
  }, [auth.isAuthenticated, auth.pubkeyHex, auth.address]);

  const checkUserOnboardingStatus = async () => {
    if (!auth.pubkeyHex || !auth.address) return;

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/fetch-user?user_id=${encodeURIComponent(auth.pubkeyHex)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to fetch user');
      }

      const data = await response.json();

      if (!data.exists) {
        // User doesn't exist, create profile
        await createUserProfile();
      } else if (!data.is_onboarded) {
        // User exists but not onboarded
        setIsOnboarded(false);
        setIsOnboardingOpen(true);
      } else {
        // User exists and is onboarded
        setIsOnboarded(true);
        setIsOnboardingOpen(false);
      }
    } catch (error: any) {
      console.error('Error checking user onboarding status:', error.message);
    } finally {
      setCheckingOnboarding(false);
    }
  };

  const createUserProfile = async () => {
    if (!auth.pubkeyHex || !auth.address) return;

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

    try {
      const response = await fetch(`${apiBaseUrl}/api/update-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: auth.pubkeyHex,
          wallet_address: auth.address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create user profile');
      }

      const data = await response.json();
      console.log('User profile created:', data.message);
      setIsOnboarded(false);
      setIsOnboardingOpen(true);
    } catch (error: any) {
      console.error('Error creating user profile:', error.message);
      auth.clearMessage();
      auth.setAuthState((prev) => ({
        ...prev,
        message: `Failed to create user profile: ${error.message}`,
      }));
    }
  };

  const handleOnboardingSubmit = async (email: string, additionalData?: { username?: string; firstName?: string; lastName?: string }) => {
    if (!auth.pubkeyHex) return;

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    setOnboardingLoading(true);
    setOnboardingMessage(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/onboard-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: auth.pubkeyHex,
          email: email,
          username: additionalData?.username,
          first_name: additionalData?.firstName,
          last_name: additionalData?.lastName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to complete onboarding');
      }

      const data = await response.json();
      console.log('Onboarding successful:', data.message);

      setIsOnboarded(true);
      setIsOnboardingOpen(false);
      setOnboardingMessage('Welcome! Your account is now set up.');

      // Clear message after 3 seconds
      setTimeout(() => setOnboardingMessage(null), 3000);
    } catch (error: any) {
      console.error('Error during onboarding:', error.message);
      setOnboardingMessage(error.message);
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleSignIn = async () => {
    await auth.signIn();
  };

  if (checkingOnboarding) {
    return (
      <div className="h-dvh w-full flex justify-center items-center">
        <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }


  return (
    <>
      {children}

      {/* Login Modal/Drawer */}
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !auth.isAuthenticated}
          loading={auth.loading}
          message={auth.message}
          onSignIn={handleSignIn}
          onClearMessage={auth.clearMessage}
          isSupported={auth.isSupported}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !auth.isAuthenticated}
          loading={auth.loading}
          message={auth.message}
          onSignIn={handleSignIn}
          onClearMessage={auth.clearMessage}
          isSupported={auth.isSupported}
        />
      )}

      <OnboardingModal
        isOpen={isOnboardingOpen && auth.isAuthenticated && !isOnboarded}
        loading={onboardingLoading}
        message={onboardingMessage}
        onSubmit={handleOnboardingSubmit}
        onClearMessage={() => setOnboardingMessage(null)}
      />
    </>
  );
}