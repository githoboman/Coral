import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'react-toastify';
import { Mail, Lock, Eye, EyeOff, ChevronRight } from 'lucide-react';

interface EmailLoginFormProps {
  onSuccess: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  isSignUp: boolean;
}

export const EmailLoginForm: React.FC<EmailLoginFormProps> = ({
  onSuccess,
  loading,
  setLoading,
  isSignUp,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignUp && password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        toast.success('Check your email for the confirmation link!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onSuccess();
      }
    } catch (error: any) {
      toast.error(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Email Input */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-white/30 group-focus-within:text-[#00FF88] transition-colors" />
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email here"
            required
            className="w-full bg-[#ffffff]/10 border border-white/20 rounded-[40px] pl-12 pr-3 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:ring-0  focus:border-[#00FF88]/10 transition-all font-medium"
          />
        </div>

        {/* Password Input */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-white/30 group-focus-within:text-[#00FF88] transition-colors" />
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password here"
            required
            className="w-full bg-[#ffffff]/10 border border-white/20 rounded-[40px] pl-12 pr-3 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:ring-0  focus:border-[#00FF88]/10 transition-all font-medium"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/30 hover:text-white transition-colors cursor-pointer"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        {/* Confirm Password Input (Signup only) */}
        {isSignUp && (
          <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Lock className="h-5 w-5 text-white/30 group-focus-within:text-[#00FF88] transition-colors" />
            </div>
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Enter your password again"
              required
              className="w-full bg-[#ffffff]/10 border border-white/20 rounded-[40px] pl-12 pr-3 py-2.5 text-white placeholder:text-white/20 focus:outline-none focus:ring-0  focus:border-[#00FF88]/10 transition-all font-medium"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/30 hover:text-white transition-colors cursor-pointer"
            >
              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full relative group overflow-hidden bg-gradient-to-r from-[#2B87D1] to-[#82E131] rounded-full py-2 px-6 font-bold text-white transition-all duration-300 hover:shadow-xl hover:shadow-[#00FF88]/20 active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 mt-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-medium">{loading ? 'Processing...' : isSignUp ? 'Sign up' : 'Sign in'}</span>
            {!loading && <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />}
          </div>
        </button>
      </form>
    </div>
  );
};
