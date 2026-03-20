import { useEffect, useState } from "react";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { useCheckin } from "@/hooks/useCheckIn";
import { useProfile } from "@/hooks/useProfile";

import { AccountSkeleton } from "@/components/ui/SkeletonLoader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import {
  Flame,
  Wallet,
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
} from "lucide-react";
import { useTelegramLinking } from "@/hooks/useTelegramLinking";
import { TelegramIcon, GoogleIcon } from "@/components/ui/BrandIcons";
import { Tooltip } from "@/components/ui/Tooltip";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

function PhantomIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="32" fill="#AB9FF2" />
      <path
        d="M110.584 64.956c0 25.503-20.654 46.177-46.131 46.177-25.478 0-46.132-20.674-46.132-46.177S38.975 18.779 64.453 18.779c25.477 0 46.131 20.674 46.131 46.177z"
        fill="#fff"
      />
      <path
        d="M93.31 64.956c0 6.18-2.149 11.854-5.703 16.31H40.39a29.133 29.133 0 01-5.703-16.31c0-16.122 13.062-29.2 29.184-29.2 16.122 0 29.44 13.078 29.44 29.2z"
        fill="#AB9FF2"
      />
      <ellipse cx="52.004" cy="63.388" rx="5.427" ry="8.648" fill="#fff" />
      <ellipse cx="76.902" cy="63.388" rx="5.427" ry="8.648" fill="#fff" />
      <ellipse cx="52.004" cy="64.2" rx="2.713" ry="4.324" fill="#3D3D3D" />
      <ellipse cx="76.902" cy="64.2" rx="2.713" ry="4.324" fill="#3D3D3D" />
    </svg>
  );
}

function MetaMaskIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="32" fill="#F6851B" />
      <path
        d="M103 25L67.5 51.5l6.4-15.2L103 25z"
        fill="#E2761B"
        stroke="#E2761B"
        strokeWidth="0.5"
      />
      <path
        d="M25 25l35.1 26.8-6.1-15.5L25 25z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M89.7 80.4l-9.4 14.4 20.1 5.5 5.8-19.6-16.5-.3zM21.9 80.7l5.7 19.6 20.1-5.5-9.4-14.4-16.4.3z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M46.4 57.6l-5.6 8.5 20 .9-.7-21.5-13.7 12.1zM81.6 57.6L67.7 45.3l-.4 21.7 19.9-.9-5.6-8.5z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M47.7 94.8l12-5.8-10.4-8.1-1.6 13.9zM68.3 89l12 5.8-1.7-13.9-10.3 8.1z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TelegramModal (unchanged from original)
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
                navigator.clipboard.writeText("@ToviraBot");
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
// TelegramConnect (unchanged from original)
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
      setConnectData({ ...data, botUsername: "ToviraBot" });
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

