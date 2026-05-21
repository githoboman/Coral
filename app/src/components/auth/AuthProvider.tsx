import React, { useState, useEffect, useRef } from "react";
import { sileo } from "sileo";
import { OnboardingModal } from "./Onboarding";
import { useProfile } from "@/hooks/useProfile";
import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useSignPersonalMessage,
} from "@mysten/dapp-kit";

import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useAppDispatch } from "@/store/hooks";
import { useNavigate, useLocation } from "react-router-dom";
import {
  invalidateCache,
  fetchLeaderboard,
  clearLeaderboard,
} from "@/store/slices/leaderboardSlice";


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

  const checkingRef = useRef(false);
  const checkedWalletRef = useRef<string | null>(null);

  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { connectionStatus } = useCurrentWallet();

  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const isInitializing = connectionStatus === "connecting";

  // New hook for signing messages
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const [hasCheckedInit, setHasCheckedInit] = useState(false);

  useEffect(() => {
    // Small delay to allow wallet kit to settle
    const timer = setTimeout(() => setHasCheckedInit(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Background profile fetcher
  useProfile();

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
      if (hasCheckedInit && !isSigninPage && !isMaintenancePage) {
        // ADDED: Give the wallet kit 2 seconds to recover before kicking the user out.
        // This fixes flickering connection status (common with Enoki/Google login).
        const recoverTimer = setTimeout(() => {
          if (!currentAccount) {
            if (location.pathname !== "/" && location.pathname !== "/chat") {
              sessionStorage.setItem("tovira_intended_path", location.pathname + location.search);
            }
            navigate("/signin", { replace: true });
          }
        }, 2000);
        return () => clearTimeout(recoverTimer);
      }
      setIsOnboardingOpen(false);
      sessionStorage.removeItem(SESSION_ONBOARDED_KEY);
      checkedWalletRef.current = null;
      checkingRef.current = false;
      return;
    }

    if (isSigninPage) {
      const intendedPath = sessionStorage.getItem("tovira_intended_path");
      if (intendedPath) {
        sessionStorage.removeItem("tovira_intended_path");
        navigate(intendedPath, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    }

    const activeAddress = currentAccount.address;

    if (checkedWalletRef.current === activeAddress) return;

    const cachedOnboardedWallet = sessionStorage.getItem(SESSION_ONBOARDED_KEY);
    if (cachedOnboardedWallet === activeAddress) {
      checkedWalletRef.current = activeAddress;
      setIsOnboarded(true);
      setIsOnboardingOpen(false);
      return;
    }

    if (!checkingRef.current) {
      checkingRef.current = true;
      checkedWalletRef.current = activeAddress;
      handleAuthentication(activeAddress);
    }
  }, [isInitializing, hasCheckedInit, currentAccount, location.pathname, navigate]);

  const handleAuthentication = async (walletAddress: string) => {
    try {
      // 1. Fast path: Verify existing session cookie
      try {
        const verifyRes = await fetch(`${apiBaseUrl}/api/auth/verify`, {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          // Check the session actually belongs to the CURRENT wallet.
          // If we switched wallets, the old cookie is stale — fall through to re-auth.
          const sessionWallet = (verifyData.user?.wallet_address || "").toLowerCase();
          const currentWallet = walletAddress.toLowerCase();

          if (sessionWallet && sessionWallet === currentWallet) {
            // Session alive AND matches current wallet — skip signature
            await checkUserOnboardingStatus(walletAddress);
            return;
          } else {
            console.warn(
              `[AUTH] Session belongs to ${sessionWallet}, but current wallet is ${currentWallet}. Re-authenticating...`
            );
            // Revoke the stale session before re-authenticating
            try {
              await fetch(`${apiBaseUrl}/api/auth/logout`, {
                method: "POST",
                credentials: "include",
              });
            } catch (_) { /* non-blocking */ }
          }
        }
      } catch (err) {
        console.warn("Session verification failed, falling back to signature", err);
      }

      // 2. Fetch nonce
      const nonceRes = await fetch(
        `${apiBaseUrl}/api/auth/nonce?wallet_address=${encodeURIComponent(walletAddress)}`,
      );
      if (!nonceRes.ok) throw new Error("Failed to fetch nonce");
      const { nonce } = await nonceRes.json();

      // 2. Sign message
      const messageToSign = `Welcome to Tovira!\n\nClick to sign in and accept the Tovira Terms of Service.\n\nThis request will not trigger a blockchain transaction or cost any gas fees.\n\nNonce: ${nonce}`;
      const messageBytes = new TextEncoder().encode(messageToSign);

      const signatureResult = await signPersonalMessage({ message: messageBytes });

      // Read referral code from cookie if present
      const refCookie = document.cookie.split('; ').find(row => row.startsWith('tovira_referral='));
      const referralCode = refCookie ? refCookie.split('=')[1] : undefined;

      // 3. Verify signature — server sets httpOnly auth_token cookie on success
      const loginRes = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: walletAddress,
          signature: signatureResult.signature,
          message: btoa(String.fromCharCode(...messageBytes)),
          referral_code: referralCode,
        }),
      });

      if (!loginRes.ok) {
        const errorData = await loginRes.json().catch(() => ({}));
        console.error("[AUTH] Login API failed:", errorData);
        throw new Error(errorData.error || "Login failed");
      }

      console.log("[AUTH] Login successful");

      // 4. Check onboarding status (cookie is sent automatically)
      await checkUserOnboardingStatus(walletAddress);
    } catch (error: any) {
      console.error("[AUTH] Authentication failed:", error);
      
      // If it's a "User rejected" error from the wallet, don't show a scary message or sign out
      const isUserRejection = error.message?.toLowerCase().includes("rejected") || 
                              error.message?.toLowerCase().includes("cancel");
      
      if (!isUserRejection) {
        sileo.error({ 
          title: "Authentication Failed", 
          description: error.message || "Please sign the message to verify your wallet." 
        });
      }
      
      // Only sign out (disconnect wallet) if we are sure the current connection is invalid
      // or if we were already in a "partially connected" state that needs reset.
      // But for now, let's just reset the checking ref so the user can try again by refreshing
      // or by clicking something that triggers a re-check.
      if (!isUserRejection) {
         signOut();
      } else {
         // If they just rejected the signature, we might want to disconnect anyway to let them try a different wallet
         // but it's better to stay connected to the wallet and just stop the auth flow.
         checkingRef.current = false;
         checkedWalletRef.current = null; // Allow re-triggering
      }
    } finally {
      checkingRef.current = false;
    }
  };

  const checkUserOnboardingStatus = async (walletAddress: string) => {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/auth/check-user?wallet_address=${encodeURIComponent(walletAddress)}`,
          {
            method: "GET",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data = await response.json();

        const fullyOnboarded = data.exists && data.is_onboarded;

        if (!fullyOnboarded) {
          setIsOnboarded(false);
          setIsOnboardingOpen(true);
          if (data.user?.email) setUserEmail(data.user.email);
        } else {
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

    // Read referral code from cookie if present
    const refCookie = document.cookie.split('; ').find(row => row.startsWith('tovira_referral='));
    const referralCode = refCookie ? refCookie.split('=')[1] : undefined;

    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          wallet_address: walletAddress,
          username: additionalData?.username,
          first_name: additionalData?.firstName,
          last_name: additionalData?.lastName,
          referral_code: referralCode,
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
      // Step 1: Revoke the server-side token (deletes the DB row + clears cookie)
      try {
        await fetch(`${apiBaseUrl}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
        });
      } catch (e) {
        // Non-blocking — continue with local cleanup even if server is unreachable
        console.warn("[AUTH] Failed to invalidate token server-side:", e);
      }

      disconnectWallet();

      // Clear Redux stores
      dispatch(clearLeaderboard());

      // Clear Sui wallet / Enoki items from storage
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

      sessionStorage.removeItem(SESSION_ONBOARDED_KEY);

      // Clear any remaining tovira_ cache keys (chat cache etc.)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("tovira_")) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

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
          if (currentAccount?.address) {
            sessionStorage.setItem(
              SESSION_ONBOARDED_KEY,
              currentAccount.address,
            );
          }
          dispatch(invalidateCache());
          dispatch(fetchLeaderboard({}));
          setIsOnboarded(true);
          setIsOnboardingOpen(false);
        }}
      />
    </AuthContext.Provider>
  );
}
