import { DeepBookClient } from "@mysten/deepbook-v3";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, getNetwork } from "./config.js";
import { getAgentExecutor } from "./executor.js";
import type { AgentWalletRecord } from "./types.js";

/**
 * One-time DeepBook bootstrap for an agent wallet: create + share a BalanceManager
 * and (optionally) fund it. Trading via DeepBook's CLOB requires a BalanceManager;
 * the agent owns one and references it in every order. Run this once after the agent
 * wallet is funded with gas + trading assets.
 *
 * Returns the new BalanceManager id, which is then stored in the DeepBookSetup the
 * swap agent / order manager use.
 */
export interface DeepBookBootstrapResult {
  ok: boolean;
  balanceManagerId?: string;
  digest?: string;
  reason?: string;
}

const MANAGER_KEY = "AGENT_MANAGER";

function clientFor(agentAddress: string): DeepBookClient {
  return new DeepBookClient({
    client: getSuiClient() as any,
    address: agentAddress,
    env: getNetwork(),
  });
}

/**
 * Create and share the agent's BalanceManager. The created shared object id is
 * pulled from objectChanges. Optional deposits seed the manager with trading funds
 * (amounts in whole coin units per the SDK's deposit helper).
 */
export async function bootstrapBalanceManager(
  wallet: AgentWalletRecord,
  deposits: Array<{ coinKey: string; amount: number }> = [],
): Promise<DeepBookBootstrapResult> {
  try {
    const db = clientFor(wallet.agentAddress);
    const tx = new Transaction();

    db.balanceManager.createAndShareBalanceManager()(tx);

    const result = await getAgentExecutor().execute(wallet, tx);
    if (!result.success) return { ok: false, reason: result.error };

    // The shared BalanceManager is the created object of the BalanceManager type.
    const created = await findBalanceManagerId(result.digest!);
    if (!created) return { ok: false, reason: "BalanceManager id not found in tx output" };

    // Fund it if requested — needs a second tx now that the manager exists and is
    // registered under MANAGER_KEY.
    if (deposits.length) {
      const fundClient = new DeepBookClient({
        client: getSuiClient() as any,
        address: wallet.agentAddress,
        env: getNetwork(),
        balanceManagers: { [MANAGER_KEY]: { address: created } },
      });
      const fundTx = new Transaction();
      for (const d of deposits) {
        fundClient.balanceManager.depositIntoManager(MANAGER_KEY, d.coinKey, d.amount)(fundTx);
      }
      const fundResult = await getAgentExecutor().execute(wallet, fundTx);
      if (!fundResult.success) {
        // Manager exists even if funding failed; surface the partial success.
        return { ok: true, balanceManagerId: created, digest: result.digest, reason: `created but funding failed: ${fundResult.error}` };
      }
    }

    return { ok: true, balanceManagerId: created, digest: result.digest };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

/**
 * Deposit funds into an EXISTING BalanceManager (the funding half of bootstrap,
 * without creating a new manager). Use this to top up the agent's already-created
 * manager so its DeepBook orders can actually settle. Amounts are in whole coin
 * units (e.g. 0.5 = 0.5 SUI) per the SDK's deposit helper, and the coins come from
 * the agent wallet, signed by the agent key.
 */
export async function depositIntoBalanceManager(
  wallet: AgentWalletRecord,
  balanceManagerId: string,
  deposits: Array<{ coinKey: string; amount: number }>,
): Promise<DeepBookBootstrapResult> {
  if (!balanceManagerId) return { ok: false, reason: "balanceManagerId is required" };
  if (!deposits.length) return { ok: false, reason: "At least one deposit is required" };
  try {
    const fundClient = new DeepBookClient({
      client: getSuiClient() as any,
      address: wallet.agentAddress,
      env: getNetwork(),
      balanceManagers: { [MANAGER_KEY]: { address: balanceManagerId } },
    });
    const tx = new Transaction();
    for (const d of deposits) {
      fundClient.balanceManager.depositIntoManager(MANAGER_KEY, d.coinKey, d.amount)(tx);
    }
    const result = await getAgentExecutor().execute(wallet, tx);
    if (!result.success) return { ok: false, reason: result.error };
    return { ok: true, balanceManagerId, digest: result.digest };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

/** Find the created BalanceManager object id from a settled tx's object changes. */
async function findBalanceManagerId(digest: string): Promise<string | null> {
  const tx = await getSuiClient().getTransactionBlock({
    digest,
    options: { showObjectChanges: true },
  });
  for (const change of tx.objectChanges ?? []) {
    if (change.type === "created" && /::balance_manager::BalanceManager$/.test((change as any).objectType ?? "")) {
      return (change as any).objectId;
    }
  }
  return null;
}

/**
 * Discover the agent's existing BalanceManager on-chain (owned by the agent
 * address) without needing a stored id. A BalanceManager is shared, but the
 * agent holds an owner cap / it's created by the agent, so we look it up via
 * the objects the agent owns/created. Returns the first match or null.
 *
 * DeepBook's BalanceManager is a shared object, so it won't appear in
 * getOwnedObjects. We instead scan the agent's transaction history for a
 * create_balance_manager and pull the shared id from that tx. Best-effort,
 * with pagination bounded so it stays cheap.
 */
export async function discoverBalanceManagerId(agentAddress: string): Promise<string | null> {
  const client = getSuiClient();
  const isBM = (objectType: unknown) =>
    /::balance_manager::BalanceManager$/.test(String(objectType ?? ""));
  try {
    // IMPORTANT: publicnode (and other RPCs) reject showObjectChanges on the LIST
    // query ("unable to derive object changes because effect is empty"). So we get
    // digests cheaply first, then fetch each tx individually with objectChanges —
    // which the single-tx endpoint supports. Match ANY BalanceManager the agent
    // touches (created OR mutated), since the original create tx may be older but
    // every deposit/order mutates the manager.
    let cursor: string | null | undefined = undefined;
    for (let page = 0; page < 6; page++) {
      const res: any = await client.queryTransactionBlocks({
        filter: { FromAddress: agentAddress },
        order: "descending",
        limit: 20,
        cursor: cursor ?? null,
      });
      const digests: string[] = (res.data ?? []).map((t: any) => t.digest).filter(Boolean);
      for (const digest of digests) {
        try {
          const tx: any = await client.getTransactionBlock({
            digest,
            options: { showObjectChanges: true },
          });
          for (const change of tx.objectChanges ?? []) {
            if (
              (change.type === "created" || change.type === "mutated") &&
              isBM((change as any).objectType)
            ) {
              return (change as any).objectId;
            }
          }
        } catch {
          /* skip a tx we can't read */
        }
      }
      if (!res.hasNextPage) break;
      cursor = res.nextCursor;
    }
  } catch {
    /* discovery is best-effort; caller falls back to create */
  }
  return null;
}

/**
 * Resolve the agent's BalanceManager: return the discovered id, or create a new
 * one if the agent has none. Idempotent enough for a "fund" flow that shouldn't
 * require the user to know the id.
 */
export async function getOrCreateBalanceManager(
  wallet: AgentWalletRecord,
): Promise<DeepBookBootstrapResult> {
  const existing = await discoverBalanceManagerId(wallet.agentAddress);
  if (existing) return { ok: true, balanceManagerId: existing };
  return bootstrapBalanceManager(wallet);
}

/**
 * Read the trading balances held inside a BalanceManager (what DeepBook settles
 * from), per coin. Amounts are whole tokens. Powers the "Fund trading account"
 * card so the user sees what's actually available to trade vs sitting as gas.
 */
export async function readManagerBalances(
  agentAddress: string,
  balanceManagerId: string,
  coinKeys: string[] = ["SUI", "DBUSDC"],
): Promise<Record<string, number>> {
  const client = new DeepBookClient({
    client: getSuiClient() as any,
    address: agentAddress,
    env: getNetwork(),
    balanceManagers: { [MANAGER_KEY]: { address: balanceManagerId } },
  });
  const out: Record<string, number> = {};
  for (const key of coinKeys) {
    try {
      const r = (await client.checkManagerBalance(MANAGER_KEY, key)) as any;
      out[key] = Number(r?.balance ?? 0);
    } catch {
      out[key] = 0;
    }
  }
  return out;
}
