/**
 * Minimal own relayer (D13, T-008): submit a signed ERC-4337 v0.7 user
 * operation by calling `EntryPoint.handleOps` directly from our EOA.
 *
 * No third-party bundler, no shared mempool: a signed op exists nowhere we
 * don't control, which is what makes revocation's residual window our own
 * submission latency (CLAUDE.md §10). This module submits; it never
 * constructs plans and never touches policy.
 *
 * A userOp can fail inside a *successful* handleOps transaction (the
 * EntryPoint emits UserOperationEvent with success=false plus a
 * UserOperationRevertReason). `SubmitResult.opSuccess` reports the
 * operation's own outcome; callers must never infer it from the tx status.
 *
 * Testnet scope: synchronous, single op per tx, viem gas estimation. The
 * production relayer (nonce allocator, replace-by-fee, standby key) is a
 * later ticket — CLAUDE.md §8.3.
 */
import { decodeEventLog, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { entryPoint07Abi, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";

export interface SubmitResult {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  /** The handleOps transaction itself was mined without reverting. */
  readonly txSuccess: boolean;
  /** The user operation executed successfully (UserOperationEvent.success). */
  readonly opSuccess: boolean;
  /** Raw revert data from UserOperationRevertReason, if the op's execution reverted. */
  readonly opRevertReason: Hex | null;
  readonly userOpHash: Hex | null;
  readonly gasUsed: bigint;
}

export interface SubmitParams {
  readonly client: PublicClient;
  /** Relayer EOA wallet — pays L2 gas, receives the EntryPoint refund. */
  readonly relayer: WalletClient;
  readonly entryPoint: Address;
  readonly userOp: UserOperation<"0.7">;
}

export async function submitViaHandleOps(p: SubmitParams): Promise<SubmitResult> {
  const account = p.relayer.account;
  if (!account) throw new Error("relayer wallet has no account");
  const packed = toPackedUserOperation(p.userOp);

  // Simulate first so an EntryPoint FailedOp (validation failure) surfaces
  // with its reason instead of as an opaque on-chain revert.
  await p.client.simulateContract({
    address: p.entryPoint,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[packed], account.address],
    account,
  });

  const txHash = await p.relayer.writeContract({
    address: p.entryPoint,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[packed], account.address],
    account,
    chain: p.relayer.chain,
  });
  const receipt = await p.client.waitForTransactionReceipt({ hash: txHash });

  let opSuccess = false;
  let opRevertReason: Hex | null = null;
  let userOpHash: Hex | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== p.entryPoint.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: entryPoint07Abi, data: log.data, topics: log.topics });
      if (ev.eventName === "UserOperationEvent") {
        opSuccess = ev.args.success;
        userOpHash = ev.args.userOpHash;
      } else if (ev.eventName === "UserOperationRevertReason") {
        opRevertReason = ev.args.revertReason;
      }
    } catch {
      // not an EntryPoint event we care about
    }
  }

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    txSuccess: receipt.status === "success",
    opSuccess,
    opRevertReason,
    userOpHash,
    gasUsed: receipt.gasUsed,
  };
}
