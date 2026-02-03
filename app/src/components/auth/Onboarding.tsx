import { useState, useEffect, useRef } from 'react';
import { Mail } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface OnboardingProps {
  isOpen: boolean;
  loading: boolean;
  message: string | null;
  initialEmail?: string | null;
  onVerifyWaitlist?: (email: string) => Promise<boolean>; // Optional/Deprecated
  onSubmit: (email: string, additionalData?: {
    notifications_enabled?: boolean;
    analytics_enabled?: boolean;
    personalization_enabled?: boolean;
  }) => void;
}

export function OnboardingModal({ isOpen, loading, message, initialEmail, onVerifyWaitlist, onSubmit }: OnboardingProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(initialEmail || '');
  const [preferences, setPreferences] = useState({
    notifications: true,
    analytics: false,
    personalization: false
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isEmailFromOAuth = !!initialEmail;

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useGSAP(() => {
    if (isOpen) {
      gsap.fromTo(modalRef.current, { opacity: 0, scale: 0.9, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    }
  }, [isOpen]);

  useGSAP(() => {
    if (contentRef.current) {
      gsap.fromTo(contentRef.current, { opacity: 0, x: step === 1 ? -20 : 20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' });
    }
  }, [step]);

  if (!isOpen) return null;

  const handleWaitlistVerify = async () => {
    if (email.trim()) {
      // Direct transition to next step without server verification
      setStep(2);
    }
  };

  const handleFinalSubmit = () => {
    onSubmit(email.trim(), {
      notifications_enabled: preferences.notifications,
      analytics_enabled: preferences.analytics,
      personalization_enabled: preferences.personalization
    });
  };

  const Switch = ({ active, onChange }: { active: boolean, onChange: (val: boolean) => void }) => (
    <button
      onClick={() => onChange(!active)}
      className={`w-12 h-6 rounded-full transition-all duration-300 relative cursor-pointer ${active ? 'bg-[#B7FC0D]' : 'bg-white/10'}`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${active ? 'left-7 bg-[#070B0F]' : 'left-1 bg-white/40'}`} />
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div
        ref={modalRef}
        className="w-full max-w-[400px] bg-[#070B0F]/95 backdrop-blur-2xl border border-white/5 rounded-[32px] shadow-2xl relative overflow-hidden"
      >
        <div className="p-6" ref={contentRef}>
          {step === 1 ? (
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#B7FC0D] to-[#246AFC] p-0.5 mb-6">
                <div className="w-full h-full rounded-full bg-[#070B0F] flex items-center justify-center p-3">
                  <img src="/assets/images/signin-logo.png" alt="Logo" className="w-full h-full object-contain" />
                </div>
              </div>

              <h2 className="text-[26px] font-bold text-white mb-2 text-center tracking-tight">Complete Your Profile</h2>
              <p className="text-white/40 text-sm text-center mb-8 font-medium">Enter your email to continue</p>

              <div className="w-full space-y-5">
                {message && (
                  <div className={`p-4 rounded-2xl text-sm font-medium ${message.includes('successfully') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {message}
                  </div>
                )}

                <div className="relative group">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#B7FC0D] transition-colors">
                    <Mail size={20} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => !isEmailFromOAuth && setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full pl-14 pr-6 py-3.5 bg-[#15191C] border border-white/5 rounded-full text-white text-base placeholder-white/20 focus:outline-none focus:border-[#B7FC0D]/30 transition-all font-medium"
                    disabled={loading || isEmailFromOAuth}
                  />
                </div>

                <button
                  onClick={handleWaitlistVerify}
                  disabled={loading || !email.trim()}
                  className="w-full py-3.5 bg-white text-black rounded-full font-bold text-base hover:bg-white/90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <>
                      <LoadingSpinner size="sm" className="border-black border-t-transparent" />
                      Processing...
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              <h2 className="text-[24px] font-bold text-white mb-5 tracking-tight">Choose what we can do</h2>

              <div className="space-y-3 mb-8">
                <div className="flex items-center justify-between p-4 rounded-3xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-base">Recieve notifications</span>
                  <Switch
                    active={preferences.notifications}
                    onChange={(v) => setPreferences(prev => ({ ...prev, notifications: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-3xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-base">Analytics data sharing</span>
                  <Switch
                    active={preferences.analytics}
                    onChange={(v) => setPreferences(prev => ({ ...prev, analytics: v }))}
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5">
                  <span className="text-white font-bold text-sm">Personalisation</span>
                  <Switch
                    active={preferences.personalization}
                    onChange={(v) => setPreferences(prev => ({ ...prev, personalization: v }))}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleFinalSubmit}
                  disabled={loading}
                  className="w-full sm:w-auto px-10 py-3.5 bg-gradient-to-r from-[#246AFC] to-[#B7FC0D] text-white rounded-full font-bold text-base hover:opacity-90 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? <LoadingSpinner size="sm" /> : 'Continue'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-[400px] text-center text-[10px] text-white/30 font-medium leading-normal px-4 opacity-0 animate-fade-in" style={{ animationDelay: '0.5s', animationFillMode: 'forwards' }}>
        You can help us improve Tovira AI by allowing access to your usage data.{' '}
        <button className="text-[#B7FC0D] hover:underline cursor-pointer">Learn more about data sharing</button>
      </div>
    </div>
  );
}
