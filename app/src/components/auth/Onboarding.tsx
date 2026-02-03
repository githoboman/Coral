// src/components/Onboarding.tsx

import { useState, useEffect, useRef } from "react";
import { Mail, Gift, Check } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useClaimPoints } from "@/hooks/useClaimPoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

interface OnboardingProps {
  isOpen: boolean;
  loading: boolean;
  message: string | null;
  initialEmail?: string | null;
  onSubmit: (
    email: string,
    additionalData?: {
      notifications_enabled?: boolean;
      analytics_enabled?: boolean;
      personalization_enabled?: boolean;
      username?: string;
    },
  ) => Promise<{ success: boolean; data?: any }>;
  onComplete: () => void;
}

export function OnboardingModal({
  isOpen,
  loading,
  message,
  initialEmail,
  onSubmit,
  onComplete,
}: OnboardingProps) {
  // ---------------------------------------------------------------------------
  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
  // ---------------------------------------------------------------------------
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [email, setEmail] = useState(initialEmail || "");
  const [username, setUsername] = useState("");
  const [preferences, setPreferences] = useState({
    notifications: true,
    analytics: false,
    personalization: false,
  });
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isEmailFromOAuth = !!initialEmail;

  // Always call useClaimPoints - don't conditionally call hooks
  const { claimPoints, claimState, reset: resetClaim } = useClaimPoints();

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  // Auto-redirect non-waitlisted users after 2 s on the welcome screen.
  useEffect(() => {
    if (step === 4) {
      const timer = setTimeout(() => onComplete(), 2000);
      return () => clearTimeout(timer);
    }
  }, [step, onComplete]);

  useGSAP(() => {
    if (isOpen && modalRef.current) {
      gsap.fromTo(
        modalRef.current,
        { opacity: 0, scale: 0.9, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: "power3.out" },
      );
    }
  }, [isOpen]);

  useGSAP(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, x: step === 1 ? -20 : 20 },
        { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, [step]);

  // ---------------------------------------------------------------------------
  // Early return AFTER all hooks have been called
  // ---------------------------------------------------------------------------
  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleEmailNext = () => {
    if (email.trim()) setStep(2);
  };

  const handleFinalSubmit = async () => {
    try {
      const result = await onSubmit(email.trim(), {
        notifications_enabled: preferences.notifications,
        analytics_enabled: preferences.analytics,
        personalization_enabled: preferences.personalization,
        username: username.trim() || undefined,
      });

      if (result?.success) {
        setProfileSaved(true);

        // Lightweight waitlist check — read-only, no ticket minted.
        try {
          const res = await fetch(
            `${API_BASE}/api/auth/check-waitlist?email=${encodeURIComponent(email.trim())}`,
          );
          const data = await res.json();

          if (data.on_waitlist) {
            setIsWaitlisted(true);
            setStep(3); // → claim screen (waitlisted users only)
          } else {
            setIsWaitlisted(false);
            setStep(4); // → welcome screen, then auto-redirect
          }
        } catch {
          // If the check itself fails, don't block the user.
          // Send them to welcome and let them continue.
          setIsWaitlisted(false);
          setStep(4);
        }
      }
    } catch (error) {
      console.error("Failed to save profile:", error);
    }
  };

  // ---------------------------------------------------------------------------
  // Reusable Switch Component
  // ---------------------------------------------------------------------------
  const Switch = ({
    active,
    onChange,
  }: {
    active: boolean;
    onChange: (val: boolean) => void;
  }) => (
    <button
      onClick={() => onChange(!active)}
      className={`w-12 h-6 rounded-full transition-all duration-300 relative cursor-pointer ${active ? "bg-[#B7FC0D]" : "bg-white/10"}`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${active ? "left-7 bg-[#070B0F]" : "left-1 bg-white/40"}`}
      />
    </button>
  );

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 bg-black/60 z-[300] backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div
        ref={modalRef}
        className="w-full max-w-[400px] bg-[#070B0F]/95 backdrop-blur-2xl border border-white/5 rounded-[32px] shadow-2xl relative overflow-hidden"
      >
        <div className="p-6" ref={contentRef}>
          {/* ============================================================
              STEP 1 — Email + Username
              ============================================================ */}
          {step === 1 && (
            <div className="flex flex-col items-center">
              {/* Logo */}
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#B7FC0D] to-[#246AFC] p-0.5 mb-6">
                <div className="w-full h-full rounded-full bg-[#070B0F] flex items-center justify-center p-3">
                  <img
                    src="/assets/images/signin-logo.png"
                    alt="Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <h2 className="text-[26px] font-bold text-white mb-2 text-center tracking-tight">
                Complete Your Profile
              </h2>
              <p className="text-white/40 text-sm text-center mb-8 font-medium">
                Enter your email to get started. Waitlisted users can claim 300
                bonus points!
              </p>

              <div className="w-full space-y-5">
                {message && (
                  <div
                    className={`p-4 rounded-2xl text-sm font-medium ${message.includes("success") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}
                  >
                    {message}
                  </div>
                )}

                {/* Email input */}
                <div className="relative group">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#B7FC0D] transition-colors">
                    <Mail size={20} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) =>
                      !isEmailFromOAuth && setEmail(e.target.value)
                    }
                    placeholder="your@email.com"
                    className="w-full pl-14 pr-6 py-3.5 bg-[#15191C] border border-white/5 rounded-full text-white text-base placeholder-white/20 focus:outline-none focus:border-[#B7FC0D]/30 transition-all font-medium"
                    disabled={loading || isEmailFromOAuth}
                    onKeyPress={(e) => e.key === "Enter" && handleEmailNext()}
                  />
                </div>

                {/* Username input */}
                <div className="relative group">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username (optional)"
                    className="w-full px-6 py-3.5 bg-[#15191C] border border-white/5 rounded-full text-white text-base placeholder-white/20 focus:outline-none focus:border-[#B7FC0D]/30 transition-all font-medium"
                    disabled={loading}
                    onKeyPress={(e) => e.key === "Enter" && handleEmailNext()}
                  />
                </div>

                {/* Continue button */}
                <button
                  onClick={handleEmailNext}
                  disabled={loading || !email.trim()}
                  className="w-full py-3.5 bg-white text-black rounded-full font-bold text-base hover:bg-white/90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <>
                      <LoadingSpinner
                        size="sm"
                        className="border-black border-t-transparent"
                      />
                      Processing...
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================
              STEP 2 — Preferences
              ============================================================ */}
          {step === 2 && (
            <div className="flex flex-col">
              <h2 className="text-[24px] font-bold text-white mb-5 tracking-tight">
                Choose your preferences
              </h2>

              <div className="space-y-3 mb-8">
                <div className="flex items-center justify-between p-4 rounded-3xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-base">
                    Receive notifications
                  </span>
                  <Switch
                    active={preferences.notifications}
                    onChange={(v) =>
                      setPreferences((prev) => ({ ...prev, notifications: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-3xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-base">
                    Analytics data sharing
                  </span>
                  <Switch
                    active={preferences.analytics}
                    onChange={(v) =>
                      setPreferences((prev) => ({ ...prev, analytics: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-sm">
                    Personalization
                  </span>
                  <Switch
                    active={preferences.personalization}
                    onChange={(v) =>
                      setPreferences((prev) => ({
                        ...prev,
                        personalization: v,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="px-8 py-3.5 bg-white/5 text-white rounded-full font-bold text-base hover:bg-white/10 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <button
                  onClick={handleFinalSubmit}
                  disabled={loading}
                  className="flex-1 px-10 py-3.5 bg-gradient-to-r from-[#246AFC] to-[#B7FC0D] text-white rounded-full font-bold text-base hover:opacity-90 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? <LoadingSpinner size="sm" /> : "Complete Setup"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================
              STEP 3 — Claim Points (waitlisted users only)
              ============================================================ */}
          {step === 3 && (
            <div className="flex flex-col items-center">
              {/* --------------- SUCCESS STATE --------------- */}
              {claimState.status === "success" ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-6">
                    <Check size={32} className="text-green-400" />
                  </div>
                  <h2 className="text-[24px] font-bold text-white mb-2 text-center">
                    Points Claimed!
                  </h2>
                  <p className="text-white/40 text-sm text-center mb-6">
                    Your points have been recorded on the Sui blockchain.
                  </p>
                  <div className="w-full bg-[#15191C] border border-white/5 rounded-2xl p-5 text-center mb-6">
                    <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
                      Your Balance
                    </p>
                    <p className="text-3xl font-bold text-[#B7FC0D]">
                      {claimState.balance.toLocaleString()}
                    </p>
                    <p className="text-white/30 text-xs mt-1">points</p>
                  </div>
                  <button
                    onClick={onComplete}
                    className="w-full py-4 bg-white text-black rounded-full font-bold text-base hover:bg-white/90 transition-all cursor-pointer"
                  >
                    Continue to Dashboard
                  </button>
                </>
              ) : (
                <>
                  {/* --------------- CLAIM PROMPT --------------- */}
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#B7FC0D]/20 to-[#246AFC]/20 border border-[#B7FC0D]/30 flex items-center justify-center mb-6">
                    <Gift size={28} className="text-[#B7FC0D]" />
                  </div>

                  <h2 className="text-[24px] font-bold text-white mb-2 text-center tracking-tight">
                    Claim Your Points
                  </h2>
                  <p className="text-white/40 text-sm text-center mb-6 leading-relaxed">
                    Your email is on the waitlist! Sign a transaction with your
                    wallet to claim your reward.
                  </p>

                  {/* Points badge */}
                  <div className="w-full bg-[#15191C] border border-[#B7FC0D]/20 rounded-2xl p-5 text-center mb-6">
                    <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">
                      Reward
                    </p>
                    <p className="text-3xl font-bold text-[#B7FC0D]">300</p>
                    <p className="text-white/30 text-xs mt-1">
                      points · stored on Sui
                    </p>
                  </div>

                  {/* Error banner */}
                  {claimState.error && (
                    <div className="w-full p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center mb-4">
                      {claimState.error}
                    </div>
                  )}

                  {/* Status text */}
                  {(claimState.status === "verifying" ||
                    claimState.status === "signing" ||
                    claimState.status === "confirming") && (
                    <p className="text-white/50 text-xs text-center mb-3 animate-pulse">
                      {claimState.status === "verifying" &&
                        "Verifying eligibility…"}
                      {claimState.status === "signing" &&
                        "Check your wallet for the approval prompt…"}
                      {claimState.status === "confirming" &&
                        "Confirming on chain…"}
                    </p>
                  )}

                  {/* Claim button */}
                  <button
                    onClick={() => claimPoints(email)}
                    disabled={
                      claimState.status !== "idle" &&
                      claimState.status !== "error"
                    }
                    className="w-full py-4 bg-gradient-to-r from-[#246AFC] to-[#B7FC0D] text-white rounded-full font-bold text-base hover:opacity-90 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {claimState.status === "verifying" ||
                    claimState.status === "signing" ||
                    claimState.status === "confirming" ? (
                      <>
                        <LoadingSpinner size="sm" />
                        {claimState.status === "verifying" && "Verifying…"}
                        {claimState.status === "signing" &&
                          "Awaiting signature…"}
                        {claimState.status === "confirming" && "Confirming…"}
                      </>
                    ) : (
                      "Claim 300 Points"
                    )}
                  </button>

                  {/* Skip link for users who don't want to claim right now */}
                  {claimState.status === "idle" && (
                    <button
                      onClick={onComplete}
                      className="mt-4 text-white/30 hover:text-white/60 text-xs cursor-pointer transition-colors"
                    >
                      Skip for now
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ============================================================
              STEP 4 — Welcome (non-waitlisted users)
              Auto-redirects to dashboard after 2 seconds.
              ============================================================ */}
          {step === 4 && (
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#B7FC0D]/20 to-[#246AFC]/20 border border-[#B7FC0D]/30 flex items-center justify-center mb-6">
                <Check size={32} className="text-[#B7FC0D]" />
              </div>

              <h2 className="text-[26px] font-bold text-white mb-2 text-center tracking-tight">
                Welcome to Tovira!
              </h2>
              <p className="text-white/40 text-sm text-center mb-8 leading-relaxed">
                Your account is all set. Let's get started.
              </p>

              <button
                onClick={onComplete}
                className="w-full py-4 bg-white text-black rounded-full font-bold text-base hover:bg-white/90 transition-all cursor-pointer"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer note */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-[400px] text-center text-[10px] text-white/30 font-medium leading-normal px-4 opacity-0 animate-fade-in"
        style={{ animationDelay: "0.5s", animationFillMode: "forwards" }}
      >
        {step < 3
          ? "Your email will be checked against our waitlist. Waitlisted users can claim 300 points!"
          : step === 3
            ? "Points are stored on the Sui blockchain. Your email is kept off-chain."
            : "You're all set. Enjoy Tovira!"}
      </div>
    </div>
  );
}
