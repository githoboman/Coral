import { useSubscription } from "@/hooks/useSubscription";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Check, Crown, Zap, Shield, Star, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const Subscription = () => {
  const { subscriptionState, subscribeToPremium } = useSubscription();
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  useEffect(() => {
    if (subscriptionState.status === "success") {
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 3000);
    }
  }, [subscriptionState.status]);

  const features = [
    { icon: Zap, text: "5 daily prompts", highlight: "vs 2 free" },
    {
      icon: Crown,
      text: "Priority agent access",
      highlight: "Faster responses",
    },
    { icon: Shield, text: "Advanced features", highlight: "Early access" },
    { icon: Star, text: "Premium support", highlight: "Dedicated help" },
  ];

  const isLoading =
    subscriptionState.status === "signing" ||
    subscriptionState.status === "confirming" ||
    subscriptionState.status === "loading";

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      {/* Success Animation */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl p-8 text-center animate-in zoom-in-95 duration-500 max-w-md">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: 360 }}
                transition={{ type: "spring", duration: 0.8 }}
              >
                <Crown className="w-20 h-20 mx-auto mb-4 text-white" />
              </motion.div>
              <h2 className="text-3xl font-bold text-white mb-2">
                Welcome to Premium!
              </h2>
              <p className="text-white/90 text-lg">
                You now have access to all premium features for 30 days
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Subscription</h1>
        <p className="text-white/60 mt-2">
          Unlock premium features and maximize your Tovira experience
        </p>
      </div>

      {/* Current Status */}
      {subscriptionState.isPremium && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <PremiumBadge
            variant="large"
            daysRemaining={subscriptionState.daysRemaining}
            showExpiry={true}
          />
        </motion.div>
      )}

      {/* Pricing Card */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-8 mb-6 relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          {/* Plan Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-2xl font-bold text-white">Premium Plan</h2>
                <div className="px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-400 to-blue-600 text-white text-xs font-bold">
                  POPULAR
                </div>
              </div>
              <p className="text-white/60 text-sm">
                Full access to all features for 30 days
              </p>
            </div>

            <div className="text-right">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-white">2</span>
                <span className="text-xl text-white/60">SUI</span>
              </div>
              <p className="text-white/40 text-xs mt-1">per month</p>
            </div>
          </div>

          {/* Features List */}
          <div className="space-y-4 mb-8">
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium">{feature.text}</p>
                  <p className="text-white/40 text-sm">{feature.highlight}</p>
                </div>
                <Check className="w-5 h-5 text-green-400" />
              </motion.div>
            ))}
          </div>

          {/* Error Message */}
          {subscriptionState.error && (
            <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
              <p className="text-red-400 text-sm">{subscriptionState.error}</p>
            </div>
          )}

          {/* Subscribe Button */}
          <button
            onClick={subscribeToPremium}
            disabled={subscriptionState.isPremium || isLoading}
            className={`
              w-full py-4 rounded-full font-bold text-base transition-all duration-300 
              ${
                subscriptionState.isPremium
                  ? "bg-white/10 text-white/40 cursor-not-allowed"
                  : isLoading
                    ? "bg-gradient-to-r from-blue-500 to-blue-700 text-white cursor-wait"
                    : "bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 hover:scale-[1.02]"
              }
            `}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                {subscriptionState.status === "signing" &&
                  "Awaiting Signature..."}
                {subscriptionState.status === "confirming" &&
                  "Processing Payment..."}
                {subscriptionState.status === "loading" && "Loading..."}
              </span>
            ) : subscriptionState.isPremium ? (
              <span className="flex items-center justify-center gap-2">
                <Crown className="w-5 h-5" />
                Already Subscribed
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Crown className="w-5 h-5" />
                Subscribe for 2 SUI
              </span>
            )}
          </button>

          {/* Additional Info */}
          {!subscriptionState.isPremium && (
            <div className="mt-6 pt-6 border-t border-white/5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
                    Duration
                  </p>
                  <p className="text-white text-sm font-medium">30 Days</p>
                </div>
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
                    Auto-Renew
                  </p>
                  <p className="text-white text-sm font-medium">No</p>
                </div>
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
                    Refundable
                  </p>
                  <p className="text-white text-sm font-medium">No</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Free Tier Info */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6">
        <h3 className="text-lg font-bold text-white mb-4">Free Tier</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-white/60">
            <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-sm">2 daily prompts</span>
          </div>
          <div className="flex items-center gap-3 text-white/60">
            <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-sm">Basic agent access</span>
          </div>
          <div className="flex items-center gap-3 text-white/60">
            <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-sm">Standard support</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Subscription;
