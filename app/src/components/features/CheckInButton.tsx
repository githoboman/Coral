import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CheckInResult {
  success: boolean;
  message: string;
  points_earned?: number;
  total_points?: number;
  streak_day?: number;
  can_check_in: boolean;
  next_checkin_time?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Auto check-in component that shows modal on success
export function AutoCheckIn() {
  const currentAccount = useCurrentAccount();
  const userId = currentAccount?.address;

  const [showModal, setShowModal] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [hasAttempted, setHasAttempted] = useState(false);

  const performCheckIn = useCallback(async () => {
    if (!userId || hasAttempted) return;

    setHasAttempted(true);

    try {
      // First check status
      const statusResponse = await fetch(`${API_BASE_URL}/api/checkin/status/${userId}`);
      if (!statusResponse.ok) return;

      const status = await statusResponse.json();

      // If already checked in today, don't show anything
      if (status.has_checked_in) {
        return;
      }

      // Perform check-in
      const response = await fetch(`${API_BASE_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
        setShowModal(true);
      }
    } catch (error) {
      console.error('Auto check-in failed:', error);
    }
  }, [userId, hasAttempted]);

  // Auto check-in on mount
  useEffect(() => {
    if (userId && !hasAttempted) {
      // Small delay to let the page load first
      const timer = setTimeout(performCheckIn, 1000);
      return () => clearTimeout(timer);
    }
  }, [userId, hasAttempted, performCheckIn]);

  const closeModal = () => {
    setShowModal(false);
  };

  if (!result) {
    return null;
  }

  const milestones = [5, 10, 15, 20, 25, 30];
  const isMilestone = result.streak_day && milestones.includes(result.streak_day);

  return (
    <AnimatePresence>
      {showModal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a1a] border border-white/10 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="relative p-6 pb-0">
                <button
                  onClick={closeModal}
                  className="btn btn-icon btn-ghost absolute top-4 right-4"
                >
                  <X size={18} className="text-white/60" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 pt-2 text-center">
                {/* Title */}
                <h2 className="text-xl font-bold text-white mb-2">
                  {isMilestone ? 'Milestone Reached!' : 'Daily Check-in Complete!'}
                </h2>

                {/* Streak Badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full mb-4">
                  <span className="text-sm font-medium text-white/80">Day {result.streak_day} Streak</span>
                </div>

                {/* Points Card */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4">
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Points Earned</p>
                  <p className="text-3xl font-bold text-white">
                    +{result.points_earned}
                    <span className="text-green-400 ml-1 text-lg">pts</span>
                  </p>
                  <p className="text-white/40 text-sm mt-2">
                    Total: {result.total_points?.toLocaleString()} points
                  </p>
                </div>

                {/* Next Milestone Hint */}
                {!isMilestone && result.streak_day && (
                  <p className="text-white/50 text-sm mb-4">
                    {result.streak_day < 5
                      ? `${5 - result.streak_day} days to Day 5 bonus`
                      : result.streak_day < 10
                        ? `${10 - result.streak_day} days to Day 10 bonus`
                        : result.streak_day < 30
                          ? `${30 - result.streak_day} days to Day 30 bonus`
                          : 'Keep the streak going!'
                    }
                  </p>
                )}

                {/* Close Button */}
                <button
                  onClick={closeModal}
                  className="btn btn-outline btn-block"
                >
                  Continue
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AutoCheckIn;
