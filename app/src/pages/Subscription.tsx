import { useSubscription } from "@/hooks/useSubscription";
import { Check, Crown, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const Subscription = () => {
  const { subscriptionState, subscribeToPremium } = useSubscription();
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  useEffect(() => {
    if (subscriptionState.status === "success") {
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 3000);
    }
  }, [subscriptionState.status]);

  const freeFeatures = [
    "Lower daily usage limits",
    "Basic wallet analysis",
    "Monitor up to 2 wallets",
    "Basic wallet alerts",
    "Limited alert volume",
  ];

  const proFeatures = [
    "Higher daily usage limits",
    "Richer wallet insights",
    "Monitor up to 7 wallets",
    "More alert coverage",
    "Full alert history",
    "Weekly wallet reports",
  ];

  const isLoading =
    subscriptionState.status === "signing" ||
    subscriptionState.status === "confirming" ||
    subscriptionState.status === "loading";

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pt-24 pb-8 md:py-8 min-h-screen relative">
      {/* Success Animation */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="bg-[#B7FC0D] rounded-3xl p-8 text-center animate-in zoom-in-95 duration-500 max-w-md">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: 360 }}
                transition={{ type: "spring", duration: 0.8 }}
              >
                <Crown className="w-20 h-20 mx-auto mb-4 text-black" />
              </motion.div>
              <h2 className="text-3xl font-bold text-black mb-2">
                Welcome to Pro!
              </h2>
              <p className="text-black/80 text-lg font-medium">
                Your premium access is now active.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Section with Badge */}
      <div className="relative mb-10 px-4">
        {/* Testnet Badge - Absolutely positioned to start at same height as title */}
        <div className="absolute left-0 top-1 hidden md:block">
          <div className="bg-[#25370B] px-3 rounded-full">
            <span className="text-[#B7FC0D] text-[12px]">Testnet</span>
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-3xl text-white mb-4">
            Unlock{" "}
            <span className="relative font-bold inline-block ml-1">
               Coral
              <span className="ml-2 inline-flex items-center px-4 bg-gradient-to-r from-[#246AFC] to-[#246AFC]/80 rounded-full text-lg md:text-xl font-bold align-middle">
                Pro
              </span>
            </span>
          </h1>
          <p className="text-white text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Understand wallet activity at a deeper level, monitor more wallets, and
            capture even more insight with every alert.
          </p>
        </div>
      </div>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 max-w-3xl mx-auto items-center">
        
        {/* Free Tier */}
        <div className="bg-[#050505] border border-white/5 rounded-[32px] p-6 md:p-8 flex flex-col h-full">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">Free</h2>
            <p className="text-white/40 text-sm leading-relaxed">
              Basic access to Coral for lighter usage and essential wallet monitoring.
            </p>
          </div>

          <div className="flex-1 mb-8">
            <h3 className="text-white font-bold text-[10px] uppercase tracking-wider mb-4 opacity-50">Includes</h3>
            <ul className="space-y-3">
              {freeFeatures.map((feature, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-white/30" />
                  </div>
                  <span className="text-white/60 text-xs sm:text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Link
            to="/chat"
            className="w-full py-3.5 bg-[#1A1A1A] hover:bg-[#222] text-white/80 font-bold rounded-full text-center transition-all text-sm"
          >
            Continue with free
          </Link>
        </div>

        {/* Pro Tier */}
        <div className="bg-[#050505] border-2 border-[#B7FC0D]/30 rounded-[32px] p-6 md:p-8 flex flex-col h-full relative group">
          <div className="absolute top-6 right-6">
            <div className="bg-[#25370B] px-2.5 py-0.5 rounded-full">
              <span className="text-[#B7FC0D] text-[12px]">Recommended</span>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">Coral pro</h2>
            <p className="text-white/40 text-sm leading-relaxed">
              A higher-access tier for stronger wallet intelligence and advanced monitoring.
            </p>
          </div>

          <div className="flex-1 mb-8">
            <h3 className="text-white font-bold text-[10px] uppercase tracking-wider mb-4 opacity-50">Includes</h3>
            <ul className="space-y-3">
              {proFeatures.map((feature, i) => (
                <li key={i} className="flex items-center gap-2.5 group/item">
                  <div className="w-4 h-4 rounded-full bg-[#B7FC0D]/10 border border-[#B7FC0D]/20 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-[#B7FC0D]" strokeWidth={3} />
                  </div>
                  <span className="text-white/80 text-xs sm:text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={subscribeToPremium}
            disabled={subscriptionState.isPremium || isLoading}
            className={`
              w-full py-4 rounded-full font-bold text-sm sm:text-base transition-all relative overflow-hidden flex items-center justify-center gap-2
              ${subscriptionState.isPremium
                ? "bg-white/5 text-white/40 cursor-not-allowed"
                : isLoading
                  ? "bg-[#B7FC0D]/20 text-white animate-pulse"
                  : "bg-gradient-to-r from-[#B7FC0D] to-[#246AFC] text-black hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[#B7FC0D]/20"
              }
            `}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : subscriptionState.isPremium ? (
              <>
                <Check className="w-4 h-4" />
                <span>Already Pro</span>
              </>
            ) : (
              "Get Coral Pro for 2 SUI"
            )}
          </button>
        </div>
      </div>

      {/* Bottom Footer Notice */}
      <div className="mt-12 text-center pb-12">
        <p className="text-white/80 text-[11px] sm:text-xs leading-relaxed max-w-xl mx-auto">
          NO real funds are needed for subscribing on testnet. Get free SUI testnet tokens from{" "}
          <a
            href="https://faucet.sui.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#246AFC] hover:underline font-medium"
          >
            faucet
          </a>
        </p>
      </div>
    </div>
  );
};

export default Subscription;
