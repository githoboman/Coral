import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { useCheckin } from "@/hooks/useCheckIn";
import { useProfile } from "@/hooks/useProfile";
import { useTelegramLinking } from "@/hooks/useTelegramLinking";
import { AccountSkeleton } from "@/components/ui/SkeletonLoader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import {
  Flame,
  Wallet,
  Send,
  User,
  Bell,
  ShieldCheck,
  Zap
} from "lucide-react";

const Account = () => {
  const currentAccount = useCurrentAccount();
  const dispatch = useAppDispatch();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { checkin, checkinState } = useCheckin();
  const { profile, updatePreferences, loading } = useProfile();
  const { status: tgStatus, connectTelegram, disconnectTelegram, loading: tgLoading } = useTelegramLinking();
  const { entries: leaderboard } = useAppSelector((state) => state.leaderboard);

  const [permissions, setPermissions] = useState({
    analytics_enabled: false,
    notifications_enabled: true,
    personalization_enabled: false
  });

  useEffect(() => {
    if (profile?.preferences) {
      setPermissions(prev => ({
        ...prev,
        analytics_enabled: profile.preferences?.analytics_enabled ?? prev.analytics_enabled,
        notifications_enabled: profile.preferences?.notifications_enabled ?? prev.notifications_enabled,
        personalization_enabled: profile.preferences?.personalization_enabled ?? prev.personalization_enabled,
      }));
    }
  }, [profile?.preferences]);

  useEffect(() => {
    dispatch(fetchLeaderboard(false));
  }, [dispatch]);

  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    const updateTimer = () => {
      if (!checkinState.nextAvailableAt) {
        setTimeRemaining(""); // Clear if no next time
        return;
      }

      const now = Date.now();
      const diff = checkinState.nextAvailableAt - now;

      if (diff <= 0) {
        setTimeRemaining("");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining(
        `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [checkinState.nextAvailableAt]);


  if (loading) {
    return <AccountSkeleton />;
  }

  const handlePermissionToggle = async (key: string) => {
    const newVal = !permissions[key as keyof typeof permissions];
    const newPermissions = { ...permissions, [key]: newVal };
    setPermissions(newPermissions);
    await updatePreferences(newPermissions);
  };


  const truncateAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const userEntry = leaderboard.find(e => e.user_id === currentAccount?.address);
  // Prioritize leaderboard username, then profile username, then address, then Guest
  const username = userEntry?.username || profile?.username || (currentAccount?.address ? truncateAddress(currentAccount.address) : "Guest User");

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 md:mb-12 gap-6">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative group">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#1A1A1A] flex items-center justify-center border-2 border-white/10 shrink-0">
              <User size={32} className="text-white/20 sm:w-10 sm:h-10" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl sm:text-4xl font-medium text-white break-all">Hi, <span className="text-[#B7FC0D]">{username}</span></h1>
            <p className="text-white/40 text-xs sm:text-sm">Welcome back to your account</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 flex flex-col min-h-[400px]">
          <div className="bg-white/5 p-4 sm:p-6 rounded-3xl mb-6 sm:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <Wallet className="text-white/40 shrink-0" />
              <span className="text-white font-medium truncate">{currentAccount ? truncateAddress(currentAccount.address) : "No Wallet"}</span>
            </div>
            <button onClick={() => disconnectWallet()} className="text-[#EF4444] font-bold hover:opacity-80 w-full sm:w-auto text-left sm:text-right">Disconnect</button>
          </div>

          <div className="space-y-6 bg-white/5 p-4 sm:p-6 rounded-3xl mb-8">
            <h3 className="text-white/40 text-xs font-bold uppercase tracking-wider">Permissions</h3>
            {[
              { key: 'analytics_enabled', label: 'Analytics data sharing', icon: Zap },
              { key: 'notifications_enabled', label: 'Receive notifications', icon: Bell },
              { key: 'personalization_enabled', label: 'Personalization', icon: ShieldCheck }
            ].map(p => (
              <div key={p.key} className="flex justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <p.icon size={18} className="text-white/40 shrink-0" />
                  <span className="text-white/80 text-sm sm:text-base">{p.label}</span>
                </div>
                <button
                  onClick={() => handlePermissionToggle(p.key)}
                  className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${permissions[p.key as keyof typeof permissions] ? 'bg-[#B7FC0D]' : 'bg-white/10'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${permissions[p.key as keyof typeof permissions] ? 'right-1 bg-black' : 'left-1 bg-white/40'}`} />
                </button>
              </div>
            ))}
          </div>
          
          {/* <div className="bg-white/5 p-4 sm:p-6 rounded-3xl">
            <h3 className="text-white/40 text-xs font-bold uppercase tracking-wider mb-4">Debug</h3>
            <button
              onClick={() => sileo.success({ title: "Test Toast", description: "This is a test notification with a description." })}
              className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors"
            >
              Test Toast Notification
            </button>
          </div> */}
        </div>

        <div className="flex flex-col gap-6 sm:gap-8">
          <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <div className="p-3 bg-white/5 rounded-xl shrink-0">
                  <Send size={18} className="text-white/40 rotate-12" />
                </div>
                <span className="text-white text-lg font-medium truncate">
                  {tgStatus.is_linked ? `@${tgStatus.telegram_username}` : "Telegram account"}
                </span>
              </div>
              <button
                onClick={() => tgStatus.is_linked ? disconnectTelegram() : connectTelegram()}
                disabled={tgLoading}
                className={`w-full sm:w-auto px-6 py-2 rounded-full font-bold text-sm transition-colors ${tgStatus.is_linked ? 'bg-[#EF4444] text-white' : 'bg-[#326AFD] text-white'} disabled:opacity-50`}
              >
                {tgStatus.is_linked ? "Disconnect" : (tgLoading ? "Connecting..." : "Connect")}
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] border border-[#B7FC0D]/20 rounded-[32px] p-6 sm:p-8 relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#B7FC0D]/5 blur-[60px] rounded-full group-hover:bg-[#B7FC0D]/10 transition-all duration-500" />
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 relative z-10 w-full">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#B7FC0D]/10 rounded-2xl border border-[#B7FC0D]/20 shrink-0">
                  <Flame size={24} className="text-[#B7FC0D]" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Daily Check-in</h3>
                  <p className="text-white/40 text-xs">{checkinState.currentStreak} day streak</p>
                </div>
              </div>
              <button
                onClick={checkin}
                disabled={!checkinState.canCheckin}
                className={`w-full sm:w-auto px-8 py-2.5 rounded-full font-bold text-sm transition-all whitespace-nowrap ${checkinState.canCheckin ? 'bg-[#B7FC0D] text-black hover:scale-105 active:scale-95' : 'bg-white/5 text-white/20'}`}
              >
                {(() => {
                  if (checkinState.status === "signing") return "Signing...";
                  if (checkinState.status === "confirming") return "Confirming...";
                  if (checkinState.status === "requesting") return "Requesting...";

                  if (checkinState.canCheckin) return "Check In";

                  const timeLeft = timeRemaining || (checkinState.hoursRemaining !== null ? `~${checkinState.hoursRemaining}h` : "...");
                  return `Next: ${timeLeft}`;
                })()}
              </button>
            </div>
            <div className="space-y-3 relative z-10">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/40">
                <span>Progress</span>
                <span className="text-[#B7FC0D]">{checkinState.currentStreak} / {checkinState.nextMilestone}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-[#B7FC0D] to-[#97D600] transition-all duration-700"
                  style={{ width: `${(checkinState.currentStreak / checkinState.nextMilestone) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;
