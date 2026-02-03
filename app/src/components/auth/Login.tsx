import { useState, useEffect } from 'react';
import { useConnectWallet, useWallets } from '@mysten/dapp-kit';
import { isEnokiWallet, type AuthProvider } from '@mysten/enoki';
import { EmailLoginForm } from './EmailLoginForm';
import { toast } from 'react-toastify';

interface LoginModalProps {
  isOpen: boolean;
  loading: boolean;
  onSignIn: () => void;
  onSignInWithGoogle?: () => void;
}

const SocialIconGoogle = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export function LoginModal({ isOpen, loading, onSignIn }: LoginModalProps) {
  const { mutate: connect } = useConnectWallet();
  const allWallets = useWallets();
  const enokiWallets = allWallets.filter(isEnokiWallet);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true);

  const walletsByProvider = enokiWallets.reduce(
    (map, wallet) => map.set(wallet.provider, wallet),
    new Map<AuthProvider, any>(),
  );

  const googleWallet = walletsByProvider.get('google');
  // Find a traditional Sui wallet if available
  const suiWallet = allWallets.find(w => !isEnokiWallet(w));

  const handleGoogleSignIn = () => {
    if (googleWallet) {
      setIsConnecting(true);
      connect(
        { wallet: googleWallet },
        {
          onSuccess: () => setIsConnecting(false),
          onError: () => setIsConnecting(false),
        }
      );
    }
  };

  const handleSuiSignIn = () => {
    if (suiWallet) {
      setIsConnecting(true);
      connect(
        { wallet: suiWallet },
        {
          onSuccess: () => setIsConnecting(false),
          onError: () => setIsConnecting(false),
        }
      );
    } else {
      toast.info('Please install a Sui wallet (like Sui Wallet or Ethos) to continue.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  const isLoading = loading || isConnecting;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md" />

      {/* Tovira Logo */}
      <div className="fixed top-6 left-6 z-[310]">
        <img src="/assets/images/signin-logo.png" alt="Logo" className="w-16 h-16 object-contain" />
      </div>

      {/* Card Container */}
      <div className="relative w-full max-w-[540px] flex flex-col items-center">
        <div className="w-full md:bg-[#0D1117]/80 backdrop-blur-2xl md:border border-white/5 rounded-[40px] p-6 sm:p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          {/* Title */}
          <div className="text-center mb-8">
            <h2 className="text-[28px] font-[500] text-white tracking-tight">
              Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#8BEE1C] to-[#2B87D1]">Tovira</span>
            </h2>
          </div>

          {/* Form */}
          <EmailLoginForm
            onSuccess={onSignIn}
            loading={isLoading}
            setLoading={setIsConnecting}
            isSignUp={isSignUp}
          />

          {/* Divider */}
          <div className="relative py-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/20"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-black md:bg-[#0D1117] px-4 text-white/30 text-sm font-medium">or</span>
            </div>
          </div>

          {/* Social Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <button
              onClick={handleSuiSignIn}
              className="btn btn-outline flex-1 gap-2"
            >
              <img src="/assets/icons/sui.svg" className="w-4 h-4" />
              <span className="text-sm">Continue with Sui</span>
            </button>

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="btn btn-outline flex-1 gap-2"
            >
              <SocialIconGoogle />
              <span className="text-sm">Continue with Google</span>
            </button>
          </div>

          {/* Mode Toggle */}
          <div className="text-center">
            <p className="text-white/60 text-sm">
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-[#8BEE1C] font-bold hover:underline bg-transparent border-none p-0 cursor-pointer transition-all active:scale-95"
              >
                {isSignUp ? 'Login' : 'Sign Up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginDrawer(props: any) {
  return <LoginModal {...props} />;
}
