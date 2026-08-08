import { useCurrentAccount } from "@mysten/dapp-kit";
import { useBadgeMint, POINTS_REQUIRED } from "@/hooks/useBadgeMint";
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Hash,
  Users,
  Zap,
  Lock,
} from "lucide-react";

const BADGE_IMAGE =
  "ipfs://bafybeihb3tur4wyiv7dl33whlc43e54seddxtyl2ss24ikt3pstdwecjme";

const resolveImageUrl = (url: string) =>
  url.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${url.slice(7)}` : url;

const SUI_EXPLORER_BASE = "https://suiscan.xyz/testnet/object";

const BadgeImage = ({
  revealed,
  locked,
}: {
  revealed: boolean;
  locked: boolean;
}) => (
  <div
    className={`relative mx-auto transition-all duration-700 ${
      revealed
        ? "opacity-100 scale-100"
        : locked
          ? "opacity-30 scale-90 grayscale"
          : "opacity-60 scale-95"
    }`}
    style={{ width: 220, height: 220 }}
  >
    <div
      className={`absolute inset-0 rounded-full transition-all duration-700 ${
        revealed
          ? "shadow-[0_0_60px_20px_rgba(183,252,13,0.18)]"
          : locked
            ? "shadow-none"
            : "shadow-[0_0_30px_8px_rgba(183,252,13,0.06)]"
      }`}
    />
    <img
      src={resolveImageUrl(BADGE_IMAGE)}
      alt="Coral Testnet Badge"
      className="w-full h-full rounded-full object-cover border-2 border-[#B7FC0D]/30"
      draggable={false}
    />
    {locked && (
      <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50">
        <Lock size={36} className="text-white/40" />
      </div>
    )}
    {revealed && (
      <div className="absolute inset-0 rounded-full pointer-events-none overflow-hidden">
        <div className="absolute top-3 right-6 w-2 h-2 bg-[#B7FC0D] rounded-full animate-ping opacity-70" />
        <div className="absolute bottom-6 left-4 w-1.5 h-1.5 bg-[#B7FC0D] rounded-full animate-ping opacity-50 [animation-delay:0.4s]" />
        <div className="absolute top-1/2 right-2 w-1 h-1 bg-white rounded-full animate-ping opacity-40 [animation-delay:0.8s]" />
      </div>
    )}
  </div>
);

const StatPill = ({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent?: boolean;
}) => (
  <div
    className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 border ${
      accent
        ? "bg-[#B7FC0D]/5 border-[#B7FC0D]/20"
        : "bg-white/5 border-white/8"
    }`}
  >
    <Icon
      size={14}
      className={accent ? "text-[#B7FC0D] shrink-0" : "text-white/30 shrink-0"}
    />
    <span className="text-white/40 text-xs">{label}</span>
    <span
      className={`font-bold text-sm ml-auto ${accent ? "text-[#B7FC0D]" : "text-white"}`}
    >
      {value}
    </span>
  </div>
);

const PointsGate = ({
  userPoints,
  loading,
  hasEnough,
}: {
  userPoints: number;
  loading: boolean;
  hasEnough: boolean;
}) => {
  const pct = Math.min((userPoints / POINTS_REQUIRED) * 100, 100);

  return (
    <div
      className={`rounded-3xl p-5 border transition-colors ${
        hasEnough
          ? "bg-[#B7FC0D]/5 border-[#B7FC0D]/20"
          : "bg-white/3 border-white/8"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap
            size={14}
            className={hasEnough ? "text-[#B7FC0D]" : "text-white/30"}
          />
          <span className="text-white/60 text-xs font-medium">
            Points required to mint
          </span>
        </div>
        <span
          className={`text-xs font-bold font-mono ${hasEnough ? "text-[#B7FC0D]" : "text-white/40"}`}
        >
          {loading ? "…" : `${userPoints} / ${POINTS_REQUIRED}`}
        </span>
      </div>

      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            hasEnough
              ? "bg-gradient-to-r from-[#B7FC0D] to-[#97D600]"
              : "bg-white/20"
          }`}
          style={{ width: loading ? "0%" : `${pct}%` }}
        />
      </div>

      {!loading && !hasEnough && (
        <p className="text-white/30 text-[11px] mt-2">
          You need {POINTS_REQUIRED - userPoints} more points to unlock minting.
          Keep completing tasks to earn points!
        </p>
      )}
      {!loading && hasEnough && (
        <p className="text-[#B7FC0D]/60 text-[11px] mt-2">
          You have enough points — you're eligible to mint!
        </p>
      )}
    </div>
  );
};

