import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { OnboardingModal } from "./Onboarding";
import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import "react-toastify/dist/ReactToastify.css";
import { useAppDispatch } from "@/store/hooks";
import { useNavigate, useLocation } from "react-router-dom";
import {
  invalidateCache,
  fetchLeaderboard,
  clearLeaderboard,
} from "@/store/slices/leaderboardSlice";
import { resetChats } from "@/store/slices/chatsSlice";

interface AuthContextType {
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
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [_isMobile, setIsMobile] = useState(false);
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

  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

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
    const isSigninPage = location.pathname === "/signin";
    const isMaintenancePage = location.pathname === "/maintenance";

    // Maintenance Mode Check
    const maintenanceEnabled = import.meta.env.VITE_MAINTENANCE_MODE === "true" || import.meta.env.VITE_MAINTENANCE_MODE === true;

    if (maintenanceEnabled) {
      if (!isMaintenancePage) {
        navigate("/maintenance", { replace: true });
      }
      return;
    } else {
      // If maintenance is OFF but we are on the maintenance page, redirect away
      if (isMaintenancePage) {
        if (isAuthenticated) {
          navigate("/", { replace: true });
        } else {
          navigate("/signin", { replace: true });
        }
        return;
      }
    }

    if (!isAuthenticated) {
      if (!isSigninPage && !isInitializing) {
        navigate("/signin", { replace: true });
      }
      setIsOnboardingOpen(false);
    } else {
      // If authenticated and on signin page, redirect to home
      if (isSigninPage) {
        navigate("/", { replace: true });
      }

      const activeId = currentAccount.address;

      if (activeId && !checkingOnboarding) {
        setCheckingOnboarding(true);
        checkUserOnboardingStatus(activeId);
      }
    }
  }, [isInitializing, currentAccount, location.pathname, navigate]);

  const checkUserOnboardingStatus = async (walletAddress: string) => {
    if (!walletAddress) {
      setCheckingOnboarding(false);
      return;
    }

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
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
          // If 404, user definitely doesn't exist, don't retry
          if (response.status === 404) {
            setIsOnboarded(false);
            setIsOnboardingOpen(true);
            setCheckingOnboarding(false);
            return;
          }
          // For other errors (500s), throw to trigger retry
          throw new Error(`Failed to check user status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.exists) {
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
        } else if (!data.user.email) {
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
          setUserEmail(data.user.email);
        } else {
          setIsOnboarded(true);
          setIsOnboardingOpen(false);
          setUserEmail(data.user.email);
        }
        return; // Success, exit function
      } catch (error: any) {
        attempt++;
        console.warn(`Attempt ${attempt} to check user failed:`, error);
        
        if (attempt >= maxRetries) {
          // Only show onboarding if all retries failed (assuming network issue or valid missing user)
           // But be careful: if the backend is down, showing onboarding might be confusing. 
           // However, blocking access is worse. 
           // Let's assume if we can't verify, we prompt to verify.
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
        } else {
           // Wait before retry (exponential backoff: 1s, 2s, 4s)
           await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      } finally {
        if (attempt >= maxRetries) {
          setCheckingOnboarding(false);
        }
      }
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
  ): Promise<{ success: boolean; data?: any }> => {
    const walletAddress = currentAccount?.address;

    if (!walletAddress) {
      toast.error("Wallet not connected");
      return { success: false };
    }

    setOnboardingLoading(true);
    setOnboardingMessage(null);

    try {
      let response = await fetch(`${apiBaseUrl}/api/auth/verify-and-register`, {
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
      });

      if (response.status === 404) {
        response = await fetch(`${apiBaseUrl}/api/auth/register`, {
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
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.detail ||
          errorData.message ||
          "Failed to complete onboarding",
        );
      }

      const data = await response.json();

      setOnboardingMessage("Profile saved successfully!");
      setUserEmail(email);

      toast.success("Profile saved! Checking waitlist status...");

      return { success: true, data };
    } catch (error: any) {
      setOnboardingMessage(error.message || "Failed to save profile");
      toast.error(error.message || "Failed to save profile");

      throw error;
    } finally {
      setOnboardingLoading(false);
    }
  };

  const signOut = async () => {
    try {
      disconnectWallet();

      // Clear Redux stores
      dispatch(resetChats());
      dispatch(clearLeaderboard());

      // 1. Clear specific auth items
      const authItems = [
        "zklogin_jwt",
        "enoki_jwt",
        "id_token",
        "sui-dapp-kit:wallet-connection-info",
      ];
      authItems.forEach((item) => {
        localStorage.removeItem(item);
        sessionStorage.removeItem(item);
      });

      // 2. Clear all tovira-specific cached data (chats, messages, settings etc)
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

      navigate("/signin", { replace: true });

      toast.success("Successfully logged out");
    } catch (error: any) {
      toast.error("Failed to log out completely");
    }
  };

  if (isInitializing) {
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

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen && !isOnboarded}
        loading={onboardingLoading}
        message={onboardingMessage}
        initialEmail={userEmail}
        onSubmit={(email, data) => handleOnboardingSubmit(email, data)}
        onComplete={() => {
          dispatch(invalidateCache());
          dispatch(fetchLeaderboard(false));
          setIsOnboarded(true);
          setIsOnboardingOpen(false);
        }}
      />
    </AuthContext.Provider>
  );
}
