import { useCurrentAccount } from "@mysten/dapp-kit";
import { useBadgeMint } from "@/hooks/useBadgeMint";
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Hash,
  Users,
} from "lucide-react";

const BADGE_IMAGE =
  "ipfs://bafybeihb3tur4wyiv7dl33whlc43e54seddxtyl2ss24ikt3pstdwecjme";

const resolveImageUrl = (url: string) =>
  url.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${url.slice(7)}` : url;

const SUI_EXPLORER_BASE = "https://suiexplorer.com/object";

const BadgeImage = ({ revealed }: { revealed: boolean }) => {
  return (
    <div
      className={`relative mx-auto transition-all duration-700 ${
        revealed ? "opacity-100 scale-100" : "opacity-60 scale-95"
      }`}
      style={{ width: 220, height: 220 }}
    >
      {/* Outer glow ring */}
      <div
        className={`absolute inset-0 rounded-full transition-all duration-700 ${
          revealed
            ? "shadow-[0_0_60px_20px_rgba(183,252,13,0.18)]"
            : "shadow-[0_0_30px_8px_rgba(183,252,13,0.06)]"
        }`}
      />
      {/* Badge */}
      <img
        src={resolveImageUrl(BADGE_IMAGE)}
        alt="Tovira Testnet Badge"
        className="w-full h-full rounded-full object-cover border-2 border-[#B7FC0D]/30"
        draggable={false}
      />
      {/* Sparkle overlay when revealed */}
      {revealed && (
        <div className="absolute inset-0 rounded-full pointer-events-none overflow-hidden">
          <div className="absolute top-3 right-6 w-2 h-2 bg-[#B7FC0D] rounded-full animate-ping opacity-70" />
          <div className="absolute bottom-6 left-4 w-1.5 h-1.5 bg-[#B7FC0D] rounded-full animate-ping opacity-50 [animation-delay:0.4s]" />
          <div className="absolute top-1/2 right-2 w-1 h-1 bg-white rounded-full animate-ping opacity-40 [animation-delay:0.8s]" />
        </div>
      )}
    </div>
  );
};

const StatPill = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) => (
  <div className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-2xl px-4 py-2.5">
    <Icon size={14} className="text-white/30 shrink-0" />
    <span className="text-white/40 text-xs">{label}</span>
    <span className="text-white font-bold text-sm ml-auto">{value}</span>
  </div>
);

const BadgeMint = () => {
  const currentAccount = useCurrentAccount();
  const { mintState, mint } = useBadgeMint();

  const { status, hasMinted, badgeId, serial, error, totalMinted } = mintState;

  const isLoading =
    status === "checking" || status === "signing" || status === "confirming";

  const isSuccess =
    status === "success" || (status !== "checking" && hasMinted);

  const btnLabel = () => {
    if (!currentAccount) return "Connect Wallet to Mint";
    if (status === "checking") return "Checking eligibility…";
    if (status === "signing") return "Approve in wallet…";
    if (status === "confirming") return "Confirming on-chain…";
    if (isSuccess) return "Badge Claimed ✓";
    return "Mint My Badge";
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 mt-5">
      <div className="mb-10 md:mb-14">
        <div className="flex items-center gap-3 mb-2"></div>
        <h1 className="text-3xl sm:text-4xl font-medium text-white">
          Claim Your{" "}
          <span className="text-[#B7FC0D]">Tovira Testnet Badge</span>
        </h1>
        <p className="text-white/40 text-sm sm:text-base mt-2 max-w-xl">
          An on-chain proof of your participation in the Tovira Testnet. One
          badge per wallet - permanently recorded on Sui.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 items-start">
        <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] sm:rounded-[40px] p-8 sm:p-10 flex flex-col items-center gap-8">
          <BadgeImage revealed={isSuccess} />

          <div className="w-full space-y-3">
            <StatPill
              icon={Users}
              label="Total minted"
              value={totalMinted || "—"}
            />
            {serial && (
              <StatPill icon={Hash} label="Your serial" value={`#${serial}`} />
            )}
          </div>

          {/* Traits */}
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
          {/* Success state */}
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

          {/* Main mint card */}
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
                    Free to mint — only pay gas
                  </p>
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3 mb-8">
                {[
                  {
                    step: "01",
                    label: "Connect your Sui wallet",
                    done: !!currentAccount,
                  },
                  {
                    step: "02",
                    label: "Approve the transaction",
                    done: isSuccess,
                  },
                  {
                    step: "03",
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
                      className={`text-sm transition-colors ${
                        done ? "text-white/70" : "text-white/40"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Error message */}
              {status === "error" && error && (
                <div className="flex items-start gap-3 bg-red-500/8 border border-red-500/20 rounded-2xl p-4 mb-5">
                  <AlertCircle
                    size={16}
                    className="text-red-400 shrink-0 mt-0.5"
                  />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* CTA */}
              <button
                onClick={mint}
                disabled={!currentAccount || isLoading || isSuccess}
                className={`w-full py-4 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  isSuccess
                    ? "bg-white/5 text-white/30 cursor-default"
                    : !currentAccount
                      ? "bg-white/5 text-white/30 cursor-not-allowed"
                      : isLoading
                        ? "bg-[#B7FC0D]/60 text-black cursor-not-allowed"
                        : "bg-[#B7FC0D] text-black hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_0_30px_rgba(183,252,13,0.3)]"
                }`}
              >
                {isLoading && (
                  <Loader2 size={16} className="animate-spin shrink-0" />
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

          {/* Already minted note */}
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