const PhantomConnect = () => {
  const { publicKey, connected, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 5)}...${publicKey.toBase58().slice(-4)}`
    : null;

  return (
    <div className="flex justify-between items-center gap-4">
      <div className="flex items-center gap-3">
        <PhantomIcon size={28} />
        <div className="flex flex-col">
          <span className="text-white/80 text-sm sm:text-base">Phantom</span>
          {connected && shortAddress ? (
            <span className="text-white/40 text-xs flex items-center gap-1">
              <CheckCircle2 size={10} className="text-emerald-400" />
              {shortAddress}
            </span>
          ) : (
            <span className="text-white/30 text-xs">Not connected</span>
          )}
        </div>
      </div>
      {connected ? (
        <button onClick={() => disconnect()} className="btn btn-danger">
          Disconnect
        </button>
      ) : (
        <button
          onClick={() => setVisible(true)}
          disabled={connecting}
          className="btn btn-primary"
        >
          {connecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            "Connect"
          )}
        </button>
      )}
    </div>
  );
};

const MetaMaskConnect = () => {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [noMetaMask, setNoMetaMask] = useState(false);

  const shortAddress = address
    ? `${address.slice(0, 5)}...${address.slice(-4)}`
    : null;

  function handleConnect() {
    if (typeof window !== "undefined" && !(window as any).ethereum) {
      setNoMetaMask(true);
      setTimeout(() => setNoMetaMask(false), 3000);
      return;
    }
    connect({ connector: injected() });
  }

  return (
    <div className="flex justify-between items-center gap-4">
      <div className="flex items-center gap-3">
        <MetaMaskIcon size={28} />
        <div className="flex flex-col">
          <span className="text-white/80 text-sm sm:text-base">MetaMask</span>
          {isConnected && shortAddress ? (
            <span className="text-white/40 text-xs flex items-center gap-1">
              <CheckCircle2 size={10} className="text-emerald-400" />
              {shortAddress}
            </span>
          ) : noMetaMask ? (
            <span className="text-amber-400 text-xs flex items-center gap-1">
              <AlertCircle size={10} />
              MetaMask not found — install the extension
            </span>
          ) : (
            <span className="text-white/30 text-xs">Not connected</span>
          )}
        </div>
      </div>
      {isConnected ? (
        <button onClick={() => disconnect()} className="btn btn-danger">
          Disconnect
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={isPending}
          className="btn btn-primary"
        >
          {isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            "Connect"
          )}
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Account page
// ─────────────────────────────────────────────────────────────────────
const Account = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { checkin, checkinState, refetchStatus } = useCheckin();
  const { profile, updatePreferences, loading } = useProfile();
  const { entries: leaderboard } = useAppSelector((state) => state.leaderboard);

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
        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 flex flex-col min-h-[400px]">
          {/* Sui wallet */}
          <div className="bg-white/5 p-4 sm:p-6 rounded-3xl mb-6 sm:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <Wallet className="text-white/40 shrink-0" />
              <span className="text-white font-medium truncate">
                {currentAccount
                  ? truncateAddress(currentAccount.address)
                  : "No Wallet"}
              </span>
            </div>
            <button
              onClick={() => disconnectWallet()}
              className="text-[#EF4444] font-bold hover:opacity-80 w-full sm:w-auto text-left sm:text-right"
            >
              Disconnect
            </button>
          </div>

          {/* Permissions */}
          <div className="space-y-6 bg-white/5 p-4 sm:p-6 rounded-3xl mb-8">
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
                  className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${permissions[p.key as keyof typeof permissions] ? "bg-[#B7FC0D]" : "bg-white/10"}`}
                >
                  <div
                    className={`absolute top-1 w-3 h-3 rounded-full transition-all ${permissions[p.key as keyof typeof permissions] ? "right-1 bg-black" : "left-1 bg-white/40"}`}
                  />
                </button>
              </div>
            ))}
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
              {/* Google (unchanged) */}
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

              {/* Telegram (unchanged) */}
              <TelegramConnect />

              <div className="h-px bg-white/5" />

              {/* Phantom — Solana */}
              <PhantomConnect />

              <div className="h-px bg-white/5" />

              {/* MetaMask — Ethereum */}
              <MetaMaskConnect />
            </div>

            {/* Bridge hint */}
            <div className="mt-6 bg-[#B7FC0D]/5 border border-[#B7FC0D]/10 rounded-2xl p-3">
              <p className="text-white/40 text-xs leading-relaxed">
                <span className="text-[#B7FC0D] font-bold">Bridge Agent</span> —
                Connect Phantom and MetaMask above to enable cross-chain
                bridging from the Chat page.
              </p>
            </div>
          </div>

          {/* Daily Check-in (unchanged) */}
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
                className={`w-full sm:w-auto px-8 py-2.5 rounded-full font-bold text-sm transition-all whitespace-nowrap ${checkinState.canCheckin || checkinState.status === "error" ? "bg-[#B7FC0D] text-black hover:scale-105 active:scale-95" : "bg-white/5 text-white/20"}`}
              >
                {(() => {
                  if (checkinState.status === "checking")
                    return <Loader2 className="w-4 h-4 animate-spin" />;
                  if (checkinState.status === "requesting")
                    return "Requesting...";
                  if (checkinState.status === "error") return "Retry";
                  if (checkinState.canCheckin) return "Check In";
                  return `Next: ${timeRemaining || (checkinState.hoursRemaining !== null ? `~${checkinState.hoursRemaining}h` : "...")}`;
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
        </div>
      </div>
    </div>
  );
};

export default Account;
