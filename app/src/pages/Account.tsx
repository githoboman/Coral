import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useCheckin } from "@/hooks/useCheckIn";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/components/auth/AuthProvider";

import { AccountSkeleton } from "@/components/ui/SkeletonLoader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import { fetchReferralStats, claimReferralPoints } from "@/store/slices/referralSlice";
import {
  Flame,
  User,
  Bell,
  ShieldCheck,
  Zap,
  Loader2,
  X,
  Copy,
  Check,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Info,
  Users,
} from "lucide-react";
import { TbLogout2 } from "react-icons/tb";
import { sileo } from "sileo";
import { useTelegramLinking } from "@/hooks/useTelegramLinking";
import { TelegramIcon, GoogleIcon } from "@/components/ui/BrandIcons";
import { Tooltip } from "@/components/ui/Tooltip";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { WalletPhantom } from '@web3icons/react'
import { WalletMetamask } from '@web3icons/react'


// ─────────────────────────────────────────────────────────────────────
// TelegramModal
// ─────────────────────────────────────────────────────────────────────
const TelegramModal = ({
  isOpen,
  onClose,
  code,
  botUsername,
}: {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  botUsername: string;
}) => {
  if (!isOpen) return null;
  const botLink = `https://t.me/${botUsername}?start=${code}`;
  const [copied, setCopied] = useState(false);
  const [botCopied, setBotCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1A1A1A] border border-white/10 rounded-3xl p-6 w-full max-w-md relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
        <div className="mb-6 flex justify-center">
          <div className="p-4 bg-[#24A1DE]/10 rounded-full">
            <TelegramIcon size={40} className="text-[#24A1DE]" />
          </div>
        </div>
        <h3 className="text-xl font-bold text-white mb-2 text-center">
          Connect Telegram
        </h3>
        <p className="text-white/60 text-sm mb-6 text-center">
          Send the code below to our Telegram bot (
          <Tooltip content={botCopied ? "Copied!" : "Click to copy"} side="top">
            <button
              onClick={() => {
                navigator.clipboard.writeText("@CoralBot");
                setBotCopied(true);
                setTimeout(() => setBotCopied(false), 2000);
              }}
              className="text-[#B7FC0D] font-bold hover:underline cursor-pointer transition-colors"
            >
              @{botUsername}
            </button>
          </Tooltip>
          ) to verify and link your account.
        </p>
        <div
          className="bg-white/5 rounded-xl p-4 mb-6 flex justify-between items-center group cursor-pointer border border-white/5 hover:border-white/20 transition-all"
          onClick={copyCode}
        >
          <span className="text-2xl font-mono font-bold text-[#B7FC0D] tracking-widest">
            {code}
          </span>
          <button className="text-white/40 group-hover:text-white transition-colors">
            {copied ? (
              <Check size={20} className="text-green-500" />
            ) : (
              <Copy size={20} />
            )}
          </button>
        </div>
        <a
          href={botLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary w-full justify-center"
        >
          Open Telegram Bot
        </a>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// LogoutModal (dev branch)
// ─────────────────────────────────────────────────────────────────────
const LogoutModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { signOut } = useAuth();

  if (!isOpen) return null;

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1A1A1A] border border-red-500/20 rounded-3xl p-6 w-full max-w-md relative shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
        <div className="mb-6 flex justify-center">
          <div className="p-4 bg-red-500/10 rounded-full border border-red-500/20">
            <TbLogout2 size={40} className="text-red-500" />
          </div>
        </div>
        <h3 className="text-xl font-bold text-white mb-2 text-center text-red-500">
          Confirm Logout
        </h3>
        <p className="text-white/60 text-sm mb-8 text-center leading-relaxed">
          Are you sure you want to log out?
        </p>
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// TelegramConnect
// ─────────────────────────────────────────────────────────────────────
const TelegramConnect = () => {
  const {
    status,
    connectTelegram,
    disconnectTelegram,
    loading,
    error,
    refetch,
  } = useTelegramLinking();
  const [modalOpen, setModalOpen] = useState(false);
  const [connectData, setConnectData] = useState<{
    code: string;
    botUsername: string;
  } | null>(null);

  const handleConnect = async () => {
    const data = await connectTelegram();
    if (data) {
      setConnectData({ ...data, botUsername: "CoralBot" });
      setModalOpen(true);
    }
  };

  const handleClose = () => {
    setModalOpen(false);
    refetch();
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (modalOpen && !status.is_linked) {
      interval = setInterval(() => refetch(), 3000);
    }
    return () => clearInterval(interval);
  }, [modalOpen, status.is_linked, refetch]);

  useEffect(() => {
    if (status.is_linked && modalOpen) setModalOpen(false);
  }, [status.is_linked, modalOpen]);

  return (
    <>
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <TelegramIcon size={28} className="text-[#24A1DE] shrink-0" />
          <div className="flex flex-col">
            <span className="text-white/80 text-sm sm:text-base">Telegram</span>
            {status.telegram_username && (
              <span className="text-white/40 text-xs">
                @{status.telegram_username}
              </span>
            )}
            {error && <span className="text-red-400 text-xs">{error}</span>}
          </div>
        </div>
        <button
          onClick={status.is_linked ? disconnectTelegram : handleConnect}
          disabled={loading}
          className={status.is_linked ? "btn btn-danger" : "btn btn-primary"}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : status.is_linked ? (
            "Disconnect"
          ) : (
            "Connect"
          )}
        </button>
      </div>
      <TelegramModal
        isOpen={modalOpen}
        onClose={handleClose}
        code={connectData?.code || ""}
        botUsername={connectData?.botUsername || ""}
      />
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────
// ExternalWalletConnect — collapsed row + picker popup
// ─────────────────────────────────────────────────────────────────────
const ExternalWalletConnect = () => {
  const [open, setOpen] = useState(false);

  // Phantom
  const { publicKey, connected: solConnected, disconnect: solDisconnect, connecting: solConnecting } = useWallet();
  const { setVisible } = useWalletModal();
  const shortSolAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 5)}...${publicKey.toBase58().slice(-4)}`
    : null;

  // MetaMask
  const { address: ethAddress, isConnected: ethConnected } = useAccount();
  const { connect: ethConnect, isPending: ethPending } = useConnect();
  const { disconnect: ethDisconnect } = useDisconnect();
  const [noMetaMask, setNoMetaMask] = useState(false);
  const shortEthAddress = ethAddress
    ? `${ethAddress.slice(0, 5)}...${ethAddress.slice(-4)}`
    : null;

  function handleEthConnect() {
    if (typeof window !== "undefined" && !(window as any).ethereum) {
      setNoMetaMask(true);
      setTimeout(() => setNoMetaMask(false), 3000);
      return;
    }
    ethConnect({ connector: injected() });
  }


  return (
    <div className="relative">
      {/* Collapsed trigger row */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-3 group py-1"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full bg-[#1A1A1A] border border-white/10 flex items-center justify-center overflow-hidden -mr-3 relative z-0">
              <WalletMetamask size={22} />
            </div>
            <div className="w-8 h-8 rounded-full bg-[#9a8be6] border border-white/10 flex items-center justify-center overflow-hidden relative z-10">
              <WalletPhantom size={22} variant="mono" className="text-white" />
            </div>
          </div>
          <div className="flex flex-col text-left">
            <span className="text-white font-medium text-base">
              Set up bridge wallets
            </span>
          </div>
        </div>
        <ChevronRight
          size={18}
          className={`text-white/40 group-hover:text-white/80 transition-all duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Picker popup */}
      {open && (
        <div className="mt-3 bg-[#111] border border-white/10 rounded-2xl p-3 flex flex-col gap-2 shadow-xl">
          {/* Phantom row */}
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <WalletPhantom size={24} />
              <div className="flex flex-col">
                <span className="text-white/80 text-sm">Phantom</span>
                {solConnected && shortSolAddress ? (
                  <span className="text-white/40 text-xs flex items-center gap-1">
                    <CheckCircle2 size={10} className="text-emerald-400" />
                    {shortSolAddress}
                  </span>
                ) : (
                  <span className="text-white/30 text-xs">Not connected</span>
                )}
              </div>
            </div>
            {solConnected ? (
              <button onClick={() => solDisconnect()} className="bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] text-xs font-medium py-1.5 px-4 rounded-full transition-colors">
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => setVisible(true)}
                disabled={solConnecting}
                className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-medium py-1.5 px-4 rounded-full transition-colors disabled:opacity-50"
              >
                {solConnecting ? <Loader2 size={10} className="animate-spin" /> : "Connect"}
              </button>
            )}
          </div>

          <div className="h-px bg-white/5 mx-2" />

          {/* MetaMask row */}
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <WalletMetamask size={24} />
              <div className="flex flex-col">
                <span className="text-white/80 text-sm">MetaMask</span>
                {ethConnected && shortEthAddress ? (
                  <span className="text-white/40 text-xs flex items-center gap-1">
                    <CheckCircle2 size={10} className="text-emerald-400" />
                    {shortEthAddress}
                  </span>
                ) : noMetaMask ? (
                  <span className="text-amber-400 text-xs flex items-center gap-1">
                    <AlertCircle size={10} /> Not found — install extension
                  </span>
                ) : (
                  <span className="text-white/30 text-xs">Not connected</span>
                )}
              </div>
            </div>
            {ethConnected ? (
              <button onClick={() => ethDisconnect()} className="bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] text-xs font-medium py-1.5 px-4 rounded-full transition-colors">
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleEthConnect}
                disabled={ethPending}
                className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-medium py-1.5 px-4 rounded-full transition-colors disabled:opacity-50"
              >
                {ethPending ? <Loader2 size={10} className="animate-spin" /> : "Connect"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Account page
// ─────────────────────────────────────────────────────────────────────
const Account = () => {
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const { checkin, checkinState, refetchStatus } = useCheckin();
  const { profile, updatePreferences, loading } = useProfile();
  const { entries: leaderboard } = useAppSelector((state) => state.leaderboard);
  const [showReferralInfo, setShowReferralInfo] = useState(false);

  const [permissions, setPermissions] = useState({
    analytics_enabled: false,
    notifications_enabled: true,
    personalization_enabled: false,
  });

  useEffect(() => {
    if (profile?.preferences) {
      setPermissions((prev) => ({
        ...prev,
        analytics_enabled:
          profile.preferences?.analytics_enabled ?? prev.analytics_enabled,
        notifications_enabled:
          profile.preferences?.notifications_enabled ??
          prev.notifications_enabled,
        personalization_enabled:
          profile.preferences?.personalization_enabled ??
          prev.personalization_enabled,
      }));
    }
  }, [profile?.preferences]);

  useEffect(() => {
    dispatch(fetchLeaderboard({}));
  }, [dispatch]);

  const referralStats = useAppSelector((state) => state.referral.stats);

  useEffect(() => {
    if (currentAccount?.address) {
      dispatch(fetchReferralStats({ walletAddress: currentAccount.address }));
    }
  }, [currentAccount?.address, dispatch]);

  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    const updateTimer = () => {
      if (!checkinState.nextAvailableAt) {
        setTimeRemaining("");
        return;
      }
      const diff = checkinState.nextAvailableAt - Date.now();
      if (diff <= 0) {
        setTimeRemaining("");
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setTimeRemaining(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [checkinState.nextAvailableAt]);

  if (loading) return <AccountSkeleton />;

  const handlePermissionToggle = async (key: string) => {
    const newVal = !permissions[key as keyof typeof permissions];
    const newPermissions = { ...permissions, [key]: newVal };
    setPermissions(newPermissions);
    await updatePreferences(newPermissions);
  };

  const truncateAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "N/A";

  const userEntry = leaderboard.find(
    (e) => e.user_id === currentAccount?.address,
  );
  const username =
    userEntry?.username ||
    profile?.username ||
    (currentAccount?.address
      ? truncateAddress(currentAccount.address)
      : "Guest User");

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Logout Modal (dev) */}
      <LogoutModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 md:mb-12 gap-6">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative group">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#1A1A1A] flex items-center justify-center border-2 border-white/10 shrink-0">
              <User size={32} className="text-white/20 sm:w-10 sm:h-10" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl sm:text-4xl font-medium text-white break-all">
              Hi, <span className="text-[#B7FC0D]">{username}</span>
            </h1>
            <p className="text-white/40 text-xs sm:text-sm">
              Welcome back to your account
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        {/* Left column */}
        <div className="flex flex-col gap-6 sm:gap-8 min-h-[400px]">
          {/* Daily Check-in */}
          <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-[#B7FC0D]/20 rounded-[32px] p-6 sm:p-8 relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#B7FC0D]/5 blur-[60px] rounded-full group-hover:bg-[#B7FC0D]/10 transition-all duration-500" />
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 relative z-10 w-full">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#B7FC0D]/10 rounded-2xl border border-[#B7FC0D]/20 shrink-0">
                  <Flame size={24} className="text-[#B7FC0D]" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">
                    Daily Check-in
                  </h3>
                  <p className="text-white/40 text-xs">
                    {checkinState.currentStreak} day streak
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (checkinState.status === "error") {
                    refetchStatus();
                    return;
                  }
                  checkin();
                }}
                disabled={
                  !checkinState.canCheckin && checkinState.status !== "error"
                }
                className={`w-full sm:w-auto px-8 py-2.5 rounded-full font-bold text-sm transition-all whitespace-nowrap ${
                  checkinState.canCheckin || checkinState.status === "error"
                    ? "bg-[#B7FC0D] text-black hover:scale-105 active:scale-95"
                    : "bg-white/5 text-white/20"
                }`}
              >
                {(() => {
                  if (checkinState.status === "checking")
                    return <Loader2 className="w-4 h-4 animate-spin" />;
                  if (checkinState.status === "requesting")
                    return "Requesting...";
                  if (checkinState.status === "error") return "Retry";
                  if (checkinState.canCheckin) return "Check In";
                  return `Next: ${
                    timeRemaining ||
                    (checkinState.hoursRemaining !== null
                      ? `~${checkinState.hoursRemaining}h`
                      : "...")
                  }`;
                })()}
              </button>
              {checkinState.status === "error" && (
                <div className="absolute -bottom-8 right-0 text-red-400 text-xs font-medium">
                  {checkinState.error || "Connection failed"}
                </div>
              )}
            </div>
            <div className="space-y-3 relative z-10 min-h-[40px]">
              {checkinState.status === "checking" ? (
                <div className="animate-pulse space-y-3 opacity-50">
                  <div className="flex justify-between">
                    <div className="h-3 w-16 bg-white/20 rounded" />
                    <div className="h-3 w-8 bg-white/20 rounded" />
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full w-full" />
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/40">
                    <span>Progress</span>
                    <span className="text-[#B7FC0D]">
                      {checkinState.currentStreak} /{" "}
                      {checkinState.nextMilestone}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-[#B7FC0D] to-[#97D600] transition-all duration-700"
                      style={{
                        width: `${(checkinState.currentStreak / checkinState.nextMilestone) * 100}%`,
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Referral Section */}
          <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-white/10 rounded-[32px] p-6 sm:p-8 relative overflow-hidden">
            <div className="flex items-center justify-between gap-4 mb-6 relative">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10 shrink-0">
                  <Users size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Refer a Friend</h3>
                  <p className="text-white/40 text-xs">Earn 2 points for each successful referral</p>
                </div>
              </div>
              <div className="group relative">
                <button 
                  onClick={() => setShowReferralInfo(!showReferralInfo)}
                  onBlur={() => setTimeout(() => setShowReferralInfo(false), 200)}
                  className="p-2 -m-2 text-white/40 hover:text-white transition-colors outline-none"
                >
                  <Info size={20} />
                </button>
                <div className={`absolute top-full right-0 mt-2 w-64 bg-[#1A1A1A] border border-white/10 rounded-xl p-4 text-xs text-white/80 shadow-xl transition-all z-20 ${showReferralInfo ? 'opacity-100 visible' : 'opacity-0 invisible lg:group-hover:opacity-100 lg:group-hover:visible'}`}>
                  <p className="font-bold mb-1 text-white">How it works:</p>
                  <ul className="list-disc pl-4 space-y-1 text-white/60">
                    <li>Share your link with a friend.</li>
                    <li>They sign up and verify their email.</li>
                    <li>They must complete their <b>First Daily Check-in</b>.</li>
                    <li>Once completed, their status becomes <b>Verified</b>.</li>
                    <li>Click <b>Claim</b> to receive your points!</li>
                  </ul>
                </div>
              </div>
            </div>

            {import.meta.env.VITE_REF === 'true' ? (
              referralStats?.referral_code ? (
                <div className="space-y-6">
                  <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex-1 w-full overflow-hidden">
                      <span className="text-white/40 text-xs mb-1 block">Your Referral Link</span>
                      <span className="text-white font-mono text-sm truncate block">
                        {`${window.location.origin}/?ref=${referralStats.referral_code}`}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/?ref=${referralStats.referral_code}`);
                        sileo.success({ title: "Copied!", description: "Referral link copied to clipboard." });
                      }}
                      className="w-full sm:w-auto px-6 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-4xl text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 shrink-0"
                    >
                      <Copy size={16} /> Copy Link
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-[#B7FC0D]/20 rounded-2xl p-3 text-center">
                      <span className="text-white/40 text-xs block mb-1">Total Earned</span>
                      <span className="text-2xl font-bold text-[#B7FC0D]">{referralStats.points_earned} pts</span>
                    </div>
                    <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-white/10 rounded-2xl p-3 text-center">
                      <span className="text-white/40 text-xs block mb-1">Successful</span>
                      <span className="text-2xl font-bold text-white">{referralStats.successful_referrals}</span>
                    </div>
                  </div>

                  {referralStats.history && referralStats.history.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-white/80 font-medium text-sm mb-3">Referred Users</h4>
                      <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                        {referralStats.history.map((ref) => (
                          <div key={ref.id} className="flex items-center justify-between bg-white/5 border border-white/5 rounded-xl p-3">
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-white text-sm truncate">{ref.email}</span>
                              <span className="text-white/40 text-xs">
                                {ref.status === 'pending' && 'Awaiting first check-in...'}
                                {ref.status === 'claimable' && 'Verified! Ready to claim.'}
                                {ref.status === 'completed' && 'Points claimed'}
                              </span>
                            </div>
                            
                            {ref.status === 'claimable' ? (
                              <button
                                onClick={() => {
                                  dispatch(claimReferralPoints(ref.id)).unwrap()
                                    .then((res) => {
                                      sileo.success({ title: "Success", description: `Claimed ${res.points} points!` });
                                    })
                                    .catch((err) => {
                                      sileo.error({ title: "Error", description: err });
                                    });
                                }}
                                className="px-4 py-1.5 bg-[#B7FC0D] hover:bg-[#97D600] text-black text-xs font-bold rounded-full transition-colors shrink-0 shadow-[0_0_15px_rgba(183,252,13,0.3)] hover:scale-105 active:scale-95"
                              >
                                Claim 2 pts
                              </button>
                            ) : ref.status === 'completed' ? (
                              <div className="px-3 py-1 bg-white/10 text-white/40 text-xs font-medium rounded-full shrink-0">
                                Claimed
                              </div>
                            ) : (
                              <div className="px-3 py-1 bg-white/5 border border-white/10 text-white/40 text-xs font-medium rounded-full shrink-0">
                                Pending
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-white/40 text-sm">
                  Complete your profile setup to generate your referral link.
                </div>
              )
            ) : (
              <div className="text-center py-8 border border-white/10 rounded-2xl bg-white/5 border-dashed mt-4">
                <span className="text-white/40 text-sm font-medium">The referral program is currently being upgraded.<br/>Check back soon.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Connected Accounts card */}
          <div className="bg-[#1A1A1A] border border-white/10 rounded-[32px] p-6 sm:p-8 relative overflow-hidden">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-white/5 rounded-2xl border border-white/10 shrink-0">
                <LinkIcon size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">
                  Connected Accounts
                </h3>
                <p className="text-white/40 text-xs">
                  Manage your linked wallets and accounts
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {/* Google */}
              <div className="flex justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <GoogleIcon size={28} className="shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-white/80 text-sm sm:text-base">
                      Google
                    </span>
                    <span className="text-white/40 text-xs">
                      {profile?.email || "Not connected"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="h-px bg-white/5" />
              <TelegramConnect />
              <div className="h-px bg-white/5" />
              <ExternalWalletConnect />
            </div>

            <div className="mt-8">
              <p className="text-white/80 text-sm leading-relaxed ">
                The Bridge Agent uses your connected wallets for cross-chain transfers in chat.
              </p>
            </div>
          </div>

          {/* Permissions */}
          <div className="space-y-6 bg-[#0A0A0A] border border-white/10 rounded-[32px] sm:rounded-[40px] p-6 sm:p-8">
            <h3 className="text-white/40 text-xs font-bold uppercase tracking-wider">
              Permissions
            </h3>
            {[
              {
                key: "analytics_enabled",
                label: "Analytics data sharing",
                icon: Zap,
              },
              {
                key: "notifications_enabled",
                label: "Receive notifications",
                icon: Bell,
              },
              {
                key: "personalization_enabled",
                label: "Personalization",
                icon: ShieldCheck,
              },
            ].map((p) => (
              <div
                key={p.key}
                className="flex justify-between items-center gap-4"
              >
                <div className="flex items-center gap-3">
                  <p.icon size={18} className="text-white/40 shrink-0" />
                  <span className="text-white/80 text-sm sm:text-base">
                    {p.label}
                  </span>
                </div>
                <button
                  onClick={() => handlePermissionToggle(p.key)}
                  className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${
                    permissions[p.key as keyof typeof permissions]
                      ? "bg-[#B7FC0D]"
                      : "bg-white/10"
                  }`}
                >
                  <div
                    className={`absolute top-1 w-3 h-3 rounded-full transition-all ${
                      permissions[p.key as keyof typeof permissions]
                        ? "right-1 bg-black"
                        : "left-1 bg-white/40"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-2">
            <button
                onClick={() => setIsLogoutModalOpen(true)}
                className="w-min px-4 py-2.5 bg-[#D42424]/10 hover:bg-[#D42424]/20 rounded-2xl flex items-center gap-2 transition-colors group"
              >
                <TbLogout2
                  size={18}
                  className="text-[#D42424] group-hover:scale-110 transition-transform"
                />
                <span className="text-[#D42424] text-sm">Logout</span>
              </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;
