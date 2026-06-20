import { useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  Copy,
  Wallet,
  Plus,
  X,
  ChevronRight,
  Eye,
  EyeOff,
  ChevronDown,
  Share2,
  Gamepad2,
  ClipboardPaste,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Check,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

import { Sidebar } from "@/components/app/Sidebar";
import { useAuth } from "@/components/auth/AuthProvider";
import { MobileDashboardSidebar } from "@/components/app/MobileDashboardSidebar";
import { MobileTopBar } from "@/components/app/MobileTopBar";
import { SuiWalletSelector } from "@/components/wallet/SuiWalletSelector";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchClaimablePoints } from "@/store/slices/pointsSlice";
import { sileo } from "sileo";

import { useActivity } from "@/hooks/useActivity";
import { useNFTs } from "@/hooks/useNFTs";
import { useTokens } from "@/hooks/useTokens";
import { LayoutContextType } from "@/types/LayoutTypes";



interface NavItem {
  name: string;
  to: string;
  iconUrl: string;
  active: boolean;
  showDot?: boolean;
  filterWhite?: boolean;
}

const MobileSidebarDrawer = ({
  isOpen,
  onClose,
  navItems,
}: {
  isOpen: boolean;
  onClose: () => void;
  navItems: any[];
}) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  useGSAP(() => {
    if (isOpen && backdropRef.current && containerRef.current) {
      gsap.to(backdropRef.current, {
        opacity: 1,
        duration: 0.3,
        ease: "power2.out",
      });
      gsap.to(containerRef.current, {
        x: 0,
        duration: 0.4,
        ease: "power3.out",
      });
    } else if (!isOpen && backdropRef.current && containerRef.current) {
      gsap.to(backdropRef.current, {
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
      });
      gsap.to(containerRef.current, {
        x: "-100%",
        duration: 0.4,
        ease: "power3.in",
        onComplete: () => setShouldRender(false),
      });
    }
  }, [isOpen, shouldRender]);

  if (!shouldRender) return null;

  return (
    <>
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black/60 z-[70] md:hidden backdrop-blur-sm opacity-0 cursor-pointer"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        className="fixed inset-y-0 left-0 w-auto h-[100dvh] bg-transparent z-[80] p-4 md:hidden overflow-visible -translate-x-full flex items-center"
      >
        <MobileDashboardSidebar navItems={navItems} onClose={onClose} />
      </div>
    </>
  );
};

