import { useNavigate } from "react-router-dom";
import { FiSun, FiMoon, FiShield, FiExternalLink, FiCopy } from "react-icons/fi";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { useTheme } from "@/hooks/useTheme";
import { useAgentWallet } from "@/hooks/useAgentWallet";

/**
 * Agent Settings — functional (no longer a placeholder). Real controls: theme,
 * the active Sui network, the connected + agent addresses, and a shortcut to the
 * policy panel. Everything here reads/writes live state (useTheme, dapp-kit).
 */
export default function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const { status } = useAgentWallet();
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <h1 className="text-[26px] font-bold text-ink mb-1">Settings</h1>
      <p className="text-[13px] text-muted mb-8">Preferences for the Coral agent.</p>

      <div className="space-y-5">
        {/* Appearance */}
        <Section title="Appearance">
          <Field label="Theme">
            <div className="flex gap-2">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border transition-all cursor-pointer ${
                    theme === t
                      ? "bg-ink text-canvas border-ink"
                      : "bg-surface text-muted border-line hover:border-line-strong"
                  }`}
                >
                  {t === "light" ? <FiSun className="w-4 h-4" /> : <FiMoon className="w-4 h-4" />}
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        {/* Network */}
        <Section title="Network">
          <Field label="Active network">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-3 border border-line text-[13px] font-semibold text-ink capitalize">
              <span className="w-2 h-2 rounded-full bg-positive" />
              {network}
            </span>
          </Field>
        </Section>

        {/* Accounts */}
        <Section title="Accounts">
          <Field label="Connected wallet">
            {account ? (
              <AddressRow address={account.address} />
            ) : (
              <span className="text-[13px] text-muted">Not connected</span>
            )}
          </Field>
          {status?.agentAddress && (
            <Field label="Agent wallet">
              <AddressRow address={status.agentAddress} />
            </Field>
          )}
        </Section>

        {/* Policy shortcut */}
        <Section title="Agent policy">
          <button
            onClick={() => navigate("/agent/policy")}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-ink text-canvas text-[13px] font-semibold transition-all active:scale-[0.98] cursor-pointer"
          >
            <FiShield className="w-4 h-4" />
            Manage policy
          </button>
        </Section>

        {account && (
          <button
            onClick={() => disconnect()}
            className="text-[13px] font-semibold text-danger hover:underline cursor-pointer"
          >
            Disconnect wallet
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
      <h2 className="text-[12px] font-bold text-faint uppercase tracking-wider mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[14px] text-muted">{label}</span>
      {children}
    </div>
  );
}

function AddressRow({ address }: { address: string }) {
  const network = import.meta.env.VITE_SUI_NETWORK || "testnet";
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13px] font-bold text-ink">
        {address.slice(0, 8)}…{address.slice(-6)}
      </span>
      <button
        onClick={() => navigator.clipboard?.writeText(address)}
        className="text-muted hover:text-ink transition-colors cursor-pointer"
        title="Copy"
      >
        <FiCopy className="w-3.5 h-3.5" />
      </button>
      <a
        href={`https://${network === "mainnet" ? "" : network + "."}suivision.xyz/account/${address}`}
        target="_blank"
        rel="noreferrer"
        className="text-muted hover:text-ink transition-colors"
        title="View on explorer"
      >
        <FiExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
