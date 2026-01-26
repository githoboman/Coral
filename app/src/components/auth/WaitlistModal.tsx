import React, { useState } from 'react';
import { X, Mail, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface WaitlistModalProps {
  isOpen: boolean;
  loading: boolean;
  message: string | null;
  initialEmail?: string | null;
  onSubmit: (email: string) => void;
  onClearMessage: () => void;
}

export function WaitlistModal({ isOpen, loading, message, initialEmail, onSubmit, onClearMessage }: WaitlistModalProps) {
  const [email, setEmail] = useState(initialEmail || '');

  // Update email state when initialEmail changes
  React.useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (email.trim()) {
      onSubmit(email.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && email.trim()) {
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 bg-[#161010] z-[300] backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-[#0C1419]/45 backdrop-blur-xl border border-white/10 rounded-[20px] shadow-2xl animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
        <div className="p-6 space-y-4">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center gap-3 mb-4">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500/20 to-red-500/20 backdrop-blur-md rounded-xl flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-orange-400" />
              </div>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-white to-[#00FF88] bg-clip-text text-transparent mb-2">
              Join Our Waitlist
            </h2>
            <p className="text-white/60 text-sm leading-relaxed max-w-sm mx-auto">
              Your email isn't on our waitlist yet. Join now to get early access!
            </p>
          </div>

          {message && (
            <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${message.includes('successfully') || message.includes('added')
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
              }`}>
              <span className="flex-1">{message}</span>
              <button
                type="button"
                onClick={onClearMessage}
                className="text-current opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div>
            <div className="w-full text-white/70 px-4 py-2.5 bg-[#191919] border border-[#4E4E4E] rounded-full relative flex items-center gap-2">
              <Mail className="mt-1.5" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="your@email.com"
                required
                disabled={loading}
                className="text-lg focus:outline-none focus:ring-0 focus:border-transparent disabled:bg-white/10 disabled:text-white/50"
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !email.trim()}
            className={`mt-10 cursor-pointer w-full group relative overflow-hidden border border-[#4E4E4E] rounded-full py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${loading
              ? 'bg-white/10 cursor-not-allowed opacity-50'
              : 'bg-[#191919] shadow-lg hover:shadow-xl hover:-translate-y-0.5'
              } text-white disabled:cursor-not-allowed`}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                <span className="text-sm">Joining Waitlist...</span>
              </div>
            ) : (
              <p>Join Waitlist</p>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