const WalletManager = ({
  isWalletCollapsed,
  toggleWallet,
  walletBalanceUSD,
  isBalanceVisible,
  setIsBalanceVisible,
  activeWalletModal,
  setActiveWalletModal,
  showConfirmation,
  setShowConfirmation,
  sendAmount,
  setSendAmount,
  selectedSendToken,
  sendRecipient,
  setSendRecipient,
  handlePasteRecipient,
  isSending,
  handleSend,
  signOut,
  tokens,
  activeTab,
  onTabChange,
  nfts,
  isFetchingNfts,
  onRefreshNFTs,
  activity,
  isFetchingActivity,
  onRefreshActivity,
  address,
  setIsWalletSelectorOpen,
  copyToClipboard,
  isAutonomyEnabled,
  toggleAutonomy,
  isUpdatingAutonomy,
  sendSuccess,
  setSendSuccess,
  lastTxDigest,
}: any) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!isWalletCollapsed);

  useEffect(() => {
    if (!isWalletCollapsed) setShouldRender(true);
  }, [isWalletCollapsed]);

  useGSAP(() => {
    if (!isWalletCollapsed && containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { x: "100%", opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: "expo.out" },
      );
    } else if (isWalletCollapsed && containerRef.current) {
      gsap.to(containerRef.current, {
        x: "100%",
        opacity: 0,
        duration: 0.4,
        ease: "expo.in",
        onComplete: () => setShouldRender(false),
      });
    }
  }, [isWalletCollapsed, shouldRender]);

  if (!shouldRender) {
    if (address) {
      return (
        <button
          onClick={toggleWallet}
          className="fixed top-6 right-6 cursor-pointer z-[100] h-fit px-4 py-2.5 bg-[#070B0F]/80 backdrop-blur-2xl border border-white/10 rounded-full hidden md:flex items-center gap-2 text-white transition-all duration-300 shadow-xl"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <img
              src="/assets/icons/wallet.svg"
              className="w-14 h-14"
              alt="wallet-toggle"
            />
          </div>
          <span className="text-[15px] font-[400] tracking-tight">
            ${walletBalanceUSD}
          </span>
        </button>
      );
    }
    return (
      <button
        onClick={() => setIsWalletSelectorOpen(true)}
        className="fixed top-6 right-6 cursor-pointer z-[100] h-fit px-4 py-2.5 bg-[#B7FC0D] border border-[#B7FC0D] rounded-full hidden md:flex items-center gap-2 text-black hover:bg-[#A3E10C] transition-all duration-300 shadow-xl"
      >
        <Wallet size={16} />
        <span className="text-[15px] font-bold tracking-tight">
          Connect Wallet
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] w-full md:w-fit h-[100dvh] flex flex-col justify-end bg-[#18181B] md:bg-transparent md:backdrop-blur-none md:block md:p-4 md:sticky md:top-0">
      <div
        ref={containerRef}
        className="bg-[#18181B] md:bg-white/5 backdrop-blur-xl border-0 md:border md:border-white/10 rounded-none md:rounded-[30px] w-full md:w-80 h-full flex flex-col items-center relative p-6 mb-0 md:mb-6 overflow-hidden shadow-none md:shadow-none"
      >
        <div className="flex justify-between items-center w-full mb-8">
          <div className="flex items-center gap-2 bg-[#B7FC0D]/10 px-3 py-1.5 rounded-full border border-[#B7FC0D]/20">
            <div className="w-2 h-2 rounded-full bg-[#B7FC0D] animate-pulse" />
            <span className="font-bold text-[#B7FC0D] text-xs uppercase tracking-wide">
              Testnet
            </span>
          </div>
          <button onClick={toggleWallet} className="btn btn-icon btn-ghost">
            <X size={16} className="text-white/60" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center text-center w-full mb-8">
          <div className="flex items-center gap-3">
            <span className="text-[40px] font-bold text-white tracking-tight">
              {isBalanceVisible ? `$${walletBalanceUSD}` : "••••••"}
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
            onClick={() => setActiveWalletModal("deposit")}
            className="btn btn-primary gap-2"
          >
            <Plus size={20} />
            <span className="text-sm font-bold">Deposit</span>
          </button>
          <button
            onClick={() => setActiveWalletModal("send")}
            className="btn btn-icon btn-outline"
          >
            <ArrowUp size={18} className="text-white/60" />
          </button>
        </div>

        <div className="w-full h-[1px] bg-white/5 mb-6" />

        <div className="flex-1 w-full overflow-y-auto pr-2 scrollbar-none">
          <div className="flex bg-white/5 rounded-2xl p-1 mb-6">
            {["Tokens", "Collectibles", "Activity"].map((tab) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab as any)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${activeTab === tab ? "bg-white/10 text-white cursor-pointer" : "text-white/40 hover:text-white/60 cursor-pointer"}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "Tokens" && (
            <div className="space-y-4">
              {tokens.length > 0 ? (
                tokens.map((token: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center p-2.5 relative"
                        style={{
                          background: token.icon.startsWith("/")
                            ? "transparent"
                            : "linear-gradient(135deg, #00FF88 0%, #0061FF 100%)",
                        }}
                      >
                        {token.icon.startsWith("/") ? (
                          <img
                            src={token.icon}
                            alt={token.symbol}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-white font-bold text-xs">
                            {token.icon}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-white font-bold text-sm">
                          {token.symbol}
                        </div>
                        <div className="text-[10px] text-white/40 font-medium">
                          {isBalanceVisible
                            ? `${token.balance.toFixed(4)} ${token.symbol}`
                            : `•••• ${token.symbol}`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-bold text-sm">
                        {isBalanceVisible
                          ? `$${(token.balance * token.price).toFixed(2)}`
                          : "••••"}
                      </div>
                      <div
                        className={`text-[10px] font-bold ${token.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {token.change24h >= 0 ? "+" : ""}
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

          {activeTab === "Collectibles" && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-end pr-1">
                <button
                  onClick={onRefreshNFTs}
                  disabled={isFetchingNfts}
                  className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <RefreshCw
                    size={12}
                    className={`text-white/40 ${isFetchingNfts ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
              <div
                className={`grid grid-cols-2 gap-3 pb-6 ${isFetchingNfts ? "opacity-50" : ""}`}
              >
                {isFetchingNfts && nfts.length === 0 ? (
                  /* Skeleton for NFTs */
                  [...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="bg-white/5 rounded-2xl aspect-square animate-pulse"
                    />
                  ))
                ) : nfts.length > 0 ? (
                  nfts.map((nft: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-white/5 rounded-2xl overflow-hidden aspect-square relative group cursor-pointer border border-white/5 hover:border-white/20 transition-all"
                    >
                      {nft.image ? (
                        <img
                          src={nft.image}
                          alt={nft.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-white/5">
                          <Gamepad2 className="text-white/20" size={24} />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-black/60 backdrop-blur-md translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                        <div className="text-[10px] font-bold text-white truncate">
                          {nft.name}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-center py-10 text-white/20 text-xs font-medium">
                    No collectibles found
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "Activity" && (
            <div className="space-y-4">
              {/* Refresh button — right-aligned, no header text */}
              <div className="flex justify-end">
                <button
                  onClick={onRefreshActivity}
                  disabled={isFetchingActivity}
                  className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <RefreshCw
                    size={12}
                    className={`text-white/40 ${isFetchingActivity ? "animate-spin" : ""}`}
                  />
                </button>
              </div>

              {isFetchingActivity && activity.length === 0 ? (
                /* Skeleton — matches the exact row shape below */
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
                        <div className="space-y-1.5">
                          <div className="w-20 h-2.5 rounded-full bg-white/5 animate-pulse" />
                          <div className="w-14 h-2 rounded-full bg-white/5 animate-pulse" />
                        </div>
                      </div>
                      <div className="space-y-1.5 flex flex-col items-end">
                        <div className="w-16 h-2.5 rounded-full bg-white/5 animate-pulse" />
                        <div className="w-10 h-2 rounded-full bg-white/5 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activity.length > 0 ? (
                activity.map((tx: any, idx: number) => {
                  const { txType, netSUI } = tx;
                  const absAmount = Math.abs(netSUI ?? 0);
                  const hasAmount = absAmount > 0.000001;

                  const iconEl =
                    txType === "received" ? (
                      <ArrowDown size={16} className="text-emerald-400" />
                    ) : txType === "failed" ? (
                      <ArrowUp size={16} className="text-red-400" />
                    ) : txType === "sent" ? (
                      <ArrowUp size={16} className="text-white/60" />
                    ) : (
                      <ArrowUp size={16} className="text-white/30" />
                    );

                  const amountStr = hasAmount
                    ? txType === "received"
                      ? `+${absAmount.toFixed(4)} SUI`
                      : txType === "failed"
                        ? `-${absAmount.toFixed(4)} SUI`
                        : `${netSUI < 0 ? "-" : "+"}${absAmount.toFixed(4)} SUI`
                    : "—";

                  const amountColor =
                    txType === "received"
                      ? "text-emerald-400"
                      : txType === "failed"
                        ? "text-red-400"
                        : "text-white";

                  const label =
                    txType === "sent"
                      ? "Sent"
                      : txType === "received"
                        ? "Received"
                        : txType === "failed"
                          ? "Failed"
                          : "Transaction";

                  return (
                    <a
                      key={idx}
                      href={`https://suiscan.xyz/testnet/tx/${tx.digest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                          {iconEl}
                        </div>
                        <div>
                          <div className="text-white font-bold text-xs">
                            {label}
                          </div>
                          <div className="text-[10px] text-white/40 font-medium">
                            {tx.digest.slice(0, 10)}...
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-bold ${amountColor}`}>
                          {amountStr}
                        </div>
                        <div className="text-[10px] text-white/40 font-medium">
                          {tx.timestampMs
                            ? new Date(
                                Number(tx.timestampMs),
                              ).toLocaleDateString()
                            : "—"}
                        </div>
                      </div>
                    </a>
                  );
                })
              ) : (
                <div className="text-center py-10 text-white/20 text-xs font-medium">
                  No recent activity
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Overlays (Send/Swap/Deposit/Settings) */}
        <WalletModalOverlay
          activeWalletModal={activeWalletModal}
          setActiveWalletModal={setActiveWalletModal}
          showConfirmation={showConfirmation}
          setShowConfirmation={setShowConfirmation}
          {...{
            sendAmount,
            setSendAmount,
            selectedSendToken,
            sendRecipient,
            setSendRecipient,
            handlePasteRecipient,
            isSending,
            handleSend,
            signOut,
            address,
            copyToClipboard,
            isAutonomyEnabled,
            toggleAutonomy,
            isUpdatingAutonomy,
            sendSuccess,
            setSendSuccess,
            lastTxDigest,
          }}
        />
      </div>
    </div>
  );
};

const WalletModalOverlay = (props: any) => {
  const {
    activeWalletModal,
    setActiveWalletModal,
    showConfirmation,
    setShowConfirmation,
    sendAmount,
    setSendAmount,
    selectedSendToken,
    sendRecipient,
    setSendRecipient,
    handlePasteRecipient,
    address,
    copyToClipboard,
    handleSend,
    isSending,
    sendSuccess,
    setSendSuccess,
    lastTxDigest,
  } = props;
  const overlayRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!!activeWalletModal);

  useGSAP(() => {
    if (activeWalletModal) {
      setShouldRender(true);
      gsap.fromTo(
        overlayRef.current,
        { x: "100%" },
        { x: 0, duration: 0.4, ease: "power3.out" },
      );
    } else {
      gsap.to(overlayRef.current, {
        x: "100%",
        duration: 0.4,
        ease: "power3.in",
        onComplete: () => setShouldRender(false),
      });
    }
  }, [activeWalletModal]);

  if (!shouldRender) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 bg-[#070B0F] z-50 flex flex-col p-6"
    >
      <div className="flex justify-between items-center w-full mb-8">
        <button
          onClick={() => {
            if (showConfirmation) setShowConfirmation(false);
            else {
              setActiveWalletModal(null);
            }
          }}
          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors border border-white/5 cursor-pointer"
        >
          <ChevronRight size={18} className="text-white rotate-180" />
        </button>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none">
        {activeWalletModal === "send" && (
          <div className="space-y-4">
            {sendSuccess ? (
              <div className="flex flex-col items-center justify-center p-6 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-[#B7FC0D]/10 flex items-center justify-center mb-2">
                  <div className="w-12 h-12 rounded-full bg-[#B7FC0D] flex items-center justify-center">
                    <Check size={24} className="text-black" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    Transaction Sent!
                  </h3>
                  <a
                    href={`https://suiscan.xyz/testnet/tx/${lastTxDigest}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#B7FC0D] hover:underline flex items-center justify-center gap-1"
                  >
                    View on SuiScan <Share2 size={10} />
                  </a>
                </div>

                <div className="w-full space-y-3 pt-4">
                  <button
                    onClick={() => {
                      setSendSuccess(false);
                      setActiveWalletModal(null);
                      setSendAmount("");
                      setSendRecipient("");
                    }}
                    className="w-full btn btn-primary py-3 justify-center"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => {
                      setSendSuccess(false);
                      setSendAmount("");
                      setSendRecipient("");
                    }}
                    className="w-full btn btn-ghost py-3 text-white/60 hover:text-white"
                  >
                    Send Another
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-white">
                      You are sending
                    </span>
                    <span className="text-[11px] text-white/40">
                      Balance:{" "}
                      {selectedSendToken?.balance?.toFixed(4) || "0.0000"}
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
                        ≈ $
                        {(
                          Number(sendAmount || 0) *
                          (selectedSendToken?.price || 0)
                        ).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() =>
                          setSendAmount(
                            selectedSendToken?.balance?.toString() || "0",
                          )
                        }
                        className="text-[10px] font-bold text-[#82E131] hover:underline mb-2 cursor-pointer"
                      >
                        MAX
                      </button>
                      <button className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                        <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                          <img
                            src={
                              selectedSendToken?.icon ||
                              "/assets/images/sui-icon.png"
                            }
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <span className="text-xs font-bold text-white">
                          {selectedSendToken?.symbol || "SUI"}
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
                      placeholder="Paste recieving address..."
                      value={sendRecipient}
                      onChange={(e) => setSendRecipient(e.target.value)}
                      className="input input-filled pr-14"
                    />
                    <button
                      onClick={handlePasteRecipient}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/5 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors border border-white/5 cursor-pointer"
                    >
                      <ClipboardPaste size={14} className="text-white/40" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleSend}
                  disabled={isSending || !sendAmount || !sendRecipient}
                  className="w-full btn btn-primary py-4 text-base font-bold justify-center mt-4 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSending ? "Sending..." : "Send Now"}
                </button>
              </>
            )}
          </div>
        )}

        {activeWalletModal === "deposit" && (
          <div className="flex flex-col items-center gap-6 pt-4">
            <div className="p-[1px] bg-gradient-to-r from-[#B7FC0D] to-[#246AFC] rounded-2xl w-full">
              <div className="w-full relative group bg-[#070B0F] rounded-[inherit]">
                <div className="w-full bg-white/[0.03] border border-transparent rounded-[inherit] py-3 flex items-center justify-center px-4">
                  <span className="text-xs font-bold text-white truncate mr-2">
                    {address
                      ? `${address.slice(0, 10)}...${address.slice(-6)}`
                      : "Connecting..."}
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(address || "")}
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
                <span className="text-[13px] font-bold text-white">
                  Share QR code instead
                </span>
                <span className="text-[9px] font-bold text-white/20">
                  Send ONLY sui tokens to this address.{" "}
                  <span className="text-[#82E131] cursor-pointer">
                    Learn more
                  </span>
                </span>
              </div>
              <button
                onClick={() =>
                  sileo.success({
                    title: "Coming Soon",
                    description: "Share functionality is coming soon!",
                  })
                }
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Share2 size={16} className="text-white/40" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentAccount = useCurrentAccount();

  const { signOut } = useAuth();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const address = currentAccount?.address || null;

  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] =
    useState(true);
  const [isWalletCollapsed, setIsWalletCollapsed] = useState(true);
  const [activeWalletModal, setActiveWalletModal] = useState<
    "deposit" | "send" | null
  >(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [lastTxDigest, setLastTxDigest] = useState("");
  const [activeTab, setActiveTab] = useState<
    "Tokens" | "Collectibles" | "Activity"
  >("Tokens");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isWalletSelectorOpen, setIsWalletSelectorOpen] = useState(false);
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isAutonomyEnabled, setIsAutonomyEnabled] = useState(false);
  const [isUpdatingAutonomy, setIsUpdatingAutonomy] = useState(false);
  const [mobileActions, setMobileActions] = useState<{
    onRecentClick?: () => void;
    onNewClick?: () => void;
    onTransactionsClick?: () => void;
    customAction?: React.ReactNode;
  } | null>(null);

  const isDashboard = ![
    "/activity",
    "/account",
    "/subscription",
    "/onchain",
    "/badge",
  ].some((path) => location.pathname.startsWith(path));

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);



  const toggleAutonomy = async () => {
    if (!address || isUpdatingAutonomy) return;
    setIsUpdatingAutonomy(true);
    const newValue = !isAutonomyEnabled;

    try {
      const baseUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      await fetch(`${baseUrl}/api/users/update-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: address,
          preferences: { agent_autonomy_enabled: newValue },
        }),
      });
      setIsAutonomyEnabled(newValue);
      sileo.success({
        title: "Autonomy Updated",
        description: newValue
          ? "Agent Autonomy Enabled"
          : "Agent Autonomy Disabled",
      });
    } catch (e) {
      sileo.error({
        title: "Update Failed",
        description: "Failed to update autonomy settings",
      });
    } finally {
      setIsUpdatingAutonomy(false);
    }
  };

  const { walletBalanceUSD, tokens, fetchBalance } = useTokens(address);

  const { nfts, isFetching: isFetchingNfts, refetch: fetchNFTs } = useNFTs(address);
  const { activity, isFetchingActivity, fetchActivity, fetchActivityIfNeeded, clearActivity } = useActivity(address);
  
  const dispatch = useAppDispatch();
  const claimable = useAppSelector((state) => state.points.claimable);
  const hasUnclaimedPoints = (claimable?.total_activities ?? 0) > 0;

  useEffect(() => {
    if (address) {
      dispatch(fetchClaimablePoints(address));
    }
  }, [address, dispatch]);

  // Re-fetch claimable state when points are claimed (Activity page fires this event)
  useEffect(() => {
    const handlePointsUpdated = () => {
      if (address) dispatch(fetchClaimablePoints(address));
    };
    window.addEventListener("pointsUpdated", handlePointsUpdated);
    return () => window.removeEventListener("pointsUpdated", handlePointsUpdated);
  }, [address, dispatch]);

  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [selectedSendToken, setSelectedSendToken] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (tokens.length > 0 && !selectedSendToken) {
      setSelectedSendToken(tokens[0]);
    }
  }, [tokens, selectedSendToken]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sileo.success({ title: "Copied", description: "Copied to clipboard!" });
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handlePasteRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().startsWith("0x")) {
        setSendRecipient(text.trim());
        sileo.success({ title: "Pasted", description: "Address pasted!" });
      } else {
        sileo.error({ title: "Error", description: "No wallet address found" });
      }
    } catch (err) {
      console.error("Failed to paste:", err);
      sileo.error({ title: "Error", description: "Unable to paste" });
    }
  };

  const toggleWallet = () => {
    setIsWalletCollapsed((prev) => !prev);
  };

  const handleTabChange = useCallback(
    (tab: "Tokens" | "Collectibles" | "Activity") => {
      setActiveTab(tab);
      if (tab === "Activity") {
        fetchActivityIfNeeded();
      }
    },
    [fetchActivityIfNeeded],
  );

  useEffect(() => {
    clearActivity();
  }, [address, clearActivity]);

  const handleSend = async () => {
    if (!address || !sendAmount || !sendRecipient) {
      sileo.error({ title: "Error", description: "Please fill all fields" });
      return;
    }

    setIsSending(true);

    try {
      const amountMIST = Math.floor(parseFloat(sendAmount) * 1_000_000_000);
      const tx = new Transaction();

      const [coin] = tx.splitCoins(tx.gas, [amountMIST]);

      tx.transferObjects([coin], sendRecipient);

      await signAndExecute(
        { transaction: tx },
        {
          onSuccess: (result) => {
            console.log("Transaction digest:", result.digest);
            setLastTxDigest(result.digest);
            setSendSuccess(true);
            fetchBalance();
            fetchActivity();
          },
          onError: (err) => {
            console.error("Transaction failed:", err);
            sileo.error({
              title: "Transaction Failed",
              description: err.message || "Unknown error occurred",
            });
          },
        },
      );
    } catch (e: any) {
      console.error("Send error:", e);
      sileo.error({
        title: "Error",
        description: e.message || "Failed to send transaction",
      });
    } finally {
      setIsSending(false);
    }
  };


  const navItems: NavItem[] = [
    {
      name: "Chats",
      to: "/chat",
      iconUrl: "/assets/icons/edit.svg",
      active:
        location.pathname === "/chat" || location.pathname.startsWith("/chat/"),
    },
    {
      name: "Analysis",
      to: "/onchain",
      iconUrl: "/assets/icons/bar-chart.svg",
      active: location.pathname === "/onchain",
    },
    {
      name: "Tasks",
      to: "/activity",
      iconUrl: "/assets/icons/bell.svg",
      active: location.pathname === "/activity",
      showDot: hasUnclaimedPoints,
    },

    {
      name: "Subscription",
      to: "/subscription",
      iconUrl: "/assets/icons/crown.svg",
      active: location.pathname === "/subscription",
    },
    {
      name: "Leaderboard",
      to: "/leaderboard",
      iconUrl: "/assets/icons/trophy.svg",
      active: location.pathname === "/leaderboard",
    },
    {
      name: "Badge",
      to: "/badge",
      iconUrl: "/assets/icons/badge.png",
      active: location.pathname === "/badge",
      filterWhite: true,
    },
    {
      name: "Agent",
      to: "/agent",
      iconUrl: "/assets/icons/wallet.svg",
      active: location.pathname === "/agent",
      filterWhite: true,
    },
  ];

  return (
    <div className="w-full relative bg-black overflow-hidden">
      <div className="absolute inset-0 bg-[#070B0F] -z-10" />

      <div id="main-scroll-container" className="flex w-full h-dvh overflow-x-hidden overflow-y-auto">
        <div className="fixed top-0 left-10 h-dvh py-2 hidden md:flex z-50">
          <Sidebar
            navItems={navItems}
            isCollapsed={isDesktopSidebarCollapsed}
            onToggle={() =>
              setIsDesktopSidebarCollapsed(!isDesktopSidebarCollapsed)
            }
          />
        </div>

        <div
          className={`h-fit w-full flex-1 transition-all duration-300 ease-out ${
            !isDashboard ? "pb-20" : ""
          } md:pb-0 ${
            isDesktopSidebarCollapsed ? "md:ml-[130px]" : "md:ml-[300px]"
          }`}
        >
          <MobileTopBar
            balance={walletBalanceUSD}
            isConnected={!!address}
            onWalletClick={() => setIsWalletCollapsed(false)}
            onConnectClick={() => navigate("/signin")}
            onMenuClick={() => setIsSidebarOpen(true)}
            onRecentChatsClick={mobileActions?.onRecentClick}
            onNewChatClick={mobileActions?.onNewClick}
            onTransactionsClick={mobileActions?.onTransactionsClick}
            showChatActions={!!mobileActions}
            customAction={mobileActions?.customAction}
          />
          <Outlet
            context={
              {
                toggleWallet: () => setIsWalletCollapsed((prev) => !prev),
                walletBalanceUSD,
                setMobileActions,
                tokens,
              } satisfies LayoutContextType
            }
          />
        </div>

        <MobileSidebarDrawer
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          navItems={navItems}
        />

        <WalletManager
          isWalletCollapsed={isWalletCollapsed}
          toggleWallet={toggleWallet}
          walletBalanceUSD={walletBalanceUSD}
          isBalanceVisible={isBalanceVisible}
          setIsBalanceVisible={setIsBalanceVisible}
          activeWalletModal={activeWalletModal}
          setActiveWalletModal={setActiveWalletModal}
          showConfirmation={showConfirmation}
          setShowConfirmation={setShowConfirmation}
          sendAmount={sendAmount}
          setSendAmount={setSendAmount}
          selectedSendToken={selectedSendToken}
          sendRecipient={sendRecipient}
          setSendRecipient={setSendRecipient}
          handlePasteRecipient={handlePasteRecipient}
          isAutonomyEnabled={isAutonomyEnabled}
          toggleAutonomy={toggleAutonomy}
          isUpdatingAutonomy={isUpdatingAutonomy}
          isSending={isSending}
          handleSend={handleSend}
          signOut={signOut}
          tokens={tokens}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          nfts={nfts}
          isFetchingNfts={isFetchingNfts}
          onRefreshNFTs={fetchNFTs}
          activity={activity}
          isFetchingActivity={isFetchingActivity}
          onRefreshActivity={fetchActivity}
          address={address}
          setIsWalletSelectorOpen={setIsWalletSelectorOpen}
          copyToClipboard={copyToClipboard}
          sendSuccess={sendSuccess}
          setSendSuccess={setSendSuccess}
          lastTxDigest={lastTxDigest}
        />
      </div>

      <SuiWalletSelector
        isOpen={isWalletSelectorOpen}
        onClose={() => setIsWalletSelectorOpen(false)}
        onBackToLogin={() => {
          setIsWalletSelectorOpen(false);
          navigate("/signin");
        }}
      />
    </div>
  );
}
