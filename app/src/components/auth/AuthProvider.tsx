import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { LoginModal, LoginDrawer } from './Login';
import { OnboardingModal } from './Onboarding';
import { WaitlistModal } from './WaitlistModal';
import { useCurrentAccount, useCurrentWallet, useDisconnectWallet } from '@mysten/dapp-kit';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { jwtDecode } from 'jwt-decode';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';
import 'react-toastify/dist/ReactToastify.css';

interface AuthContextType {
  setIsLoginOpen: (open: boolean) => void;
  isLoginOpen: boolean;
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

interface GoogleJwtPayload {
  iss?: string;
  sub?: string;
  aud?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isWaitlistModalOpen, setIsWaitlistModalOpen] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);

  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { connectionStatus } = useCurrentWallet();

  // Check if dApp Kit is still initializing
  const isInitializing = connectionStatus === 'connecting';

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Supabase auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSupabaseUser(session?.user ?? null);
      if (session?.user) {
        setUserEmail(session.user.email ?? null);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSupabaseUser(session?.user ?? null);
      if (session?.user) {
        setUserEmail(session.user.email ?? null);
      } else {
        setSupabaseUser(null);
        setUserEmail(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Extract email from JWT
  const extractEmailFromJWT = (): string | null => {
    try {
      // Try multiple possible JWT storage locations
      let jwt = localStorage.getItem('zklogin_jwt');
      if (!jwt) {
        jwt = sessionStorage.getItem('zklogin_jwt');
      }
      if (!jwt) {
        jwt = sessionStorage.getItem('enoki_jwt');
      }
      if (!jwt) {
        jwt = sessionStorage.getItem('id_token');
      }
      if (!jwt) {
        jwt = localStorage.getItem('enoki_jwt');
      }
      if (!jwt) {
        jwt = localStorage.getItem('id_token');
      }

      if (!jwt) {
        const walletInfo = localStorage.getItem('sui-dapp-kit:wallet-connection-info');
        if (walletInfo) {
          try {
            const parsed = JSON.parse(walletInfo);
            if (parsed.jwt || parsed.token || parsed.idToken) {
              jwt = parsed.jwt || parsed.token || parsed.idToken;
            }
          } catch (e) {
          }
        }
      }

      if (!jwt) {
        return null;
      }

      const decodedJwt = jwtDecode<GoogleJwtPayload>(jwt);
      return decodedJwt.email || null;
    } catch (error) {
      console.error('Error decoding JWT:', error);
      return null;
    }
  };


  useEffect(() => {
    if (isInitializing) {
      return;
    }

    const isEnokiAuthenticated = !!currentAccount;
    const isSupabaseAuthenticated = !!supabaseUser;

    if (!isEnokiAuthenticated && !isSupabaseAuthenticated) {
      if (!isInitializing) {
        setIsLoginOpen(true);
      }
      setIsOnboardingOpen(false);
    } else {
      setIsLoginOpen(false);

      if (isEnokiAuthenticated && !userEmail) {
        const email = extractEmailFromJWT();
        if (email) {
          setUserEmail(email);
        }
      }

      const activeId = isEnokiAuthenticated ? currentAccount.address : supabaseUser?.id;

      if (activeId && !checkingOnboarding) {
        setCheckingOnboarding(true);
        checkUserOnboardingStatus(activeId, isEnokiAuthenticated ? currentAccount.address : null);
      }
    }

    return;
  }, [isInitializing, currentAccount, supabaseUser]);

  const checkUserOnboardingStatus = async (activeId: string, walletAddress: string | null) => {
    if (!activeId) {
      setCheckingOnboarding(false);
      return;
    }

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

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
        await createUserProfile(activeId, walletAddress);
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

  const createUserProfile = async (userId: string, walletAddress: string | null) => {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

    try {
      console.log('Creating user profile with payload:', { user_id: userId, wallet_address: walletAddress });
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

  const handleVerifyWaitlist = async (email: string) => {
    setOnboardingLoading(true);
    setOnboardingMessage(null);

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/check-waitlist?email=${encodeURIComponent(email)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to verify waitlist');
      }

      const data = await response.json();

      if (!data.on_waitlist) {
        setOnboardingMessage('Your email was not found in our waitlist.');
        toast.error('Your email was not found in our waitlist.');
        return false;
      }

      setOnboardingMessage('Email verified successfully!');
      return true;
    } catch (error: any) {
      console.error('Error verifying waitlist:', error.message);
      setOnboardingMessage(error.message || 'Failed to verify waitlist');
      toast.error(error.message || 'Failed to verify waitlist');
      return false;
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleOnboardingSubmit = async (email: string, additionalData?: {
    notifications_enabled?: boolean;
    analytics_enabled?: boolean;
    personalization_enabled?: boolean;
    username?: string;
    firstName?: string;
    lastName?: string
  }) => {
    const activeId = currentAccount?.address || supabaseUser?.id;

    if (!activeId) {
      toast.error('Authentication required');
      return;
    }

    setOnboardingLoading(true);
    setOnboardingMessage(null);

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

    try {
      const response = await fetch(`${apiBaseUrl}/api/onboard-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: activeId,
          email,
          username: additionalData?.username,
          first_name: additionalData?.firstName,
          last_name: additionalData?.lastName,
          notifications_enabled: additionalData?.notifications_enabled,
          analytics_enabled: additionalData?.analytics_enabled,
          personalization_enabled: additionalData?.personalization_enabled,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Check if error is due to email not being on waitlist
        if (response.status === 404 && errorData.detail?.includes('waitlist')) {
          setOnboardingMessage('Your email was not found in our waitlist.');
          toast.error('Your email was not found in our waitlist.');
          return;
        }

        throw new Error(errorData.detail || 'Failed to complete onboarding');
      }

      await response.json();
      setOnboardingMessage('Onboarding completed successfully!');
      setIsOnboarded(true);
      setIsOnboardingOpen(false);
      toast.success('Welcome to Tovira!');
    } catch (error: any) {
      console.error('Error during onboarding:', error.message);
      setOnboardingMessage(error.message || 'Failed to complete onboarding');
      toast.error(error.message || 'Failed to complete onboarding');
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleWaitlistSubmit = async (email: string) => {
    setWaitlistLoading(true);
    setWaitlistMessage(null);

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

    try {
      const response = await fetch(`${apiBaseUrl}/api/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to join waitlist');
      }

      setWaitlistMessage('Successfully added to waitlist!');
      toast.success('Successfully added to waitlist!');

      setTimeout(() => {
        setIsWaitlistModalOpen(false);
        setWaitlistMessage(null);
        setIsOnboardingOpen(true);
      }, 1500);
    } catch (error: any) {
      console.error('Error joining waitlist:', error.message);
      setWaitlistMessage(error.message || 'Failed to join waitlist');
      toast.error(error.message || 'Failed to join waitlist');
    } finally {
      setWaitlistLoading(false);
    }
  };

  const signOut = async () => {
    try {
      // 1. Disconnect SUI Wallet
      disconnectWallet();

      // 2. Sign out of Supabase
      await supabase.auth.signOut();

      // 3. Clear local storage and session storage
      const itemsToClear = [
        'zklogin_jwt', 'enoki_jwt', 'id_token',
        'sui-dapp-kit:wallet-connection-info'
      ];
      itemsToClear.forEach(item => {
        localStorage.removeItem(item);
        sessionStorage.removeItem(item);
      });

      // 4. Reset states
      setUserEmail(null);
      setIsOnboarded(false);
      setSupabaseUser(null);

      // 5. Open login modal
      setIsLoginOpen(true);

      toast.success('Successfully logged out');
    } catch (error: any) {
      console.error('Logout error:', error);
      toast.error('Failed to log out completely');
    }
  };

  if (isInitializing) {
    return <LoadingSpinner fullScreen />;
  }

  const handleSignInSuccess = () => {
    setIsLoginOpen(false);
  };

  return (
    <AuthContext.Provider value={{
      setIsLoginOpen,
      isLoginOpen,
      isOnboarded,
      userEmail,
      signOut
    }}>
      {children}

      {/* Login Modal/Drawer */}
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !currentAccount && !supabaseUser}
          loading={false}
          onSignIn={handleSignInSuccess}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !currentAccount && !supabaseUser}
          loading={false}
          onSignIn={handleSignInSuccess}
        />
      )}

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen && !isOnboarded}
        loading={onboardingLoading}
        message={onboardingMessage}
        initialEmail={userEmail}
        onVerifyWaitlist={handleVerifyWaitlist}
        onSubmit={handleOnboardingSubmit}
      />

      {/* Waitlist Modal */}
      <WaitlistModal
        isOpen={isWaitlistModalOpen}
        loading={waitlistLoading}
        message={waitlistMessage}
        initialEmail={userEmail}
        onSubmit={handleWaitlistSubmit}
        onClearMessage={() => setOnboardingMessage(null)}
      />
    </AuthContext.Provider>
  );
}
