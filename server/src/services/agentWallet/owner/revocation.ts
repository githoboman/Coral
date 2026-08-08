import { Transaction } from "@mysten/sui/transactions";
import { getAgentPolicyConfig, CLOCK_OBJECT_ID, getSuiClient } from "../config.js";
import { AgentDeepBookClient, type DeepBookSetup } from "../deepbookClient.js";
import { getAgentExecutor } from "../executor.js";
import { getBudgetTracker } from "../budgetTracker.js";
import { getOrderManager } from "../orderManager.js";
import type { AgentWalletRecord } from "../types.js";

/**
 * Revocation is two sequenced steps because the two halves need DIFFERENT signers
 * (Sui can't put them in one atomic PTB):
 *
 *   Step 1 (AGENT-signed): cancel all open DeepBook orders, sweep the agent's coins
 *           back to the owner, AND transfer the AgentCapability back to the owner.
 *           That last move is essential: create_and_delegate gave the capability to
 *           the AGENT (so it can reference it while trading), but policy::revoke
 *           takes the capability BY VALUE and must be sent by the OWNER. An owner
 *           can't pass an agent-owned object, so the agent first hands it back.
 *   Step 2 (OWNER-signed): policy::revoke consumes the (now owner-owned) capability
 *           and sets is_active=false. After this, any agent PTB referencing the
 *           destroyed capability aborts on object-not-found.
 *
 * The demo runs cleanupAndSweep() (server, agent key), then hands buildRevokeTx()
 * to the owner's wallet. End state: orders gone, funds home, capability destroyed,
 * agent's next action fails on-chain.
 */

export interface RevocationResult {
  ok: boolean;
  reason?: string;
  /** Digest of the agent-signed cleanup+sweep tx. */
  cleanupDigest?: string;
}

/**
 * Step 1: agent-signed atomic cleanup. Cancels every open order in the pool and
 * transfers all of the agent's coins of the pool's asset types back to the owner.
 */
export async function cleanupAndSweep(
  wallet: AgentWalletRecord,
  setup: DeepBookSetup,
): Promise<RevocationResult> {
  if (!wallet.policyId) return { ok: false, reason: "Wallet not bound to a policy" };

  // Idempotency: if a prior revoke attempt already handed the capability back to
  // the owner, the agent no longer owns it — re-running the agent cleanup would
  // fail ("wrong sender"). In that case the on-chain cleanup is already done; skip
  // straight to the owner-signed destroy step.
  if (wallet.capabilityId) {
    const capOwner = await ownerOf(wallet.capabilityId);
    if (capOwner && capOwner !== wallet.agentAddress) {
      getBudgetTracker().clear(wallet.policyId);
      getOrderManager().list().forEach((o) => (o.state = "cancelled"));
      getOrderManager().prune();
      return { ok: true, reason: "Cleanup already completed in a prior attempt." };
    }
  }

  const db = new AgentDeepBookClient(setup);
  const tx = new Transaction();

  // Cancel all open orders for the agent's balance manager (no-op if none).
  db.cancelAllOrdersFragment()(tx);
  // Pull settled balances out so they're sweepable.
  db.withdrawSettledFragment()(tx);

  // Sweep the agent's owned NON-SUI trading assets back to the owner (fresh coin
  // reads inside; SUI/gas is deliberately left with the agent).
  await appendCoinSweep(tx, wallet.agentAddress, wallet.ownerAddress, setup);

  // Hand the AgentCapability back to the owner so the owner-signed step 2 can
  // consume it (policy::revoke takes it by value, sender must be the owner).
  if (wallet.capabilityId) {
    tx.transferObjects([tx.object(wallet.capabilityId)], tx.pure.address(wallet.ownerAddress));
  }

  const result = await getAgentExecutor().execute(wallet, tx);

  // Clear local budget allocations regardless — the policy is being torn down.
  getBudgetTracker().clear(wallet.policyId);
  getOrderManager().list().forEach((o) => (o.state = "cancelled"));
  getOrderManager().prune();

  if (!result.success) return { ok: false, reason: result.error };
  return { ok: true, cleanupDigest: result.digest };
}

/** Address that currently owns an object, or null if shared/immutable/gone. */
async function ownerOf(objectId: string): Promise<string | null> {
  try {
    const res = await getSuiClient().getObject({ id: objectId, options: { showOwner: true } });
    const owner: any = res.data?.owner;
    return owner && typeof owner === "object" && "AddressOwner" in owner ? owner.AddressOwner : null;
  } catch {
    return null;
  }
}

/**
 * Step 1 (no-DeepBook path): agent-signed tx that just transfers the
 * AgentCapability back to the owner, so the owner-signed revoke can consume it.
 * Used when a revoke is requested without a DeepBook setup (nothing to sweep).
 */
export async function returnCapability(wallet: AgentWalletRecord): Promise<RevocationResult> {
  if (!wallet.capabilityId) return { ok: false, reason: "Wallet has no capability to return" };
  // Idempotency: already handed back? Nothing to do — proceed to owner destroy.
  const capOwner = await ownerOf(wallet.capabilityId);
  if (capOwner && capOwner !== wallet.agentAddress) {
    return { ok: true, reason: "Capability already returned to owner." };
  }
  const tx = new Transaction();
  tx.transferObjects([tx.object(wallet.capabilityId)], tx.pure.address(wallet.ownerAddress));
  const result = await getAgentExecutor().execute(wallet, tx);
  if (!result.success) return { ok: false, reason: result.error };
  return { ok: true, cleanupDigest: result.digest };
}

/**
 * Step 2: owner-signed capability destruction. Returns an unsigned tx for the
 * owner's connected wallet. By this point the capability has been handed back to
 * the owner (step 1), so the owner can pass it by value to policy::revoke.
 */
export function buildRevokeTx(policyId: string, capabilityId: string): Transaction {
  const { packageId } = getAgentPolicyConfig();
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::policy::revoke`,
    arguments: [tx.object(policyId), tx.object(capabilityId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

/**
 * Append transfers of every coin the agent holds in the pool's asset types to the
 * owner. Skips the gas coin so the sweep tx can still pay for itself.
 */
async function appendCoinSweep(
  tx: Transaction,
  agentAddress: string,
  ownerAddress: string,
  setup: DeepBookSetup,
): Promise<void> {
  const client = getSuiClient();
  const [baseSym, quoteSym] = setup.poolKey.split("_");
  const { assetTypeFor } = await import("../config.js");
  const SUI_TYPE = "0x2::sui::SUI";

  // NEVER sweep the SUI (gas) coin type here: this is the agent-signed cleanup tx,
  // and it must keep a SUI coin to pay its OWN gas. Transferring all SUI away leaves
  // nothing for gas → "No valid gas coins". Non-SUI trading assets (e.g. USDC) are
  // swept in full; leftover SUI stays with the agent and can be recovered later.
  const coinTypes = [assetTypeFor(baseSym), assetTypeFor(quoteSym)].filter(
    (t) => t !== SUI_TYPE,
  );

  for (const coinType of coinTypes) {
    const { data: coins } = await client.getCoins({ owner: agentAddress, coinType });
    if (!coins.length) continue;

    const objects = coins.map((c) => tx.object(c.coinObjectId));
    const primary = objects[0];
    if (objects.length > 1) {
      tx.mergeCoins(primary, objects.slice(1));
    }
    tx.transferObjects([primary], tx.pure.address(ownerAddress));
  }
}
