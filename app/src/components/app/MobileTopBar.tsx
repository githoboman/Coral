import React, { useState, useRef, useEffect } from 'react';
import { Wallet, Menu, Clock, Plus, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
interface MobileTopBarProps {
  balance: string;
  isConnected: boolean;
  onWalletClick?: () => void;
  onConnectClick?: () => void;
  onMenuClick?: () => void;
  onRecentChatsClick?: () => void;
  onNewChatClick?: () => void;
  onTransactionsClick?: () => void;
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
  onTransactionsClick,
  showChatActions,
  customAction
}: MobileTopBarProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsHistoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
            <div className="relative pointer-events-auto" ref={dropdownRef}>
              <button
                onClick={() => setIsHistoryOpen((p) => !p)}
                className={`p-3 border rounded-full active:scale-95 transition-all backdrop-blur-md cursor-pointer ${
                  isHistoryOpen 
                    ? "bg-white/10 border-white/20 text-white" 
                    : "bg-white/5 border-white/10 text-white/70 hover:text-white"
                }`}
                title="History Menu"
              >
                {/* 
                  Using a neutral history icon for the dropdown menu toggle. 
                  When opened, it shows Recents and Transactions. 
                */}
                <Clock size={18} />
              </button>
              <AnimatePresence>
                {isHistoryOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-2 w-48 bg-[#111318] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 py-1"
                  >
                    <button
                      onClick={() => {
                        onRecentChatsClick?.();
                        setIsHistoryOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
                    >
                      <Clock size={16} className="text-white/60" />
                      Recents
                    </button>
                    <button
                      onClick={() => {
                        onTransactionsClick?.();
                        setIsHistoryOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
                    >
                      <History size={16} className="text-white/60" />
                      Transactions
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
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
