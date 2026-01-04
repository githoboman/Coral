import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { LoginModal, LoginDrawer } from './Login';
import { OnboardingModal } from './Onboarding';
import { WaitlistModal } from './WaitlistModal';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { jwtDecode } from 'jwt-decode';
import 'react-toastify/dist/ReactToastify.css';

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
  const [isInitialized, setIsInitialized] = useState(false);

  const auth = useAuth();
  const currentAccount = useCurrentAccount();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Extract email from JWT
  const extractEmailFromJWT = (): string | null => {
    try {
      // Try multiple possible JWT storage locations
      let jwt = localStorage.getItem('zklogin_jwt');

      // If not found in localStorage, try sessionStorage
      if (!jwt) {
        jwt = sessionStorage.getItem('zklogin_jwt');
      }
      if (!jwt) {
        jwt = sessionStorage.getItem('enoki_jwt');
      }
      if (!jwt) {
        jwt = sessionStorage.getItem('id_token');
      }

      // Try localStorage alternatives
      if (!jwt) {
        jwt = localStorage.getItem('enoki_jwt');
      }
      if (!jwt) {
        jwt = localStorage.getItem('id_token');
      }

      // Check dapp-kit wallet connection info
      if (!jwt) {
        const walletInfo = localStorage.getItem('sui-dapp-kit:wallet-connection-info');
        if (walletInfo) {
          try {
            const parsed = JSON.parse(walletInfo);
            console.log('[AuthProvider] Dapp-kit wallet info:', parsed);
            // Check if there's a JWT in the wallet info
            if (parsed.jwt || parsed.token || parsed.idToken) {
              jwt = parsed.jwt || parsed.token || parsed.idToken;
            }
          } catch (e) {
            console.log('[AuthProvider] Could not parse wallet info');
          }
        }
      }

      // Check Privy token storage
      if (!jwt) {
        const privyToken = localStorage.getItem('privy:token');
        if (privyToken) {
          try {
            // Privy token might be a JWT or contain user info
            if (privyToken.includes('.')) {
              jwt = privyToken;
            }
          } catch (e) {
            console.log('[AuthProvider] Could not parse Privy token');
          }
        }
      }

      // Check for wallet-specific storage
      if (!jwt) {
        // Check all localStorage keys for anything that might be a JWT
        const allKeys = Object.keys(localStorage);
        console.log('Available localStorage keys:', allKeys);

        // Look for keys that might contain JWT
        const jwtKey = allKeys.find(key =>
          key.toLowerCase().includes('jwt') ||
          key.toLowerCase().includes('token') ||
          key.toLowerCase().includes('enoki')
        );

        if (jwtKey) {
          const value = localStorage.getItem(jwtKey);
          if (value && value.includes('.')) { // JWTs have dots
            jwt = value;
            console.log(`Found potential JWT in key: ${jwtKey}`);
          }
        }
      }

      if (!jwt) {
        console.log('No JWT found in localStorage or sessionStorage');
        console.log('Checked: zklogin_jwt, enoki_jwt, id_token, dapp-kit, Privy storage');

        // Alternative: Try to get user info from Privy connections
        const privyConnections = localStorage.getItem('privy:connections');
        if (privyConnections) {
          try {
            const connections = JSON.parse(privyConnections);
            console.log('[AuthProvider] Privy connections:', connections);
            // This might contain user info
          } catch (e) {
            console.log('[AuthProvider] Could not parse Privy connections');
          }
        }

        return null;
      }

      const decodedJwt = jwtDecode<GoogleJwtPayload>(jwt);
      console.log('Successfully decoded JWT');
      console.log('User email:', decodedJwt.email);
      console.log('User name:', decodedJwt.name);
      return decodedJwt.email || null;
    } catch (error) {
      console.error('Error decoding JWT:', error);
      return null;
    }
  };


  useEffect(() => {
    // Debug logging for account state
    console.log('[AuthProvider] Account state:', {
      currentAccount: currentAccount?.address,
      authIsAuthenticated: auth.isAuthenticated,
      authAddress: auth.address,
    });

    // Wait a brief moment for wallet connection to initialize
    // This prevents the flash of login modal before currentAccount is loaded
    const initTimer = setTimeout(() => {
      if (!isInitialized) {
        setIsInitialized(true);
      }
    }, 500); // Increased to 500ms to ensure wallet state is loaded

    // Check if either auth method is authenticated
    const isUserAuthenticated = auth.isAuthenticated || !!currentAccount;
    const activeAddress = auth.isAuthenticated ? auth.address : currentAccount?.address;

    if (!isUserAuthenticated) {
      // Only show login modal if we've initialized (prevents flash on first render)
      if (isInitialized) {
        setIsLoginOpen(true);
      }
      setIsOnboardingOpen(false);
      setCheckingOnboarding(false); // Reset loading state when disconnected
    } else {
      // User is authenticated, mark as initialized immediately
      setIsInitialized(true);
      setIsLoginOpen(false);
      // Extract email from JWT when user is authenticated
      if (activeAddress && !userEmail) {
        const email = extractEmailFromJWT();
        if (email) {
          setUserEmail(email);
          console.log('Extracted email from JWT:', email);
        }
      }
      // Always check onboarding status when user is authenticated (but only if not already checking)
      if (activeAddress && !checkingOnboarding) {
        setCheckingOnboarding(true);
        checkUserOnboardingStatus();
      }
    }

    return () => clearTimeout(initTimer);
  }, [auth.isAuthenticated, auth.pubkeyHex, auth.address, currentAccount, isInitialized]);

  const checkUserOnboardingStatus = async () => {
    // Determine which auth method is active
    const activeAddress = auth.isAuthenticated ? auth.address : currentAccount?.address;
    const activeId = auth.isAuthenticated ? auth.pubkeyHex : currentAccount?.address; // For Enoki, address is ID

    if (!activeId || !activeAddress) {
      setCheckingOnboarding(false); // Reset loading state if no auth data
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
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

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
    const activeId = auth.isAuthenticated ? auth.pubkeyHex : currentAccount?.address;

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

      const data = await response.json();
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

      // Close waitlist modal and open onboarding modal after successful submission
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

  if (checkingOnboarding) {
    return <LoadingSpinner fullScreen />;
  }

  // Show loading during initialization to prevent login modal flash
  if (!isInitialized) {
    return <LoadingSpinner fullScreen />;
  }


  return (
    <>
      {children}

      {/* Login Modal/Drawer */}
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !currentAccount && isInitialized}
          loading={auth.loading}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !currentAccount && isInitialized}
          loading={auth.loading}
        />
      )}

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen && !isOnboarded}
        loading={onboardingLoading}
        message={onboardingMessage}
        initialEmail={userEmail}
        onSubmit={handleOnboardingSubmit}
        onClearMessage={() => setOnboardingMessage(null)}
      />

      {/* Waitlist Modal */}
      <WaitlistModal
        isOpen={isWaitlistModalOpen}
        loading={waitlistLoading}
        message={waitlistMessage}
        initialEmail={userEmail}
        onSubmit={handleWaitlistSubmit}
        onClearMessage={() => setWaitlistMessage(null)}
      />
    </>
  );
}