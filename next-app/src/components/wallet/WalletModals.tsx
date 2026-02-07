'use client';

import { useState, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  ClipboardPaste,
  ArrowUpDown,
  Clock,
  Key,
  ShieldCheck,
  Mail,
  Share2,
} from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { toast } from 'react-toastify';
import { Token } from '@/hooks/useWalletData';

interface WalletModalsProps {
  activeModal: 'deposit' | 'send' | 'swap' | 'settings' | null;
  onClose: () => void;
  address: string | null;
  tokens: Token[];
  onSignOut: () => void;
}

export function WalletModals({
  activeModal,
  onClose,
  address,
  tokens,
  onSignOut,
}: WalletModalsProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!!activeModal);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Send state
  const [sendAmount, setSendAmount] = useState('');
  const [sendRecipient, setSendRecipient] = useState('');
  const [isSending, setIsSending] = useState(false);
  const selectedSendToken = tokens[0] || null;

  // Swap state
  const [swapFromAmount, setSwapFromAmount] = useState('');
  const swapFromToken = tokens[0] || null;
  const swapToToken = tokens[1] || null;
  const swapToAmount = swapFromAmount ? (Number(swapFromAmount) * 1.85).toFixed(2) : '';
  const [isSwapping, setIsSwapping] = useState(false);
  const swapRate = 1.85;

  // Autonomy state
  const [isAutonomyEnabled, setIsAutonomyEnabled] = useState(false);
  const [isUpdatingAutonomy, setIsUpdatingAutonomy] = useState(false);

  useGSAP(() => {
    if (activeModal) {
      setShouldRender(true);
      gsap.fromTo(
        overlayRef.current,
        { x: '100%' },
        { x: 0, duration: 0.4, ease: 'power3.out' }
      );
    } else {
      gsap.to(overlayRef.current, {
        x: '100%',
        duration: 0.4,
        ease: 'power3.in',
        onComplete: () => {
          setShouldRender(false);
          setShowConfirmation(false);
        },
      });
    }
  }, [activeModal]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard!', { theme: 'dark', autoClose: 2000 });
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handlePasteRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().startsWith('0x')) {
        setSendRecipient(text.trim());
        toast.success('Address pasted!', { theme: 'dark', autoClose: 2000 });
      } else {
        toast.error('No wallet address found', { theme: 'dark', autoClose: 2000 });
      }
    } catch (err) {
      console.error('Failed to paste:', err);
      toast.error('Unable to paste', { theme: 'dark', autoClose: 2000 });
    }
  };

  const handleSend = async () => {
    setIsSending(true);
    // TODO: Implement actual send transaction
    setTimeout(() => {
      setIsSending(false);
      setShowConfirmation(false);
      toast.success('Transaction sent!', { theme: 'dark' });
      onClose();
    }, 2000);
  };

  const handleSwap = async () => {
    setIsSwapping(true);
    // TODO: Implement actual swap via Cetus DEX
    setTimeout(() => {
      setIsSwapping(false);
      setShowConfirmation(false);
      toast.success('Swap completed!', { theme: 'dark' });
      onClose();
    }, 2000);
  };

  const toggleAutonomy = async () => {
    if (!address || isUpdatingAutonomy) return;
    setIsUpdatingAutonomy(true);
    const newValue = !isAutonomyEnabled;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      await fetch(`${baseUrl}/api/users/update-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: address,
          preferences: { agent_autonomy_enabled: newValue },
        }),
      });
      setIsAutonomyEnabled(newValue);
      toast.success(newValue ? 'Agent Autonomy Enabled' : 'Agent Autonomy Disabled', {
        theme: 'dark',
      });
    } catch {
      toast.error('Failed to update autonomy settings');
    } finally {
      setIsUpdatingAutonomy(false);
    }
  };

  const handleBack = () => {
    if (showConfirmation) {
      setShowConfirmation(false);
    } else {
      onClose();
    }
  };

  if (!shouldRender) return null;

  const modalTitle =
    activeModal === 'settings'
      ? 'Settings'
      : activeModal
        ? activeModal.charAt(0).toUpperCase() + activeModal.slice(1)
        : '';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 md:absolute md:inset-0 bg-[#070B0F] z-[150] flex flex-col p-6"
    >
      {/* Header */}
      <div className="flex justify-between items-center w-full mb-8">
        <button
          onClick={handleBack}
          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors border border-white/5 cursor-pointer"
        >
          <ChevronRight size={18} className="text-white rotate-180" />
        </button>
        <span className="font-bold text-white text-base">{modalTitle}</span>
        <div className="w-8" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-none">
        {/* Send Modal */}
        {activeModal === 'send' && (
          <div className="space-y-4">
            <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-white">You are sending</span>
                <span className="text-[11px] text-white/40">
                  Balance: {selectedSendToken?.balance?.toFixed(4) || '0.0000'}
                </span>
              </div>
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <input
                    type="text"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder="0"
                    className="text-[32px] font-bold text-white leading-tight bg-transparent focus:outline-none w-full"
                  />
                  <span className="text-sm text-white/20 font-medium">
                    ~ ${(Number(sendAmount || 0) * (selectedSendToken?.price || 0)).toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={() => setSendAmount(selectedSendToken?.balance?.toString() || '0')}
                    className="text-[10px] font-bold text-[#82E131] hover:underline mb-2 cursor-pointer"
                  >
                    MAX
                  </button>
                  <button className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                    <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                      <img
                        src={selectedSendToken?.icon || '/assets/images/sui-icon.png'}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {selectedSendToken?.symbol || 'SUI'}
                    </span>
                    <ChevronDown size={14} className="text-white/40" />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-[1px] bg-gradient-to-r from-[#B7FC0D] to-[#246AFC] rounded-2xl">
              <div className="relative group bg-[#070B0F] rounded-[inherit]">
                <input
                  type="text"
                  placeholder="Paste receiving address..."
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  className="w-full bg-white/[0.03] border border-transparent rounded-[inherit] py-3 px-4 text-white focus:outline-none pr-14"
                />
                <button
                  onClick={handlePasteRecipient}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/5 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors border border-white/5 cursor-pointer"
                >
                  <ClipboardPaste size={14} className="text-white/40" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Swap Modal */}
        {activeModal === 'swap' && (
          <div className="space-y-2">
            <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-5 space-y-4">
              <div className="flex justify-between items-center text-sm font-bold text-white">
                <span>You pay</span>
                <span className="text-[11px] text-white/40">
                  Balance: {swapFromToken?.balance?.toFixed(4) || '0.0000'}
                </span>
              </div>
              <div className="flex justify-between items-end">
                <input
                  type="text"
                  value={swapFromAmount}
                  onChange={(e) => setSwapFromAmount(e.target.value)}
                  placeholder="0"
                  className="text-[32px] font-bold text-white leading-tight bg-transparent focus:outline-none w-2/3"
                />
                <button className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 cursor-pointer">
                  <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                    <img
                      src={swapFromToken?.icon || '/assets/images/sui-icon.png'}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <span className="text-xs font-bold text-white">
                    {swapFromToken?.symbol || 'SUI'}
                  </span>
                  <ChevronDown size={14} className="text-white/40" />
                </button>
              </div>
            </div>

            <div className="flex justify-center -my-2 relative z-10">
              <button className="w-8 h-8 rounded-full bg-[#070B0F] border border-white/10 flex items-center justify-center cursor-pointer">
                <ArrowUpDown className="text-white/40" size={14} />
              </button>
            </div>

            <div className="p-[1px] bg-gradient-to-r from-[#B7FC0D] to-[#246AFC] rounded-3xl">
              <div className="bg-[#070B0F] rounded-[inherit] p-5 space-y-4">
                <div className="flex justify-between items-center text-sm font-bold text-white">
                  <span>You receive</span>
                  <span className="text-[11px] text-white/40">
                    Balance: {swapToToken?.balance?.toFixed(4) || '0.0000'}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[32px] font-bold text-white">{swapToAmount || '0'}</span>
                  <button className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 cursor-pointer">
                    <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                      <img
                        src={swapToToken?.icon || '/assets/images/usdc-icon.png'}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {swapToToken?.symbol || 'USDC'}
                    </span>
                    <ChevronDown size={14} className="text-white/40" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] font-bold text-white/40">
                1 SUI = ${swapRate.toFixed(2)}
              </span>
              <div className="flex items-center gap-1.5">
                <Clock size={10} className="text-white/40" />
                <span className="text-[10px] font-bold text-white/40">Resetting in 30s</span>
              </div>
            </div>
          </div>
        )}

        {/* Deposit Modal */}
        {activeModal === 'deposit' && (
          <div className="flex flex-col items-center gap-6 pt-4">
            <div className="p-[1px] bg-gradient-to-r from-[#B7FC0D] to-[#246AFC] rounded-2xl w-full">
              <div className="w-full relative group bg-[#070B0F] rounded-[inherit]">
                <div className="w-full bg-white/[0.03] border border-transparent rounded-[inherit] py-3 flex items-center justify-center px-4">
                  <span className="text-xs font-bold text-white truncate mr-2">
                    {address ? `${address.slice(0, 10)}...${address.slice(-6)}` : 'Connecting...'}
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(address || '')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/5 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors border border-white/10 cursor-pointer"
                >
                  <Copy size={14} className="text-white/40" />
                </button>
              </div>
            </div>

            <div className="w-48 h-48 bg-white rounded-2xl p-4 flex items-center justify-center shadow-xl">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${address}`}
                alt="Wallet QR"
                className="w-full h-full"
              />
            </div>

            <div className="flex items-center justify-between w-full px-1">
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-white">Share QR code instead</span>
                <span className="text-[9px] font-bold text-white/20">
                  Send ONLY Sui tokens to this address.{' '}
                  <span className="text-[#82E131] cursor-pointer">Learn more</span>
                </span>
              </div>
              <button
                onClick={() => toast.info('Share functionality coming soon!', { theme: 'dark' })}
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Share2 size={16} className="text-white/40" />
              </button>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {activeModal === 'settings' && !showConfirmation && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-[11px] font-bold text-white/20 uppercase px-1">
                Security details
              </h3>
              {[
                { icon: <Key size={18} />, label: 'View SUI private key' },
                { icon: <ShieldCheck size={18} />, label: 'View passkeys' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl cursor-pointer hover:bg-white/10 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-white/40 group-hover:text-white">{item.icon}</div>
                    <span className="text-[15px] font-bold text-white">{item.label}</span>
                  </div>
                  <ChevronRight size={16} className="text-white/20" />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="text-[11px] font-bold text-white/20 uppercase px-1">Agent Settings</h3>
              <div className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl transition-all group">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-xl ${isAutonomyEnabled
                        ? 'bg-[#B7FC0D]/10 text-[#B7FC0D]'
                        : 'bg-white/5 text-white/40'
                      }`}
                  >
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <span className="text-[15px] font-bold text-white block">
                      Full Agent Autonomy
                    </span>
                    <span className="text-[10px] text-white/40">
                      Agent can execute transactions in background
                    </span>
                  </div>
                </div>
                <button
                  onClick={toggleAutonomy}
                  disabled={isUpdatingAutonomy}
                  className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${isAutonomyEnabled ? 'bg-[#B7FC0D]' : 'bg-white/10'
                    }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isAutonomyEnabled ? 'right-1' : 'left-1'
                      }`}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-[11px] font-bold text-white/20 uppercase px-1">
                Connected Accounts
              </h3>
              {[
                {
                  icon: (
                    <img
                      src="/assets/images/signin-logo.png"
                      className="w-4.5 h-4.5 brightness-200"
                    />
                  ),
                  label: 'Google account',
                },
                { icon: <Mail size={18} />, label: 'Email account' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl cursor-pointer hover:bg-white/10 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-white/40 group-hover:text-white">{item.icon}</div>
                    <span className="text-[15px] font-bold text-white">{item.label}</span>
                  </div>
                  <ChevronRight size={16} className="text-white/20" />
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowConfirmation(true)}
              className="w-full h-14 bg-red-500/10 text-red-500 font-bold text-[15px] rounded-3xl cursor-pointer transition-all hover:bg-red-500/20"
            >
              Log out
            </button>
          </div>
        )}

        {activeModal === 'settings' && showConfirmation && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            {/* Confirmation handled in footer */}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      {((activeModal && activeModal !== 'deposit' && activeModal !== 'settings') ||
        (activeModal === 'settings' && showConfirmation)) && (
          <div className="mt-8 space-y-3">
            {!showConfirmation ? (
              <button
                onClick={() => setShowConfirmation(true)}
                className="w-full h-14 bg-[#B7FC0D] text-black font-bold text-[15px] rounded-3xl cursor-pointer transition-all hover:bg-[#A3E10C]"
              >
                {activeModal === 'send' ? 'Send' : activeModal === 'swap' ? 'Swap' : ''}
              </button>
            ) : (
              <div className="flex flex-row gap-3">
                <button
                  onClick={() => {
                    if (activeModal === 'send') handleSend();
                    else if (activeModal === 'swap') handleSwap();
                    else if (activeModal === 'settings') onSignOut();
                  }}
                  disabled={isSending || isSwapping}
                  className="flex-[2] h-14 bg-[#21C25E] text-white font-bold text-[15px] rounded-3xl cursor-pointer transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {activeModal === 'settings'
                    ? 'Confirm logout?'
                    : `Confirm ${activeModal}?`}
                </button>
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="flex-1 h-14 bg-[#FF5252] text-white font-bold text-[15px] rounded-3xl cursor-pointer transition-all active:scale-[0.98]"
                >
                  {activeModal === 'settings' ? 'Go back' : 'Cancel'}
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
