import { useNavigate } from "react-router-dom";
import { FiSun, FiMoon, FiShield, FiExternalLink, FiCopy } from "react-icons/fi";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { useTheme } from "@/hooks/useTheme";
import { useAgentWallet } from "@/hooks/useAgentWallet";

/**
 * Agent Settings — orange/white/black redesign.
 * Active theme button is orange. Sections use themed surface tokens.
 * All buttons route correctly and have full light/dark coverage.
 */
export default function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const { status } = useAgentWallet();
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";

  return (
    <div className="
      h-full w-full overflow-y-auto
      bg-[var(--canvas)] transition-colors duration-200
      px-6 py-8 font-sans
    ">
      <div className="max-w-2xl mx-auto">

        {/* Page header */}
        <div className="mb-8 whisk-in">
          <h1 className="text-[28px] font-bold text-[var(--ink)]">Settings</h1>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            Preferences for the Coral agent.
          </p>
        </div>

        <div className="space-y-4">

          {/* ── Appearance ── */}
          <Section title="Appearance" delay={1}>
            <Field label="Theme">
              <div className="flex gap-2">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`
                      flex items-center gap-2 px-4 py-2
                      rounded-full text-[13px] font-semibold
                      border transition-all duration-150 cursor-pointer
                      active:scale-[0.96]
                      ${theme === t
                        ? "bg-[var(--brand)] text-white border-[var(--brand)] shadow-md"
                        : "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--line)] hover:border-[var(--brand)]/50 hover:text-[var(--brand)]"
                      }
                    `}
                  >
                    {t === "light"
                      ? <FiSun  className="w-3.5 h-3.5" />
                      : <FiMoon className="w-3.5 h-3.5" />
                    }
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          {/* ── Network ── */}
          <Section title="Network" delay={2}>
            <Field label="Active network">
              <span className="
                inline-flex items-center gap-2
                px-3 py-1.5 rounded-full
                bg-[var(--brand-dim)] border border-[var(--brand)]/25
                text-[13px] font-semibold text-[var(--brand)] capitalize
              ">
                <span className="w-2 h-2 rounded-full bg-[var(--positive)] animate-pulse" />
                {network}
              </span>
            </Field>
          </Section>

          {/* ── Accounts ── */}
          <Section title="Accounts" delay={3}>
            <Field label="Connected wallet">
              {account ? (
                <AddressRow address={account.address} />
              ) : (
                <span className="text-[13px] text-[var(--muted)]">Not connected</span>
              )}
            </Field>
            {status?.agentAddress && (
              <Field label="Agent wallet">
                <AddressRow address={status.agentAddress} />
              </Field>
            )}
          </Section>

          {/* ── Agent policy ── */}
          <Section title="Agent policy" delay={4}>
            <button
              onClick={() => navigate("/agent/policy")}
              className="
                flex items-center gap-2 px-5 py-2.5
                rounded-full bg-[var(--brand)] text-white
                text-[13px] font-bold shadow-md
                hover:bg-[var(--brand-hover)]
                hover:shadow-[0_6px_20px_rgba(255,107,0,0.30)]
                hover:-translate-y-0.5
                transition-all duration-150 active:scale-[0.96] cursor-pointer
              "
            >
              <FiShield className="w-4 h-4" />
              Manage policy
            </button>
          </Section>

          {/* Disconnect */}
          {account && (
            <div className="pt-2 whisk-in whisk-d5">
              <button
                onClick={() => disconnect()}
                className="
                  text-[13px] font-semibold text-[var(--danger)]
                  hover:underline transition-colors cursor-pointer
                "
              >
                Disconnect wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────── */

function Section({
  title,
  children,
  delay = 1,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <div className={`
      bg-[var(--surface)] border border-[var(--line)]
      rounded-2xl p-6 shadow-sm
      whisk-in whisk-d${delay}
    `}>
      <h2 className="
        text-[11px] font-bold text-[var(--brand)]
        uppercase tracking-[0.15em] mb-4
      ">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[14px] text-[var(--muted)] font-medium">{label}</span>
      {children}
    </div>
  );
}

function AddressRow({ address }: { address: string }) {
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13px] font-bold text-[var(--ink)]">
        {address.slice(0, 8)}…{address.slice(-6)}
      </span>
      <button
        onClick={() => navigator.clipboard?.writeText(address)}
        className="text-[var(--faint)] hover:text-[var(--brand)] transition-colors cursor-pointer"
        title="Copy address"
      >
        <FiCopy className="w-3.5 h-3.5" />
      </button>
      <a
        href={`https://${network === "mainnet" ? "" : network + "."}suivision.xyz/account/${address}`}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--faint)] hover:text-[var(--brand)] transition-colors"
        title="View on explorer"
      >
        <FiExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
