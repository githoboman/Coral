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
 *   Step 1 (AGENT-signed): cancel all open DeepBook orders + sweep the agent's
 *           coins back to the owner. Atomic within this PTB — if the sweep fails,
 *           the cancels revert too.
 *   Step 2 (OWNER-signed): policy::revoke destroys the AgentCapability and sets
 *           is_active=false. After this, any agent PTB referencing the destroyed
 *           capability aborts on object-not-found.
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

  const db = new AgentDeepBookClient(setup);
  const tx = new Transaction();

  // Cancel all open orders for the agent's balance manager (no-op if none).
  db.cancelAllOrdersFragment()(tx);
  // Pull settled balances out so they're sweepable.
  db.withdrawSettledFragment()(tx);

  // Sweep the agent's owned coins of each pool asset back to the owner. We move
  // ALL coins of the type; gas is paid from the SUI gas coin the SDK reserves.
  await appendCoinSweep(tx, wallet.agentAddress, wallet.ownerAddress, setup);

  const result = await getAgentExecutor().execute(wallet, tx);

  // Clear local budget allocations regardless — the policy is being torn down.
  getBudgetTracker().clear(wallet.policyId);
  getOrderManager().list().forEach((o) => (o.state = "cancelled"));
  getOrderManager().prune();

  if (!result.success) return { ok: false, reason: result.error };
  return { ok: true, cleanupDigest: result.digest };
}

/**
 * Step 2: owner-signed capability destruction. Returns an unsigned tx for the
 * owner's connected wallet. capabilityId is the object the agent holds.
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
  const coinTypes = [assetTypeFor(baseSym), assetTypeFor(quoteSym)];

  for (const coinType of coinTypes) {
    const { data: coins } = await client.getCoins({ owner: agentAddress, coinType });
    if (!coins.length) continue;

    const objects = coins.map((c) => tx.object(c.coinObjectId));
    const primary = objects[0];
    if (objects.length > 1) {
      tx.mergeCoins(primary, objects.slice(1));
    }
    // For the SUI gas type, leaving the full balance can starve gas; the SDK's gas
    // selection handles reserving a gas coin separately when other SUI coins exist.
    tx.transferObjects([primary], tx.pure.address(ownerAddress));
  }
}
