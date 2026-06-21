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
    <div className="relative min-h-screen w-full bg-[#070B0F] flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Animated aurora background */}
      <div className="coral-aurora fixed inset-0 bg-[linear-gradient(120deg,rgba(255,106,77,0.10),transparent_35%,rgba(43,135,209,0.08)_60%,transparent_80%)]" />
      {/* Floating glow orbs */}
      <div className="coral-orb pointer-events-none fixed -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,106,77,0.22),transparent_70%)] blur-2xl" />
      <div className="coral-orb-slow pointer-events-none fixed -bottom-40 -right-28 w-[480px] h-[480px] rounded-full bg-[radial-gradient(circle,rgba(43,135,209,0.18),transparent_70%)] blur-2xl" />
      {/* Subtle grid texture */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.04] bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:48px_48px]" />

      {/* Coral Logo */}
      <div className="coral-fade-up coral-d1 fixed top-5 left-5 z-20 flex items-center gap-2 transition-transform duration-500 hover:scale-105">
        <img src="/assets/coral-mark.svg" alt="Coral Logo" className="w-11 h-11 object-contain" />
        <span className="text-white font-bold text-lg tracking-tight hidden sm:block">Coral</span>
      </div>

      {/* Card Container */}
      <div className="relative w-full max-w-[460px] z-10">
        <div className="w-full flex flex-col justify-center md:bg-[#0D1117]/60 md:backdrop-blur-xl md:border border-white/10 rounded-[40px] p-0 md:p-9 sm:p-10 md:shadow-[0_30px_80px_-20px_rgba(255,106,77,0.25),0_20px_50px_rgba(0,0,0,0.5)]">
          {/* Title */}
          <div className="text-center mb-9">
            {/* Animated mark with pulse ring */}
            <div className="coral-fade-up coral-d1 flex justify-center mb-5">
              <div className="coral-pulse-ring w-16 h-16 rounded-[18px] flex items-center justify-center">
                <img src="/assets/coral-mark.svg" alt="" className="w-16 h-16" />
              </div>
            </div>

            <h2 className="coral-fade-up coral-d2 text-[34px] font-[600] text-white tracking-tight mb-3 leading-tight">
              Welcome to <span className="coral-shimmer font-bold">Coral</span>
            </h2>
            <p className="coral-fade-up coral-d3 text-white/55 text-[15px] leading-relaxed max-w-[380px] mx-auto">
              An AI agent that trades on Sui <span className="text-white/80">for you</span> — you set the
              limits once, and they're enforced <span className="text-[#FF9472]">on-chain</span>. Even a
              compromised key can't overspend or go off-scope.
            </p>

            {/* What Coral does */}
            <div className="coral-fade-up coral-d4 mt-6 flex flex-wrap items-center justify-center gap-2">
              {[
                "Plain-language commands",
                "On-chain policy limits",
                "DeepBook V3 swaps",
                "Revoke anytime",
              ].map((f) => (
                <span
                  key={f}
                  className="text-[11px] font-medium text-white/70 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur-sm transition-all hover:bg-white/10 hover:border-[#FF6A4D]/40 hover:text-white"
                >
                  {f}
                </span>
              ))}
            </div>

            {/* How it works — 3 steps */}
            <div className="coral-fade-up coral-d5 mt-7 grid grid-cols-3 gap-2 text-left">
              {[
                { n: "1", t: "Set limits", d: "Budget, assets, expiry — signed once into an on-chain policy." },
                { n: "2", t: "Instruct", d: "“Swap 30% of my SUI to USDC.” The agent parses & checks policy." },
                { n: "3", t: "It trades", d: "Real DeepBook swaps execute. Revoke and it stops instantly." },
              ].map((s) => (
                <div key={s.n} className="rounded-2xl bg-white/[0.03] border border-white/5 p-3">
                  <div className="w-6 h-6 rounded-full bg-[#FF6A4D]/15 text-[#FF9472] text-[12px] font-bold flex items-center justify-center mb-2">
                    {s.n}
                  </div>
                  <div className="text-white text-[12px] font-semibold mb-0.5">{s.t}</div>
                  <div className="text-white/40 text-[10.5px] leading-snug">{s.d}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="coral-fade-up coral-d6">
            {/* Connection Options */}
            <div className="space-y-4 mb-8">
              {/* Google Sign-In */}
              {googleWallet && (
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isConnecting}
                  className="w-full bg-[#1A1F24] hover:bg-[#252A30] border border-white/5 rounded-full py-4.5 px-6 flex items-center justify-center gap-3 transition-all duration-300 group disabled:opacity-50 font-medium cursor-pointer hover:border-white/15 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)] active:translate-y-0"
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
                      className="w-full bg-[#1A1F24]/50 hover:bg-[#252A30] border border-white/5 rounded-full py-4 px-6 flex items-center justify-center gap-3 transition-all duration-300 group disabled:opacity-50 font-medium cursor-pointer hover:border-[#FF6A4D]/30 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,106,77,0.15)] active:translate-y-0"
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
                      className="inline-flex items-center gap-2 text-[#FF6A4D] hover:text-[#FF9472] text-sm font-semibold transition-colors"
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
                  <div className="w-6 h-6 border-2 border-[#FF6A4D]/20 border-t-[#FF6A4D] rounded-full animate-spin"></div>
                  <p className="text-[#FF6A4D] text-sm font-medium animate-pulse">Requesting connection...</p>
                </div>
              )}
              {!isConnecting && (
                <p className="text-white/25 text-xs mt-6">
                  By connecting, you agree to our <span className="text-[#FF9472] cursor-pointer hover:text-white/70 transition-colors">Terms</span> and <span className="text-[#FF9472] cursor-pointer hover:text-white/70 transition-colors">Privacy Policy</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
