import {
  useState,
  useCallback,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export interface AgentWalletStatus {
  agentAddress: string;
  policyId: string | null;
  capabilityId: string | null;
  bound: boolean;
}

export interface AgentAlert {
  id: string;
  level: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface CreatePolicyForm {
  budgetCap: string; // base units, as string to avoid bigint JSON issues
  allowedAssets: string[]; // e.g. ["SUI","USDC"]
  expiryHours: number;
  gasReserve: string;
  /** Optional explicit DeepBook setup for the revoke sweep. */
}

export interface DeepBookSetup {
  agentAddress: string;
  balanceManagerId: string;
  poolKey: string;
}

export interface TradeIntent {
  action: string;
  tokenIn?: string;
  tokenOut?: string;
  amount?: number;
  percentage?: number;
  price?: number;
  condition?: "below" | "above";
  schedule?: string;
  summary: string;
}

export interface IntentResult {
  ok: boolean;
  intent: TradeIntent;
  message: string;
  outcome?: { ok: boolean; digest?: string; reason?: string; orderId?: string };
  armed?: "scheduled" | "conditional";
}

/** Live on-chain policy state from GET /api/agent/policy (bigints as strings). */
export interface PolicyState {
  policyId: string;
  budgetCap: string;
  budgetSpent: string;
  budgetRemaining: string;
  usedPercent: number;
  allowedAssets: string[];
  allowedProtocols: string[];
  allowedActions: number[];
  expiryTimestampMs: string;
  gasReserve: string;
  isActive: boolean;
}

type Busy =
  | "idle"
  | "init"
  | "creating"
  | "binding"
  | "pausing"
  | "resuming"
  | "revoking"
  | "thinking";

/**
 * Drives the Agent Controls panel. Owner-signing actions fetch unsigned tx bytes
 * from the backend, sign them with the connected wallet (dapp-kit), and — for
 * policy creation — post the resulting objectChanges back so the server can bind
 * the policy + capability ids to the agent wallet.
 *
 * This is the IMPLEMENTATION hook. Consumers call `useAgentWallet()` (below),
 * which reads a single shared instance via context — so the header pill, chat,
 * policy page, notification bell and activity log all see the same state and only
 * one alert poll runs, instead of 7 independent copies.
 */
function useAgentWalletState() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [status, setStatus] = useState<AgentWalletStatus | null>(null);
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const alertPoll = useRef<NodeJS.Timeout | null>(null);

  const api = useCallback(
    async (path: string, body?: unknown) => {
      const headers: Record<string, string> = {};
      if (body) headers["Content-Type"] = "application/json";
      // Local-demo bypass: when VITE_AGENT_DEV_AUTH is on, send the connected wallet
      // as x-dev-wallet so the server's dev auth path accepts it without a Supabase token.
      if (import.meta.env.VITE_AGENT_DEV_AUTH === "true" && account?.address) {
        headers["x-dev-wallet"] = account.address;
      }
      const res = await fetch(`${API_BASE}/api/agent${path}`, {
        method: body ? "POST" : "GET",
        credentials: "include",
        headers: Object.keys(headers).length ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok || json.status === false) {
        throw new Error(json?.message || `Request to ${path} failed`);
      }
      return json.data;
    },
    [account?.address],
  );

  // ── Reads ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!account?.address) return;
    try {
      const data = (await api("/wallet")) as AgentWalletStatus | null;
      setStatus(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load agent wallet");
    }
  }, [account?.address, api]);

  const refreshAlerts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const data = (await api("/alerts")) as AgentAlert[];
      setAlerts(data);
    } catch {
      /* alerts are best-effort */
    }
  }, [account?.address, api]);

  /** Read the live on-chain policy state (budget usage, expiry, whitelists). */
  const refreshPolicy = useCallback(async () => {
    if (!account?.address) return;
    try {
      const data = (await api("/policy")) as PolicyState | null;
      setPolicy(data);
    } catch {
      /* policy read is best-effort; drawer falls back to configured form */
    }
  }, [account?.address, api]);

  // On connect/mount, hit /wallet/init (not just /wallet). init is idempotent and
  // triggers the server's on-chain binding discovery, so after a backend restart
  // (in-memory store reset) the policy/capability are re-bound automatically —
  // preventing the "No bound policy" / "No agent wallet yet" errors on refresh.
  useEffect(() => {
    if (!account?.address) return;
    (async () => {
      try {
        const data = (await api("/wallet/init", {})) as AgentWalletStatus;
        setStatus(data);
      } catch {
        // Fall back to a plain read if init isn't available for any reason.
        refresh();
      }
    })();
  }, [account?.address, api, refresh]);

  // Pull live policy state once the agent is bound (and refresh it as bound flips).
  useEffect(() => {
    if (status?.bound) refreshPolicy();
    else setPolicy(null);
  }, [status?.bound, refreshPolicy]);

  useEffect(() => {
    if (!account?.address) return;
    refreshAlerts();
    alertPoll.current = setInterval(refreshAlerts, 8000);
    return () => {
      if (alertPoll.current) clearInterval(alertPoll.current);
    };
  }, [account?.address, refreshAlerts]);

  // ── Actions ────────────────────────────────────────────────────────

  /** Create (or fetch) the agent wallet for the connected owner. */
  const initWallet = useCallback(async () => {
    setBusy("init");
    setError(null);
    try {
      const data = (await api("/wallet/init", {})) as AgentWalletStatus;
      setStatus(data);
      return data;
    } catch (e: any) {
      setError(e?.message ?? "init failed");
      throw e;
    } finally {
      setBusy("idle");
    }
  }, [api]);

  /** Sign a server-built unsigned tx (base64) with the owner wallet. */
  const signServerTx = useCallback(
    async (txBytes: string) => {
      const tx = Transaction.from(txBytes);
      const result = await signAndExecute({ transaction: tx });
      const confirmed = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      if (confirmed.effects?.status?.status !== "success") {
        throw new Error(confirmed.effects?.status?.error || "Transaction failed");
      }
      return confirmed;
    },
    [signAndExecute, suiClient],
  );

  /** Create a policy: build tx -> owner signs -> bind created ids. */
  const createPolicy = useCallback(
    async (form: CreatePolicyForm) => {
      setBusy("creating");
      setError(null);
      try {
        const { txBytes } = (await api("/policy/create-tx", {
          budgetCap: form.budgetCap,
          allowedAssets: form.allowedAssets,
          expiryHours: form.expiryHours,
          gasReserve: form.gasReserve,
        })) as { txBytes: string };

        const confirmed = await signServerTx(txBytes);

        setBusy("binding");
        await api("/policy/bind", { objectChanges: confirmed.objectChanges ?? [] });
        await refresh();
      } catch (e: any) {
        setError(e?.message ?? "create policy failed");
        throw e;
      } finally {
        setBusy("idle");
      }
    },
    [api, signServerTx, refresh],
  );

  const pause = useCallback(async () => {
    setBusy("pausing");
    setError(null);
    try {
      const { txBytes } = (await api("/policy/pause-tx", {})) as { txBytes: string };
      await signServerTx(txBytes);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "pause failed");
      throw e;
    } finally {
      setBusy("idle");
    }
  }, [api, signServerTx, refresh]);

  const resume = useCallback(async () => {
    setBusy("resuming");
    setError(null);
    try {
      const { txBytes } = (await api("/policy/resume-tx", {})) as { txBytes: string };
      await signServerTx(txBytes);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "resume failed");
      throw e;
    } finally {
      setBusy("idle");
    }
  }, [api, signServerTx, refresh]);

  /**
   * The agentic entrypoint — send a plain-language instruction. The server parses
   * it, validates against policy, and executes/arms the right strategy. Returns the
   * parsed intent + outcome so the UI can show what the agent understood and did.
   */
  const sendIntent = useCallback(
    async (message: string, deepbook: DeepBookSetup): Promise<IntentResult> => {
      setBusy("thinking");
      setError(null);
      try {
        const data = (await api("/intent", { message, deepbook })) as IntentResult;
        await refreshAlerts();
        await refresh();
        return data;
      } catch (e: any) {
        setError(e?.message ?? "intent failed");
        throw e;
      } finally {
        setBusy("idle");
      }
    },
    [api, refresh, refreshAlerts],
  );

  /**
   * Two-step revoke: server runs agent-signed cleanup+sweep and returns the
   * unsigned revoke tx; the owner signs it to destroy the capability.
   */
  const revoke = useCallback(
    async (deepbook?: DeepBookSetup) => {
      setBusy("revoking");
      setError(null);
      try {
        const data = (await api("/policy/revoke", { deepbook })) as {
          cleanup: { ok: boolean; reason?: string };
          revokeTxBytes: string;
        };
        await signServerTx(data.revokeTxBytes);
        await refresh();
        await refreshAlerts();
        return data.cleanup;
      } catch (e: any) {
        setError(e?.message ?? "revoke failed");
        throw e;
      } finally {
        setBusy("idle");
      }
    },
    [api, signServerTx, refresh, refreshAlerts],
  );

  return {
    account,
    status,
    policy,
    alerts,
    busy,
    error,
    initWallet,
    createPolicy,
    pause,
    resume,
    revoke,
    sendIntent,
    refresh,
    refreshAlerts,
    refreshPolicy,
  };
}

// ── Shared state via context ───────────────────────────────────────────
type AgentWalletValue = ReturnType<typeof useAgentWalletState>;
const AgentWalletContext = createContext<AgentWalletValue | null>(null);

/**
 * Provides ONE shared agent-wallet state instance to the whole tree. Mount this
 * once (around the agent area) so every consumer shares status/policy/alerts and
 * a single poll, instead of each `useAgentWallet()` spinning up its own copy.
 */
export function AgentWalletProvider({ children }: { children: ReactNode }) {
  const value = useAgentWalletState();
  return <AgentWalletContext.Provider value={value}>{children}</AgentWalletContext.Provider>;
}

/**
 * Consume the shared agent-wallet state. Falls back to a standalone instance if
 * no provider is mounted, so isolated usage still works (just not shared).
 */
export function useAgentWallet(): AgentWalletValue {
  const ctx = useContext(AgentWalletContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return ctx ?? useAgentWalletState();
}
