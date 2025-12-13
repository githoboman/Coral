import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { LoginModal, LoginDrawer } from './Login';
import { OnboardingModal } from './Onboarding';
import { useZkLogin } from '@/hooks/useZkLogin';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

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
  // Initialize checkingOnboarding based on whether auth data exists (for both passkey and zkLogin)
  const [checkingOnboarding, setCheckingOnboarding] = useState(() => {
    const hasPasskeyData = localStorage.getItem('sui_passkey_pubkey_hex') && localStorage.getItem('sui_passkey_address');
    const hasZkLoginData = localStorage.getItem('zklogin_address') && localStorage.getItem('zklogin_jwt');
    return !!(hasPasskeyData || hasZkLoginData);
  });

  const auth = useAuth();
  const zkLogin = useZkLogin();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Restore zkLogin session
  useEffect(() => {
    const restored = zkLogin.restoreSession();
    if (restored) {
      setCheckingOnboarding(true);
    }
  }, []);

  useEffect(() => {
    // Check if either auth method is authenticated
    const isUserAuthenticated = auth.isAuthenticated || zkLogin.isAuthenticated;
    const currentAuth = auth.isAuthenticated ? auth : zkLogin;

    if (!isUserAuthenticated) {
      setIsLoginOpen(true);
      setIsOnboardingOpen(false);
      setCheckingOnboarding(false); // Reset loading state when disconnected
    } else {
      setIsLoginOpen(false);
      // Only check onboarding if we have address and loading is needed
      if ((currentAuth.address || (currentAuth as any).pubkeyHex) && checkingOnboarding) {
        checkUserOnboardingStatus();
      }
    }
  }, [auth.isAuthenticated, auth.pubkeyHex, auth.address, zkLogin.isAuthenticated, zkLogin.address]);

  const checkUserOnboardingStatus = async () => {
    // Determine which auth method is active
    const activeAddress = auth.isAuthenticated ? auth.address : zkLogin.address;
    const activeId = auth.isAuthenticated ? auth.pubkeyHex : zkLogin.address; // For zkLogin, address is ID for now

    if (!activeId || !activeAddress) {
      setCheckingOnboarding(false); // Reset loading state if no auth data
      return;
    }

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/fetch-user?user_id=${encodeURIComponent(activeId)}`,
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
        await createUserProfile(activeId, activeAddress);
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
      toast.error('Failed to check onboarding status');
    } finally {
      setCheckingOnboarding(false);
    }
  };

  const createUserProfile = async (userId: string, walletAddress: string) => {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

    try {
      const response = await fetch(`${apiBaseUrl}/api/update-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          wallet_address: walletAddress,
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
      toast.error('Failed to create user profile');
    }
  };

  const handleOnboardingSubmit = async (email: string, additionalData?: { username?: string; firstName?: string; lastName?: string }) => {
    const activeId = auth.isAuthenticated ? auth.pubkeyHex : zkLogin.address;

    if (!activeId) return;

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
          user_id: activeId,
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
      toast.error(error.message || 'Onboarding failed');
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleSignIn = async () => {
    await auth.signIn();
  };

  const handleSignInWithGoogle = async () => {
    try {
      const authUrl = await zkLogin.prepareZkLogin();
      window.location.href = authUrl;
    } catch (error: any) {
      console.error("Google sign-in failed:", error);
      toast.error(error?.message || 'Failed to start Google sign-in');
    }
  };

  if (checkingOnboarding) {
    return <LoadingSpinner fullScreen />;
  }


  return (
    <>
      {children}

      {/* Login Modal/Drawer */}
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !auth.isAuthenticated && !zkLogin.isAuthenticated}
          loading={auth.loading || zkLogin.loading}
          onSignIn={handleSignIn}
          onSignInWithGoogle={handleSignInWithGoogle}
          isSupported={auth.isSupported}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !auth.isAuthenticated && !zkLogin.isAuthenticated}
          loading={auth.loading || zkLogin.loading}
          onSignIn={handleSignIn}
          onSignInWithGoogle={handleSignInWithGoogle}
          isSupported={auth.isSupported}
        />
      )}

      <OnboardingModal
        isOpen={isOnboardingOpen && (auth.isAuthenticated || zkLogin.isAuthenticated) && !isOnboarded}

        loading={onboardingLoading}
        message={onboardingMessage}
        onSubmit={handleOnboardingSubmit}
        onClearMessage={() => setOnboardingMessage(null)}
      />
    </>
  );
}