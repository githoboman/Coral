import { Wallet, Menu, Clock, Plus } from 'lucide-react';

interface MobileTopBarProps {
  balance: string;
  isConnected: boolean;
  onWalletClick?: () => void;
  onConnectClick?: () => void;
  onMenuClick?: () => void;
  onRecentChatsClick?: () => void;
  onNewChatClick?: () => void;
  showChatActions?: boolean;
  customAction?: React.ReactNode;
}

export function MobileTopBar({
  balance,
  isConnected,
  onWalletClick,
  onConnectClick,
  onMenuClick,
  onRecentChatsClick,
  onNewChatClick,
  showChatActions,
  customAction
}: MobileTopBarProps) {
  return (
    <div className={`fixed w-full top-0 md:hidden px-4 py-4 flex items-center justify-between z-50 pointer-events-none`}>
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="pointer-events-auto p-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md cursor-pointer"
          >
            <Menu size={20} className="text-white" />
          </button>
        )}

        {showChatActions && (
          <div className="flex items-center gap-2">
            <button
              onClick={onRecentChatsClick}
              className="pointer-events-auto p-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md cursor-pointer"
              title="Recent Chats"
            >
              <Clock size={18} className="text-white/70" />
            </button>
            <button
              onClick={onNewChatClick}
              className="pointer-events-auto p-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md cursor-pointer"
              title="New Chat"
            >
              <Plus size={18} className="text-white/70" />
            </button>
            {customAction}
          </div>
        )}
      </div>

      {isConnected ? (
        onWalletClick && (
          <button
            onClick={onWalletClick}
            className="pointer-events-auto flex items-center gap-2 px-3 py-3 bg-white/5 border border-white/10 rounded-full active:scale-95 transition-transform backdrop-blur-md"
          >
            <Wallet size={16} className="text-[#00FF88]" />
            <span className="text-sm font-medium text-white">${balance}</span>
          </button>
        )
      ) : (
        onConnectClick && (
          <button
            onClick={onConnectClick}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-[#B7FC0D] border border-[#B7FC0D] rounded-full active:scale-95 transition-transform shadow-lg"
          >
            <Wallet size={16} className="text-black" />
            <span className="text-sm font-bold text-black text-black">Connect</span>
          </button>
        )
      )}
    </div>
  );
}
