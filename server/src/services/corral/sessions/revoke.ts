/**
 * Revocation (FR-8.1, FR-8.2, spec §4.4).
 *
 * Ordering is the whole point:
 *   1. disable the off-chain signer            — immediate, <1s, unconditional
 *   2. drain the queue for that session        — nothing new reaches the relayer
 *   3. hand the OWNER the transaction to sign  — we cannot revoke on their behalf
 *   4. confirm from chain, then mark REVOKED
 *
 * Step 3 is not a limitation, it is the design: Corral holds no owner key and
 * no admin role over user accounts (FR-1.4). If our whole stack is hostile,
 * revocation still works — that is what the standalone page proves.
 */
import { encodeFunctionData, encodePacked, type Address, type Hex, type PublicClient } from "viem";

import { smartSessionsAbi } from "../../evm/abi/smartSessions.js";
import type { ChainAddresses } from "../../evm/addresses.js";
import { query } from "../db/pool.js";
import { recordAnomaly } from "../reconcile/budget.js";
import { disableSigner, getSession, markRevoked, type SessionRow } from "./repository.js";

export interface RevokeTicket {
  readonly sessionId: string;
  /** The moment the agent lost the ability to sign — independent of any block. */
  readonly signerDisabledAt: Date;
  readonly jobsCancelled: number;
  /** The transaction the OWNER sends. `to` is their account; Corral never signs it. */
  readonly ownerTransaction: { readonly to: Address; readonly value: "0x0"; readonly data: Hex };
  /** Plain-language, for the confirmation screen (FR-8.4). */
  readonly disclosure: string;
}

export const REVOKE_DISCLOSURE =
  "Revoking stops the agent from taking any further action: every future attempt is rejected on-chain. " +
  "It does not reverse transactions that were already included in a block, and it does not move any funds — " +
  "everything stays in your account.";

/**
 * Step 1–3. Safe to call repeatedly; the disable is idempotent and the
 * returned transaction is deterministic.
 */
export async function requestRevoke(addresses: ChainAddresses, sessionId: string): Promise<RevokeTicket> {
  const session = await disableSigner(sessionId);
  if (!session) throw new Error(`unknown session ${sessionId}`);

  // Nothing queued may reach the signer or the relayer after this point.
  const cancelled = await query<{ id: string }>(
    `UPDATE corral_jobs SET status = 'DEAD', last_error = 'session revoked', updated_at = now()
      WHERE session_id = $1 AND status IN ('PENDING','RUNNING') RETURNING id`,
    [sessionId],
  );

  return {
    sessionId,
    signerDisabledAt: new Date(),
    jobsCancelled: cancelled.length,
    ownerTransaction: {
      to: session.account as Address,
      value: "0x0",
      data: encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "execute",
            stateMutability: "payable",
            inputs: [
              { name: "mode", type: "bytes32" },
              { name: "executionCalldata", type: "bytes" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "execute",
        args: [
          `0x${"0".repeat(64)}`, // ERC-7579 mode: single call, revert on failure
          // Single-call execution calldata is packed, not ABI-encoded:
          // target ‖ value ‖ callData.
          encodePacked(["address", "uint256", "bytes"], [addresses.smartSessions.address, 0n, removeSessionCalldata(session)]),
        ],
      }),
    },
    disclosure: REVOKE_DISCLOSURE,
  };
}

function removeSessionCalldata(session: SessionRow): Hex {
  return encodeFunctionData({ abi: smartSessionsAbi, functionName: "removeSession", args: [session.permission_id as Hex] });
}

/**
 * Step 4: believe the chain, not the caller. Only a read showing the
 * permission disabled marks the session REVOKED.
 */
export async function confirmRevoke(client: PublicClient, addresses: ChainAddresses, sessionId: string, txHash: Hex | null): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`unknown session ${sessionId}`);
  const stillEnabled = await client.readContract({
    address: addresses.smartSessions.address,
    abi: smartSessionsAbi,
    functionName: "isPermissionEnabled",
    args: [session.permission_id as Hex, session.account as Address],
  });
  if (stillEnabled) return false;
  await markRevoked(sessionId, txHash);
  await recordAnomaly(sessionId, "SESSION_REVOKED", { txHash });
  return true;
}
