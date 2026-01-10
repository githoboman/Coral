import { Wallet, Menu } from 'lucide-react';

interface MobileTopBarProps {
  balance: string;
  onWalletClick?: () => void;
  onMenuClick?: () => void;
}

export function MobileTopBar({ balance, onWalletClick, onMenuClick }: MobileTopBarProps) {
  return (
    <div className={`fixed w-full top-0 md:hidden px-4 py-4 flex items-center ${onMenuClick ? 'justify-between' : 'justify-end'} z-50 pointer-events-none`}>
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="pointer-events-auto p-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md"
        >
          <Menu size={20} className="text-white" />
        </button>
      )}

      {onWalletClick && (
        <button
          onClick={onWalletClick}
          className="pointer-events-auto flex items-center gap-2 px-3 py-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md"
        >
          <Wallet size={16} className="text-[#00FF88]" />
          <span className="text-sm font-medium text-white">${balance}</span>
        </button>
      )}
    </div>
  );
}
