import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useZkLogin } from '@/hooks/useZkLogin';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

/**
 * OAuth callback page that handles the redirect from Google OAuth
 * and completes the zkLogin authentication flow.
 */
export default function OAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeZkLogin } = useZkLogin();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Extract JWT from URL hash (Google returns it as #id_token=...)
        const hash = location.hash;
        const params = new URLSearchParams(hash.substring(1)); // Remove the '#'
        const idToken = params.get('id_token');

        if (!idToken) {
          throw new Error('No ID token found in callback');
        }

        // Complete zkLogin flow
        await completeZkLogin(idToken);

        // Redirect to dashboard
        navigate('/', { replace: true });
      } catch (error: any) {
        console.error('OAuth callback error:', error);
        // Redirect to home with error
        navigate('/', {
          replace: true,
          state: { error: error.message || 'Authentication failed' },
        });
      }
    };

    handleCallback();
  }, [location, completeZkLogin, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
      <LoadingSpinner size="lg" text="Completing authentication..." />
    </div>
  );
}
