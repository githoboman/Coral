import { Wallet } from 'lucide-react';

interface MobileTopBarProps {
  balance: string;
  onWalletClick: () => void;
}

export function MobileTopBar({ balance, onWalletClick }: MobileTopBarProps) {
  return (
    <div className="sticky top-0 z-40 md:hidden px-4 py-3 bg-[#020202]/80 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <img src="/assets/logo.png" alt="Logo" className="w-8 h-8 rounded-full" />
        <span className="font-bold text-lg text-white">Tovira</span>
      </div>

      <button
        onClick={onWalletClick}
        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform"
      >
        <Wallet size={16} className="text-[#00FF88]" />
        <span className="text-sm font-medium text-white">${balance}</span>
      </button>
    </div>
  );
}
