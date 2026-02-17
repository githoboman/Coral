import React, { useState, useEffect, useRef } from "react";
import { sileo } from "sileo";
import { OnboardingModal } from "./Onboarding";
import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
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

// Session-level cache so onboarding check only runs once per wallet per page session
const SESSION_ONBOARDED_KEY = "tovira_onboarded_wallet";

export function AuthProvider({ children }: AuthProviderProps) {
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [_isMobile, setIsMobile] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(
    null,
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Use a ref so the check never runs twice even under StrictMode double-invoke
  const checkingRef = useRef(false);
  const checkedWalletRef = useRef<string | null>(null);

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
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isInitializing) return;

    const isAuthenticated = !!currentAccount;
    const isSigninPage = location.pathname === "/signin";
    const isMaintenancePage = location.pathname === "/maintenance";

    const maintenanceEnabled =
      import.meta.env.VITE_MAINTENANCE_MODE === "true" ||
      import.meta.env.VITE_MAINTENANCE_MODE === true;

    if (maintenanceEnabled) {
      if (!isMaintenancePage) navigate("/maintenance", { replace: true });
      return;
    } else {
      if (isMaintenancePage) {
        navigate(isAuthenticated ? "/" : "/signin", { replace: true });
        return;
      }
    }

    if (!isAuthenticated) {
      if (!isSigninPage) navigate("/signin", { replace: true });
      setIsOnboardingOpen(false);
      // Clear the session cache when wallet disconnects
      sessionStorage.removeItem(SESSION_ONBOARDED_KEY);
      checkedWalletRef.current = null;
      checkingRef.current = false;
      return;
    }

    // Authenticated
    if (isSigninPage) {
      navigate("/", { replace: true });
    }

    const activeAddress = currentAccount.address;

    // If we already checked THIS wallet address in this session, skip
    if (checkedWalletRef.current === activeAddress) return;

    // Check sessionStorage first — if already marked onboarded for this wallet, skip API call
    const cachedOnboardedWallet = sessionStorage.getItem(SESSION_ONBOARDED_KEY);
    if (cachedOnboardedWallet === activeAddress) {
      checkedWalletRef.current = activeAddress;
      setIsOnboarded(true);
      setIsOnboardingOpen(false);
      return;
    }

    // Only run the API check once per wallet per mount
    if (!checkingRef.current) {
      checkingRef.current = true;
      checkedWalletRef.current = activeAddress;
      checkUserOnboardingStatus(activeAddress);
    }
  }, [isInitializing, currentAccount, location.pathname, navigate]);

  const checkUserOnboardingStatus = async (walletAddress: string) => {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/auth/check-user?wallet_address=${encodeURIComponent(walletAddress)}`,
          {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data = await response.json();

        // is_onboarded: true means the wallet has a profile in the Walrus registry
        // (set server-side — covers both waitlisted and non-waitlisted users)
        const fullyOnboarded = data.exists && data.is_onboarded;

        if (!fullyOnboarded) {
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
          if (data.user?.email) setUserEmail(data.user.email);
        } else {
          // Cache so page refreshes skip the API call entirely
          sessionStorage.setItem(SESSION_ONBOARDED_KEY, walletAddress);
          setIsOnboarded(true);
          setIsOnboardingOpen(false);
          if (data.user?.email) setUserEmail(data.user.email);
        }

        checkingRef.current = false;
        return;
      } catch (error: any) {
        console.warn(`Attempt ${attempt} to check user failed:`, error);
        if (attempt < maxRetries) {
          await new Promise((r) =>
            setTimeout(r, 1000 * Math.pow(2, attempt - 1)),
          );
        } else {
          // All retries failed — show onboarding as safe fallback
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
        }
      }
    }

    checkingRef.current = false;
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
      sileo.error({ title: "Error", description: "Wallet not connected" });
      return { success: false };
    }

    setOnboardingLoading(true);
    setOnboardingMessage(null);

    try {
      // Single call to /register — saves the profile in Walrus.
      // This is what makes check-user return is_onboarded: true on subsequent loads.
      const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      sileo.success({
        title: "Profile Saved",
        description: "Checking waitlist status...",
      });
      return { success: true, data };
    } catch (error: any) {
      setOnboardingMessage(error.message || "Failed to save profile");
      sileo.error({
        title: "Error",
        description: error.message || "Failed to save profile",
      });
      throw error;
    } finally {
      setOnboardingLoading(false);
    }
  };

  const signOut = async () => {
    try {
      disconnectWallet();
      dispatch(resetChats());
      dispatch(clearLeaderboard());

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

      // Clear session onboarding cache
      sessionStorage.removeItem(SESSION_ONBOARDED_KEY);

      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("tovira_")) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      // Reset refs
      checkingRef.current = false;
      checkedWalletRef.current = null;

      setUserEmail(null);
      setIsOnboarded(false);
      navigate("/signin", { replace: true });
      sileo.success({
        title: "Logged Out",
        description: "Successfully logged out",
      });
    } catch (error: any) {
      sileo.error({
        title: "Error",
        description: "Failed to log out completely",
      });
    }
  };

  if (isInitializing) return <LoadingSpinner fullScreen />;

  return (
    <AuthContext.Provider value={{ isOnboarded, userEmail, signOut }}>
      {children}

      <OnboardingModal
        isOpen={isOnboardingOpen && !isOnboarded}
        loading={onboardingLoading}
        message={onboardingMessage}
        initialEmail={userEmail}
        onSubmit={(email, data) => handleOnboardingSubmit(email, data)}
        onComplete={() => {
          // Mark as onboarded in session cache so reloads are instant
          if (currentAccount?.address) {
            sessionStorage.setItem(
              SESSION_ONBOARDED_KEY,
              currentAccount.address,
            );
          }
          dispatch(invalidateCache());
          dispatch(fetchLeaderboard(false));
          setIsOnboarded(true);
          setIsOnboardingOpen(false);
        }}
      />
    </AuthContext.Provider>
  );
}
