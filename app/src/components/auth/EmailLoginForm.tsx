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
            className="input input-filled pl-12"
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
            className="input input-filled pl-12 pr-12"
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
              className="input input-filled pl-12 pr-12"
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
          className="btn btn-primary btn-block mt-4 py-3"
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-lg font-medium">{loading ? 'Processing...' : isSignUp ? 'Sign up' : 'Sign in'}</span>
            {!loading && <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />}
          </div>
        </button>
      </form>
    </div>
  );
};
