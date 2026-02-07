'use client';

import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  fullScreen?: boolean;
  size?: number | 'sm' | 'md' | 'lg';
  text?: string;
}

export function LoadingSpinner({ fullScreen = false, size = 24, text }: LoadingSpinnerProps) {
  const getNumericSize = (s: number | 'sm' | 'md' | 'lg') => {
    if (typeof s === 'number') return s;
    switch (s) {
      case 'sm': return 16;
      case 'md': return 24;
      case 'lg': return 32;
      default: return 24;
    }
  };

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-[#070B0F] flex items-center justify-center z-[9999]">
        <div className="flex flex-col items-center gap-4">
          <div className="splash-loader" />
          {text && <p className="text-white/60 text-sm animate-pulse">{text}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 gap-3">
      <Loader2 size={getNumericSize(size)} className="animate-spin text-white/60" />
      {text && <p className="text-white/60 text-sm font-medium">{text}</p>}
    </div>
  );
}
