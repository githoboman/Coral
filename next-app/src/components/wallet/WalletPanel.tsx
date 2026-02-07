'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Settings as SettingsIcon,
  Wallet,
  Plus,
  X,
  ChevronDown,
  Eye,
  EyeOff,
  RefreshCcw,
  ArrowUp,
  Gamepad2,
} from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useWalletData, Token } from '@/hooks/useWalletData';
import { WalletModals } from './WalletModals';

interface WalletPanelProps {
  address: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onConnectClick: () => void;
  onSignOut: () => void;
}

export function WalletPanel({
  address,
  isOpen,
  onToggle,
  onConnectClick,
  onSignOut,
}: WalletPanelProps) {
  const { tokens, balanceUSD, isLoading } = useWalletData();
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!isOpen);

  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<'Tokens' | 'Collectibles' | 'Activity'>('Tokens');
  const [activeModal, setActiveModal] = useState<'deposit' | 'send' | 'swap' | 'settings' | null>(null);
  const [nfts] = useState<any[]>([]);
  const [activity] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  useGSAP(() => {
    if (isOpen && containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { x: '100%', opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }
      );
    } else if (!isOpen && containerRef.current) {
      gsap.to(containerRef.current, {
        x: '100%',
        opacity: 0,
        duration: 0.4,
        ease: 'expo.in',
        onComplete: () => setShouldRender(false),
      });
    }
  }, [isOpen, shouldRender]);

  // Collapsed state - show floating button
  if (!shouldRender) {
    if (address) {
      return (
        <button
          onClick={onToggle}
          className="fixed top-6 right-6 cursor-pointer z-[100] h-fit px-4 py-2.5 bg-[#070B0F]/80 backdrop-blur-2xl border border-white/10 rounded-full hidden md:flex items-center gap-2 text-white transition-all duration-300 shadow-xl hover:bg-white/5"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <img src="/assets/icons/wallet.svg" className="w-14 h-14" alt="wallet-toggle" />
          </div>
          <span className="text-[15px] font-[400] tracking-tight">${balanceUSD}</span>
        </button>
      );
    }
    return (
      <button
        onClick={onConnectClick}
        className="fixed top-6 right-6 cursor-pointer z-[100] h-fit px-4 py-2.5 bg-[#B7FC0D] border border-[#B7FC0D] rounded-full hidden md:flex items-center gap-2 text-black hover:bg-[#A3E10C] transition-all duration-300 shadow-xl"
      >
        <Wallet size={16} />
        <span className="text-[15px] font-bold tracking-tight">Connect Wallet</span>
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] w-full md:w-fit h-[100dvh] flex flex-col justify-end bg-[#18181B] md:bg-transparent md:backdrop-blur-none md:block md:p-4 md:sticky md:top-0">
        <div
          ref={containerRef}
          className="bg-[#18181B] md:bg-white/5 backdrop-blur-xl border-0 md:border md:border-white/10 rounded-none md:rounded-[30px] w-full md:w-80 h-full flex flex-col items-center relative p-6 mb-0 md:mb-6 overflow-hidden shadow-none md:shadow-none"
        >
          {/* Header */}
          <div className="flex justify-between items-center w-full mb-8">
            <button
              onClick={() => setActiveModal('settings')}
              className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
            >
              <SettingsIcon size={16} className="text-white/60" />
            </button>
            <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-3 py-1.5 rounded-full transition-colors">
              <span className="font-bold text-white text-sm">Main Account</span>
              <ChevronDown size={14} className="text-white/60" />
            </div>
            <button
              onClick={onToggle}
              className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={16} className="text-white/60" />
            </button>
          </div>

          {/* Balance */}
          <div className="flex flex-col items-center justify-center text-center w-full mb-8">
            <div className="flex items-center gap-3">
              <span className="text-[40px] font-bold text-white tracking-tight">
                {isBalanceVisible ? `$${balanceUSD}` : '------'}
              </span>
              <button
                onClick={() => setIsBalanceVisible(!isBalanceVisible)}
                className="text-white/20 hover:text-white/40 transition-colors mt-2 cursor-pointer"
              >
                {isBalanceVisible ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-4 w-full mb-8">
            <button
              onClick={() => setActiveModal('deposit')}
              className="flex items-center gap-2 bg-[#B7FC0D] hover:bg-[#A3E10C] text-black px-5 py-2.5 rounded-full font-bold text-sm transition-all"
            >
              <Plus size={20} />
              <span>Deposit</span>
            </button>
            <button
              onClick={() => setActiveModal('swap')}
              className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RefreshCcw size={18} className="text-white/60" />
            </button>
            <button
              onClick={() => setActiveModal('send')}
              className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
            >
              <ArrowUp size={18} className="text-white/60" />
            </button>
          </div>

          <div className="w-full h-[1px] bg-white/5 mb-6" />

          {/* Tabs and Content */}
          <div className="flex-1 w-full overflow-y-auto pr-2 scrollbar-none">
            <div className="flex bg-white/5 rounded-2xl p-1 mb-6">
              {(['Tokens', 'Collectibles', 'Activity'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 cursor-pointer ${activeTab === tab
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/60'
                    }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tokens Tab */}
            {activeTab === 'Tokens' && (
              <div className="space-y-4">
                {isLoading ? (
                  <div className="text-center py-10 text-white/20 text-xs font-medium">
                    Loading tokens...
                  </div>
                ) : tokens.length > 0 ? (
                  tokens.map((token: Token, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center p-2.5 relative"
                          style={{
                            background: token.icon.startsWith('/')
                              ? 'transparent'
                              : 'linear-gradient(135deg, #00FF88 0%, #0061FF 100%)',
                          }}
                        >
                          {token.icon.startsWith('/') ? (
                            <img
                              src={token.icon}
                              alt={token.symbol}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <span className="text-white font-bold text-xs">{token.icon}</span>
                          )}
                        </div>
                        <div>
                          <div className="text-white font-bold text-sm">{token.symbol}</div>
                          <div className="text-[10px] text-white/40 font-medium">
                            {isBalanceVisible
                              ? `${token.balance.toFixed(4)} ${token.symbol}`
                              : `---- ${token.symbol}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-bold text-sm">
                          {isBalanceVisible ? `$${token.value.toFixed(2)}` : '----'}
                        </div>
                        <div
                          className={`text-[10px] font-bold ${token.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                        >
                          {token.change24h >= 0 ? '+' : ''}
                          {token.change24h.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-white/20 text-xs font-medium">
                    No tokens found
                  </div>
                )}
              </div>
            )}

            {/* Collectibles Tab */}
            {activeTab === 'Collectibles' && (
              <div className="grid grid-cols-2 gap-3">
                {nfts.length > 0 ? (
                  nfts.map((nft: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-white/5 rounded-2xl overflow-hidden aspect-square relative group cursor-pointer"
                    >
                      {nft.image ? (
                        <img
                          src={nft.image}
                          alt={nft.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-white/5">
                          <Gamepad2 className="text-white/20" size={24} />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-black/60 backdrop-blur-sm">
                        <div className="text-[10px] font-bold text-white truncate">{nft.name}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-center py-10 text-white/20 text-xs font-medium">
                    No collectibles found
                  </div>
                )}
              </div>
            )}

            {/* Activity Tab */}
            {activeTab === 'Activity' && (
              <div className="space-y-4">
                {activity.length > 0 ? (
                  activity.map((tx: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center">
                          <ArrowUp
                            size={16}
                            className={`text-white/40 ${tx.effects?.status?.status === 'success'
                                ? 'text-emerald-400'
                                : 'text-red-400'
                              }`}
                          />
                        </div>
                        <div>
                          <div className="text-white font-bold text-xs">Transaction</div>
                          <div className="text-[10px] text-white/40 font-medium">
                            {tx.digest?.slice(0, 10)}...
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-bold text-xs">
                          {tx.effects?.status?.status === 'success' ? 'Success' : 'Failed'}
                        </div>
                        <div className="text-[10px] text-white/40 font-medium">
                          {new Date(Number(tx.timestampMs)).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-white/20 text-xs font-medium">
                    No recent activity
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <WalletModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        address={address}
        tokens={tokens}
        onSignOut={onSignOut}
      />
    </>
  );
}