const BadgeMint = () => {
  const currentAccount = useCurrentAccount();
  const {
    status,
    hasMinted,
    badgeId,
    serial,
    error,
    totalMinted,
    userPoints,
    pointsLoading,
    hasEnoughPoints,
    mint,
  } = useBadgeMint();

  const isLoading =
    status === "checking" || status === "signing" || status === "confirming";

  const isSuccess =
    status === "success" || (status !== "checking" && hasMinted);
  const isLocked =
    !isSuccess && !hasEnoughPoints && !pointsLoading && !!currentAccount;
  const isInsufficient = status === "insufficient_points";

  const btnLabel = () => {
    if (!currentAccount) return "Connect Wallet to Mint";
    if (status === "checking") return "Checking eligibility…";
    if (pointsLoading) return "Checking points…";
    if (isLocked) return "Not enough points yet";
    if (status === "signing") return "Approve in wallet…";
    if (status === "confirming") return "Confirming on-chain…";
    if (isSuccess) return "Badge Claimed ✓";
    return "Mint My Badge";
  };

  const btnDisabled =
    !currentAccount || isLoading || isSuccess || isLocked || pointsLoading;

  const btnClass = () => {
    if (isSuccess) return "bg-white/5 text-white/30 cursor-default";
    if (!currentAccount || isLocked || pointsLoading)
      return "bg-white/5 text-white/30 cursor-not-allowed";
    if (isLoading) return "bg-[#B7FC0D]/60 text-black cursor-not-allowed";
    return "bg-[#B7FC0D] text-black hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_0_30px_rgba(183,252,13,0.3)]";
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 mt-12 sm:mt-5">
      <div className="mb-10 md:mb-14">
        <h1 className="text-3xl sm:text-3xl font-medium text-white">
          Claim Your{" "}
          <span className="text-[#B7FC0D]">Coral Testnet Badge</span>
        </h1>
        <p className="text-white/40 text-sm sm:text-base mt-2 max-w-xl">
          An on-chain proof of your participation in the Coral Testnet. One
          badge per wallet - permanently recorded on Sui.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 items-start">
        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] sm:rounded-[40px] p-8 sm:p-10 flex flex-col items-center gap-8">
          <BadgeImage revealed={isSuccess} locked={isLocked} />

          <div className="w-full space-y-3">
            <StatPill
              icon={Users}
              label="Total minted"
              value={totalMinted || "—"}
            />
            {serial && (
              <StatPill
                icon={Hash}
                label="Your serial"
                value={`#${serial}`}
                accent
              />
            )}
            {currentAccount && (
              <StatPill
                icon={Zap}
                label="Your points"
                value={pointsLoading ? "…" : userPoints}
                accent={hasEnoughPoints}
              />
            )}
          </div>

          <div className="w-full bg-white/5 rounded-3xl p-5 border border-white/5">
            <h4 className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-4">
              Badge Properties
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { trait: "Network", value: "Sui Testnet" },
                { trait: "Type", value: "Soulbound" },
                { trait: "Supply", value: "Unlimited" },
                { trait: "Per wallet", value: "1 max" },
              ].map((t) => (
                <div
                  key={t.trait}
                  className="bg-black/30 rounded-2xl px-4 py-3 border border-white/5"
                >
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">
                    {t.trait}
                  </p>
                  <p className="text-white text-sm font-semibold">{t.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 sm:gap-8">
          {isSuccess && (
            <div className="bg-gradient-to-br from-[#0A1A00] to-[#0A0A0A] border border-[#B7FC0D]/30 rounded-[32px] p-6 sm:p-8 relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#B7FC0D]/8 blur-[60px] rounded-full" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 size={28} className="text-[#B7FC0D]" />
                  <div>
                    <h3 className="text-white font-bold text-lg leading-tight">
                      Badge Claimed!
                    </h3>
                    <p className="text-white/40 text-xs">
                      Your proof of participation is on-chain
                    </p>
                  </div>
                </div>
                {badgeId && (
                  <a
                    href={`${SUI_EXPLORER_BASE}/${badgeId}?network=testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors group"
                  >
                    <ExternalLink
                      size={14}
                      className="group-hover:text-[#B7FC0D] transition-colors"
                    />
                    View on Sui Explorer
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="bg-[#1A1A1A] border border-white/10 rounded-[32px] p-6 sm:p-8 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#B7FC0D]/4 blur-[60px] rounded-full" />

            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-[#B7FC0D]/10 rounded-2xl border border-[#B7FC0D]/20 shrink-0">
                  <Sparkles size={22} className="text-[#B7FC0D]" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">
                    Mint Your Badge
                  </h3>
                  <p className="text-white/40 text-xs">
                    Free to mint — only pay gas · Requires {POINTS_REQUIRED}{" "}
                    points
                  </p>
                </div>
              </div>

              {currentAccount && !isSuccess && (
                <div className="mb-6">
                  <PointsGate
                    userPoints={userPoints}
                    loading={pointsLoading}
                    hasEnough={hasEnoughPoints}
                  />
                </div>
              )}

              <div className="space-y-3 mb-8">
                {[
                  {
                    step: "01",
                    label: "Connect your Sui wallet",
                    done: !!currentAccount,
                  },
                  {
                    step: "02",
                    label: `Reach ${POINTS_REQUIRED} points`,
                    done: hasEnoughPoints,
                  },
                  {
                    step: "03",
                    label: "Approve the transaction",
                    done: isSuccess,
                  },
                  {
                    step: "04",
                    label: "Badge lands in your wallet",
                    done: isSuccess,
                  },
                ].map(({ step, label, done }) => (
                  <div
                    key={step}
                    className="flex items-center gap-3 py-3 px-4 rounded-2xl bg-white/3 border border-white/5"
                  >
                    <span
                      className={`text-xs font-bold font-mono shrink-0 transition-colors ${
                        done ? "text-[#B7FC0D]" : "text-white/20"
                      }`}
                    >
                      {done ? "✓" : step}
                    </span>
                    <span
                      className={`text-sm transition-colors ${done ? "text-white/70" : "text-white/40"}`}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {isInsufficient && (
                <div className="flex items-start gap-3 bg-yellow-500/8 border border-yellow-500/20 rounded-2xl p-4 mb-5">
                  <Lock size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-yellow-400 text-sm">
                    You need at least {POINTS_REQUIRED} points to mint. Keep
                    completing tasks to earn more!
                  </p>
                </div>
              )}

              {status === "error" && error && (
                <div className="flex items-start gap-3 bg-red-500/8 border border-red-500/20 rounded-2xl p-4 mb-5">
                  <AlertCircle
                    size={16}
                    className="text-red-400 shrink-0 mt-0.5"
                  />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                onClick={mint}
                disabled={btnDisabled}
                className={`w-full py-4 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 ${btnClass()}`}
              >
                {(isLoading || pointsLoading) && (
                  <Loader2 size={16} className="animate-spin shrink-0" />
                )}
                {isLocked && !isLoading && (
                  <Lock size={14} className="shrink-0" />
                )}
                {btnLabel()}
              </button>

              {!currentAccount && (
                <p className="text-white/30 text-xs text-center mt-3">
                  Use the wallet button in the nav to connect
                </p>
              )}
            </div>
          </div>

          {(status === "already_minted" || (hasMinted && status === "idle")) &&
            !isSuccess && (
              <div className="bg-white/3 border border-white/8 rounded-[24px] p-5 flex items-start gap-3">
                <ShieldCheck
                  size={18}
                  className="text-[#B7FC0D] shrink-0 mt-0.5"
                />
                <div>
                  <p className="text-white/70 text-sm font-medium">
                    Already claimed
                  </p>
                  <p className="text-white/30 text-xs mt-0.5">
                    Each wallet can only hold one Testnet Badge. Yours is
                    already in your wallet.
                  </p>
                  {badgeId && (
                    <a
                      href={`${SUI_EXPLORER_BASE}/${badgeId}?network=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[#B7FC0D] hover:underline text-xs mt-2 transition-colors"
                    >
                      <ExternalLink size={12} />
                      View your badge
                    </a>
                  )}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default BadgeMint;
