import { Transaction } from "@mysten/sui/transactions";
import { getAgentPolicyConfig, CLOCK_OBJECT_ID, assetTypeFor } from "../config.js";
import { AgentActionType } from "../types.js";

/**
 * Builds the create_policy transaction for the OWNER to sign with their connected
 * wallet (dapp-kit). The server never signs this — it only constructs the unsigned
 * PTB and returns it for client-side signing. The capability is delegated straight
 * to the agent address inside the same call.
 */
export interface CreatePolicyInput {
  /** Agent wallet address that will hold the capability. */
  agentAddress: string;
  /** Budget cap in base units of the budget asset (e.g. USDC decimals). */
  budgetCap: bigint;
  /** Allowed protocol id strings (defaults to DeepBook from config if omitted). */
  allowedProtocols?: string[];
  /** Allowed asset SYMBOLS (e.g. ["SUI","USDC"]) — resolved to type strings. */
  allowedAssets: string[];
  /** Allowed actions (defaults to swap + limit + cancel). */
  allowedActions?: AgentActionType[];
  /** Hours until the policy expires (default 24). */
  expiryHours?: number;
  /** Gas budget reserved for the agent, not counted toward budgetCap. */
  gasReserve: bigint;
  /** Wall-clock now in ms; defaults to Date.now(). Lets the caller pin a value. */
  nowMs?: number;
}

export function buildCreatePolicyTx(input: CreatePolicyInput): Transaction {
  const { packageId, deepbookPackageId } = getAgentPolicyConfig();
  const tx = new Transaction();

  const protocols = input.allowedProtocols ?? [deepbookPackageId];
  const assetTypes = input.allowedAssets.map(assetTypeFor);
  const actions = input.allowedActions ?? [
    AgentActionType.Swap,
    AgentActionType.LimitOrder,
    AgentActionType.Cancel,
  ];
  const now = input.nowMs ?? Date.now();
  const expiry = now + (input.expiryHours ?? 24) * 60 * 60 * 1000;

  tx.moveCall({
    target: `${packageId}::policy::create_and_delegate`,
    arguments: [
      tx.pure.address(input.agentAddress),
      tx.pure.u64(input.budgetCap),
      tx.pure.vector("string", protocols),
      tx.pure.vector("string", assetTypes),
      tx.pure.vector("u8", actions),
      tx.pure.u64(expiry),
      tx.pure.u64(input.gasReserve),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Extract the created AgentPolicy + AgentCapability object ids from a settled
 * create_policy transaction's objectChanges, so the wallet record can be bound.
 * The frontend submits the signed tx, then posts the result here.
 */
export function extractCreatedIds(objectChanges: any[]): {
  policyId?: string;
  capabilityId?: string;
} {
  let policyId: string | undefined;
  let capabilityId: string | undefined;

  for (const change of objectChanges ?? []) {
    if (change.type !== "created") continue;
    const objType: string = change.objectType ?? "";
    if (objType.endsWith("::policy::AgentPolicy")) policyId = change.objectId;
    else if (objType.endsWith("::capability::AgentCapability")) capabilityId = change.objectId;
  }

  return { policyId, capabilityId };
}
