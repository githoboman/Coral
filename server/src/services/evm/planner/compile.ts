/**
 * Deterministic compiler: `Plan` → ERC-7579 batch execute calldata (FR-4.3).
 *
 * Same plan + same adapter config → identical bytes, always. Pure: no chain
 * access, no time, no randomness. The journal call (FR-3.4) is appended as
 * the last execution of every batch here — the planner never models it and
 * nothing else may omit it. A plan containing an action the adapter cannot
 * encode is rejected before any bytes are produced.
 */
import type { Plan } from "@corral/core";
import { encodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem";

import { corralJournalAbi } from "../abi/corralJournal.js";
import type { ProtocolAdapter } from "../adapters/protocolAdapter.js";
import type { ChainAddresses } from "../addresses.js";

export interface Execution {
  readonly target: Address;
  readonly value: bigint;
  readonly callData: Hex;
}

export interface Compiled {
  /** Calldata for `account.execute(mode, executionCalldata)` — what the userOp carries. */
  readonly callData: Hex;
  /** The batch, in order; last is always the journal entry. */
  readonly executions: readonly Execution[];
  readonly intentHash: Hex;
}

/** ERC-7579 batch mode: callType 0x01 (batch), execType 0x00 (revert on failure). */
export const MODE_BATCH: Hex = `0x01${"0".repeat(62)}`;

const EXECUTION_ABI = [
  {
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" },
    ],
  },
] as const;

const ERC7579_EXECUTE_ABI = [
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
] as const;

export interface CompileInput {
  readonly plan: Plan;
  readonly account: Address;
  readonly adapter: ProtocolAdapter;
  readonly addresses: ChainAddresses;
  /** keccak of the canonical intent that produced this plan (journaled). */
  readonly intentHash: Hex;
}

export function compilePlan(input: CompileInput): Compiled {
  const { plan, account, adapter, addresses, intentHash } = input;
  if (plan.actions.length === 0) throw new Error("empty plan");
  if (plan.chain_id !== addresses.chainId) throw new Error(`plan chain ${plan.chain_id} ≠ ${addresses.chainId}`);

  const executions: Execution[] = plan.actions.map((a) => {
    const enc = adapter.encodeAction(a, account);
    return { target: enc.to, value: enc.value, callData: enc.data };
  });

  executions.push({
    target: addresses.corralJournal.address,
    value: 0n,
    callData: encodeFunctionData({
      abi: corralJournalAbi,
      functionName: "log",
      args: [plan.session_id as Hex, intentHash, (plan.strategy_id ?? `0x${"0".repeat(64)}`) as Hex, plan.seq],
    }),
  });

  const executionCalldata = encodeAbiParameters(EXECUTION_ABI, [executions.map((e) => ({ target: e.target, value: e.value, callData: e.callData }))]);
  const callData = encodeFunctionData({ abi: ERC7579_EXECUTE_ABI, functionName: "execute", args: [MODE_BATCH, executionCalldata] });
  return { callData, executions, intentHash };
}
