import { Crown } from "lucide-react";
import { motion } from "framer-motion";

interface PremiumBadgeProps {
  variant?: "large" | "small" | "inline";
  daysRemaining?: number | null;
  showExpiry?: boolean;
}

export const PremiumBadge = ({
  variant = "large",
  daysRemaining = null,
  showExpiry = true,
}: PremiumBadgeProps) => {
  if (variant === "small") {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500 to-blue-700 text-white text-xs font-bold shadow-lg"
      >
        <Crown className="w-3 h-3" />
        <span>PRO</span>
      </motion.div>
    );
  }

  if (variant === "inline") {
    return (
      <motion.span
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-700 text-white text-[10px] font-bold"
      >
        <Crown className="w-2.5 h-2.5" />
        PRO
      </motion.span>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 rounded-2xl p-6 relative overflow-hidden"
    >
      {/* Animated background glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-transparent animate-pulse" />

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <Crown className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Premium Member</h3>
            {showExpiry && daysRemaining !== null && (
              <p className="text-white/90 text-sm">
                {daysRemaining > 0
                  ? `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`
                  : "Expires today"}
              </p>
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="text-white/90 text-xs font-medium">Status</div>
          <div className="text-white text-lg font-bold">Active</div>
        </div>
      </div>
    </motion.div>
  );
};
