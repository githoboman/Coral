import { Transaction } from "@mysten/sui/transactions";
import { getAgentPolicyConfig, CLOCK_OBJECT_ID } from "../config.js";

/**
 * Owner-signed pause/resume. Both flip is_active on the shared policy and are
 * checked by validate_action on-chain, so a paused policy hard-blocks the agent
 * even if the off-chain pre-flight is bypassed. Returned unsigned for the owner's
 * connected wallet to sign.
 */

export function buildPauseTx(policyId: string): Transaction {
  const { packageId } = getAgentPolicyConfig();
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::policy::pause`,
    arguments: [tx.object(policyId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildResumeTx(policyId: string): Transaction {
  const { packageId } = getAgentPolicyConfig();
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::policy::resume`,
    arguments: [tx.object(policyId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}
