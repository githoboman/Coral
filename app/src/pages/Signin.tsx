import { useState, useEffect } from "react";
import { useConnectWallet, useWallets, useCurrentAccount } from "@mysten/dapp-kit";
import { isEnokiWallet, type AuthProvider } from "@mysten/enoki";
import { sileo } from "sileo";
import { useNavigate } from "react-router-dom";

const SocialIconGoogle = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.43-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

export default function Signin() {
  const { mutate: connect } = useConnectWallet();
  const allWallets = useWallets();
  const currentAccount = useCurrentAccount();
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);

  const enokiWallets = allWallets.filter(isEnokiWallet);
  const nativeWallets = allWallets.filter((w) => !isEnokiWallet(w));

  const walletsByProvider = enokiWallets.reduce(
    (map, wallet) => map.set(wallet.provider, wallet),
    new Map<AuthProvider, any>(),
  );

  const googleWallet = walletsByProvider.get("google");

  // Redirect if already authenticated
  useEffect(() => {
    if (import.meta.env.VITE_MAINTENANCE_MODE === "true" || import.meta.env.VITE_MAINTENANCE_MODE === true) {
      navigate("/maintenance");
      return;
    }
    if (currentAccount) {
      navigate("/");
    }
  }, [currentAccount, navigate]);

  const handleGoogleSignIn = () => {
    if (googleWallet) {
      setIsConnecting(true);
      connect(
        { wallet: googleWallet },
        {
          onSuccess: () => {
            setIsConnecting(false);
            navigate("/");
          },
          onError: (error) => {
            setIsConnecting(false);
            sileo.error({ title: "Connection Failed", description: error.message || "Failed to connect with Google" });
          },
        },
      );
    } else {
      sileo.error({ 
        title: "Google Sign-in Unavailable", 
        description: "Check your Enoki configuration." 
      });
    }
  };

  const handleWalletConnect = (wallet: any) => {
    setIsConnecting(true);
    connect(
      { wallet },
      {
        onSuccess: () => {
          setIsConnecting(false);
          navigate("/");
        },
        onError: (error) => {
          setIsConnecting(false);
          sileo.error({ title: "Connection Failed", description: error.message || "Failed to connect wallet" });
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#070B0F] flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(139,238,28,0.05),transparent_50%)]" />

      {/* Tovira Logo */}
      <div className="fixed top-5 left-5 z-10 transition-transform duration-500 hover:scale-105">
        <img
          src="/assets/images/signin-logo.png"
          alt="Tovira Logo"
          className="w-20 h-20 object-contain p-2"
        />
      </div>

      {/* Card Container */}
      <div className="relative w-full max-w-[440px] z-10">
        <div className="w-full flex flex-col justify-between h-[70vh] md:bg-[#0D1117]/60 md:backdrop-blur-xl md:border border-white/5 rounded-[40px] p-0 md:p-8 sm:p-10 md:shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          {/* Title */}
          <div className="text-center mb-10">
            <h2 className="text-[32px] font-[500] text-white tracking-tight mb-3">
              Welcome to{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#8BEE1C] to-[#2B87D1]">
                Tovira
              </span>
            </h2>
            <p className="text-white/50 text-base">
              The ultimate AI assistant for web3
            </p>
          </div>

          <div>
            {/* Connection Options */}
            <div className="space-y-4 mb-8">
              {/* Google Sign-In */}
              {googleWallet && (
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isConnecting}
                  className="w-full bg-[#1A1F24] hover:bg-[#252A30] border border-white/5 rounded-full py-4.5 px-6 flex items-center justify-center gap-3 transition-all duration-300 group disabled:opacity-50 font-medium cursor-pointer hover:border-white/10"
                >
                  <SocialIconGoogle />
                  <span className="text-white text-base">
                    Continue with Google
                  </span>
                </button>
              )}

              {/* Divider */}
              {googleWallet && nativeWallets.length > 0 && (
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-[#0D1117] px-4 text-white/30 text-xs font-medium uppercase tracking-widest">
                      or connect wallet
                    </span>
                  </div>
                </div>
              )}

              {/* Native Sui Wallets */}
              <div className="space-y-3">
                {nativeWallets.length > 0 ? (
                  nativeWallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      onClick={() => handleWalletConnect(wallet)}
                      disabled={isConnecting}
                      className="w-full bg-[#1A1F24]/50 hover:bg-[#252A30] border border-white/5 rounded-full py-4 px-6 flex items-center justify-center gap-3 transition-all duration-300 group disabled:opacity-50 font-medium cursor-pointer hover:border-white/10"
                    >
                      {wallet.icon && (
                        <img
                          src={wallet.icon}
                          alt={wallet.name}
                          className="w-5 h-5"
                        />
                      )}
                      <span className="text-white/80 text-base">
                        {wallet.name}
                      </span>
                    </button>
                  ))
                ) : !googleWallet && (
                  <div className="text-center py-6">
                    <p className="text-white/40 text-sm mb-4 leading-relaxed">
                      No wallet detected. Please install a Sui wallet extension to continue.
                    </p>
                    <a
                      href="https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-[#8BEE1C] hover:text-[#A3FF2D] text-sm font-semibold transition-colors"
                    >
                      Install Sui Wallet
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Info */}
            <div className="text-center">
              {isConnecting && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-[#8BEE1C]/20 border-t-[#8BEE1C] rounded-full animate-spin"></div>
                  <p className="text-[#8BEE1C] text-sm font-medium animate-pulse">Requesting connection...</p>
                </div>
              )}
              {!isConnecting && (
                <p className="text-white/20 text-xs mt-6">
                  By connecting, you agree to our <span className="text-[#B7FC0D] cursor-pointer hover:text-white/60">Terms</span> and <span className="text-[#B7FC0D] cursor-pointer hover:text-white/60">Privacy Policy</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
