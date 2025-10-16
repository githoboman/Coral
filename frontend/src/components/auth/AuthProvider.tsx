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
      // Check and update user profile in backend when authenticated
      const checkAndUpdateUserProfile = async () => {
        if (!auth.pubkeyHex || !auth.address) return;

        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

        try {
          // Check if user exists
          const checkResponse = await fetch(`${apiBaseUrl}/api/check-user?user_id=${encodeURIComponent(auth.pubkeyHex)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!checkResponse.ok) {
            const errorData = await checkResponse.json();
            throw new Error(errorData.detail || 'Failed to check user');
          }

          const checkData = await checkResponse.json();
          if (checkData.exists) {
            console.log(`User ${auth.pubkeyHex} already exists, skipping update`);
            return;
          }

          // User doesn't exist, update profile
          const updateResponse = await fetch(`${apiBaseUrl}/api/update-user`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: auth.pubkeyHex,
              wallet_address: auth.address,
              // Add email, username, etc., if available
            }),
          });

          if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(errorData.detail || 'Failed to update user profile');
          }

          const updateData = await updateResponse.json();
          console.log('User profile updated:', updateData.message);
        } catch (error: any) {
          console.error('Error updating user profile:', error.message);
          auth.clearMessage();
          auth.setAuthState((prev) => ({
            ...prev,
            message: `Failed to update user profile: ${error.message}`,
          }));
        }
      };

      checkAndUpdateUserProfile();
    }
  }, [auth.isAuthenticated, auth.pubkeyHex, auth.address]);

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