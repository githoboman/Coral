import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { LoginModal, LoginDrawer } from "./Login";
import { OnboardingModal } from "./Onboarding";
import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import "react-toastify/dist/ReactToastify.css";

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
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(
    null,
  );
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { connectionStatus } = useCurrentWallet();

  const isInitializing = connectionStatus === "connecting";

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    const isAuthenticated = !!currentAccount;

    if (!isAuthenticated) {
      if (!isInitializing) {
        setIsLoginOpen(true);
      }
      setIsOnboardingOpen(false);
    } else {
      setIsLoginOpen(false);

      const activeId = currentAccount.address;

      if (activeId && !checkingOnboarding) {
        setCheckingOnboarding(true);
        checkUserOnboardingStatus(activeId);
      }
    }

    return;
  }, [isInitializing, currentAccount]);

  const checkUserOnboardingStatus = async (walletAddress: string) => {
    if (!walletAddress) {
      setCheckingOnboarding(false);
      return;
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/auth/check-user?wallet_address=${encodeURIComponent(walletAddress)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to check user status");
      }

      const data = await response.json();

      if (!data.exists) {
        // User doesn't exist, show onboarding
        setIsOnboarded(false);
        setIsOnboardingOpen(true);
      } else if (!data.user.email) {
        // User exists but not fully onboarded
        setIsOnboarded(false);
        setIsOnboardingOpen(true);
        setUserEmail(data.user.email);
      } else {
        // User exists and is onboarded
        setIsOnboarded(true);
        setIsOnboardingOpen(false);
        setUserEmail(data.user.email);
      }
    } catch (error: any) {
      console.error("Error checking user status:", error.message);
      // Default to showing onboarding on error
      setIsOnboarded(false);
      setIsOnboardingOpen(true);
    } finally {
      setCheckingOnboarding(false);
    }
  };

  const handleOnboardingSubmit = async (
    email: string,
    additionalData?: {
      notifications_enabled?: boolean;
      analytics_enabled?: boolean;
      personalization_enabled?: boolean;
      username?: string;
      firstName?: string;
      lastName?: string;
    },
  ) => {
    const walletAddress = currentAccount?.address;

    if (!walletAddress) {
      toast.error("Wallet not connected");
      return;
    }

    setOnboardingLoading(true);
    setOnboardingMessage(null);

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/auth/verify-and-register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            wallet_address: walletAddress,
            username: additionalData?.username,
            first_name: additionalData?.firstName,
            last_name: additionalData?.lastName,
            preferences: {
              notifications_enabled: additionalData?.notifications_enabled,
              analytics_enabled: additionalData?.analytics_enabled,
              personalization_enabled: additionalData?.personalization_enabled,
            },
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to complete onboarding");
      }

      const data = await response.json();

      setOnboardingMessage("Onboarding completed successfully!");
      setIsOnboarded(true);
      setIsOnboardingOpen(false);
      setUserEmail(email);

      // Show different message based on waitlist status
      if (data.user.is_waitlisted) {
        toast.success(
          `Welcome to Tovira! You've been awarded ${data.user.points_awarded} points! 🎉`,
        );
      } else {
        toast.success("Welcome to Tovira!");
      }
    } catch (error: any) {
      console.error("Error during onboarding:", error.message);
      setOnboardingMessage(error.message || "Failed to complete onboarding");
      toast.error(error.message || "Failed to complete onboarding");
    } finally {
      setOnboardingLoading(false);
    }
  };

  const signOut = async () => {
    try {
      // Disconnect wallet
      disconnectWallet();

      // Clear local storage
      const itemsToClear = [
        "zklogin_jwt",
        "enoki_jwt",
        "id_token",
        "sui-dapp-kit:wallet-connection-info",
      ];
      itemsToClear.forEach((item) => {
        localStorage.removeItem(item);
        sessionStorage.removeItem(item);
      });

      // Reset states
      setUserEmail(null);
      setIsOnboarded(false);

      // Open login modal
      setIsLoginOpen(true);

      toast.success("Successfully logged out");
    } catch (error: any) {
      console.error("Logout error:", error);
      toast.error("Failed to log out completely");
    }
  };

  if (isInitializing) {
    return <LoadingSpinner fullScreen />;
  }

  const handleSignInSuccess = () => {
    setIsLoginOpen(false);
  };

  return (
    <AuthContext.Provider
      value={{
        setIsLoginOpen,
        isLoginOpen,
        isOnboarded,
        userEmail,
        signOut,
      }}
    >
      {children}

      {/* Login Modal/Drawer */}
      {isMobile ? (
        <LoginDrawer
          isOpen={isLoginOpen && !currentAccount}
          loading={false}
          onSignIn={handleSignInSuccess}
        />
      ) : (
        <LoginModal
          isOpen={isLoginOpen && !currentAccount}
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
        onSubmit={handleOnboardingSubmit}
      />
    </AuthContext.Provider>
  );
}
