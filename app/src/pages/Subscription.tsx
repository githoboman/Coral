import { useSubscription } from "@/hooks/useSubscription";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Check, Crown, Zap, Shield, Star, Loader2, Info, ExternalLink } from "lucide-react";
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
    { icon: Zap, text: "Enhanced daily prompts", highlight: "4 Task / 5 Research" },
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

      {/* Testnet Banner */}
      <div className="mb-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#2A2A2E] border border-white/5 rounded-2xl p-4 flex items-start gap-4 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0 border border-amber-500/20">
            <Info className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-amber-500 font-bold text-sm mb-1 uppercase tracking-wider flex items-center gap-2">
              Sui Testnet Environment
            </h3>
            <p className="text-white/70 text-sm leading-relaxed">
              Tovira is currently running on the <span className="font-bold text-white">Sui Testnet</span>.
              You do not need real funds. Use the Sui Faucet to get free <span className="text-amber-500 font-mono text-xs px-1 py-0.5 bg-amber-500/10 rounded">TEST-SUI</span> for this subscription.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent mb-4">
          Upgrade Your Experience
        </h1>
        <p className="text-white/60 text-lg max-w-lg mx-auto">
          Unlock the full potential of your AI assistant with premium features and priority access.
        </p>
      </div>

      {/* Current Status */}
      {subscriptionState.isPremium && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex justify-center"
        >
          <PremiumBadge
            variant="large"
            daysRemaining={subscriptionState.daysRemaining}
            showExpiry={true}
          />
        </motion.div>
      )}

      {/* Pricing Card */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[32px] p-8 mb-8 relative overflow-hidden group">
        {/* Glow effect */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/10 blur-[100px] rounded-full group-hover:bg-blue-500/30 transition-colors duration-500 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

        <div className="relative z-10 grid md:grid-cols-2 gap-8 items-center">

          {/* Left Column: Plan Info */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Crown className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white leading-none">Premium Plan</h2>
                <span className="text-blue-400 text-xs font-bold uppercase tracking-wide">Most Popular</span>
              </div>
            </div>

            <p className="text-white/60 text-sm mb-6 max-w-xs">
              Full access to advanced AI capabilities, priority processing, and increased daily prompt quotas.
            </p>

            <div className="space-y-3">
              {features.map((feature, idx) => (
                <div key={idx} className="flex items-center gap-3 group/item">
                  <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center group-hover/item:bg-blue-500/20 transition-colors">
                    <Check className="w-3.5 h-3.5 text-blue-400" strokeWidth={3} />
                  </div>
                  <span className="text-white/90 text-sm flex-1">{feature.text}</span>
                  {feature.highlight && (
                    <span className="text-white/40 text-xs bg-white/5 px-2 py-0.5 rounded-full">
                      {feature.highlight}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Pricing & Action */}
          <div className="bg-white/5 rounded-3xl p-6 border border-white/5 flex flex-col items-center text-center relative overflow-hidden">
            <div className="mb-1">
              <span className="text-white/40 text-sm font-medium uppercase tracking-wider">Price</span>
            </div>
            <div className="flex items-baseline justify-center gap-1 mb-6">
              <span className="text-5xl font-bold text-white tracking-tight">2</span>
              <span className="text-xl font-bold text-blue-400">TEST-SUI</span>
            </div>

            <button
              onClick={subscribeToPremium}
              disabled={subscriptionState.isPremium || isLoading}
              className={`
                w-full py-4 rounded-xl font-bold text-base transition-all duration-300 relative overflow-hidden group/btn
                ${subscriptionState.isPremium
                  ? "bg-white/5 text-white/40 cursor-not-allowed border border-white/5"
                  : isLoading
                    ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white cursor-wait opacity-80"
                    : "bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600 bg-[length:200%_100%] hover:bg-[100%_0] text-white shadow-xl shadow-blue-500/20 hover:shadow-blue-500/40 hover:-translate-y-0.5"
                }
              `}
            >
              <div className="relative z-10 flex items-center justify-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing Transaction...</span>
                  </>
                ) : subscriptionState.isPremium ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>Already Active</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 fill-current" />
                    <span>Subscribe Now</span>
                  </>
                )}
              </div>
            </button>

            {!subscriptionState.isPremium && (
              <div className="mt-4 pt-4 border-t border-white/5 w-full">
                <a
                  href="https://discord.com/invite/sui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-blue-400 transition-colors group/link"
                >
                  Need test tokens? Get from Faucet
                  <ExternalLink className="w-3 h-3 group-hover/link:translate-x-0.5 transition-transform" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trust Badges */}
      <div className="grid grid-cols-3 gap-4 opacity-60">
        <div className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/5">
          <Shield className="w-6 h-6 text-white/80" />
          <span className="text-xs text-white/60 font-medium">Secure Payment</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/5">
          <Zap className="w-6 h-6 text-white/80" />
          <span className="text-xs text-white/60 font-medium">Instant Activation</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/5">
          <Star className="w-6 h-6 text-white/80" />
          <span className="text-xs text-white/60 font-medium">Cancel Anytime</span>
        </div>
      </div>
    </div>
  );
};

export default Subscription;
