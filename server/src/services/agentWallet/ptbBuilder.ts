import { Transaction } from "@mysten/sui/transactions";
import type { TransactionObjectArgument } from "@mysten/sui/transactions";
import { getAgentPolicyConfig, CLOCK_OBJECT_ID } from "./config.js";
import { AgentActionType, AgentActionStatus } from "./types.js";

/**
 * Wraps an agent action in the on-chain policy guard. Every agent PTB built here
 * has the same shape:
 *
 *   1. policy::validate_action(policy, cap, action, amount, protocol, asset, clock)
 *   2. <the action's own moveCalls — e.g. DeepBook place_limit_order>   (injected)
 *   3. policy::record_spend(policy, cap, amount)
 *   4. policy::log_action(policy, action, amount, token_in, token_out, status, clock)
 *
 * Because these share one Transaction, validation aborting (revoked cap, over
 * budget, out-of-scope asset/protocol) reverts the whole block — the action never
 * runs. This is the dual-enforcement contract the PRD requires: on-chain is the
 * guarantee, the pre-flight checker is the optimization in front of it.
 */
export interface ActionContext {
  policyId: string;
  capabilityId: string;
  actionType: AgentActionType;
  /** Spend amount in budget base units. */
  amount: bigint;
  /** Canonical protocol id string (must match policy whitelist). */
  protocol: string;
  /** Asset traded (token_in for a swap). */
  tokenIn: string;
  /** Counter-asset (token_out for a swap); same as tokenIn for non-pair actions. */
  tokenOut: string;
  /**
   * Optional on-chain time gate (epoch ms). When set, the PTB uses
   * validate_action_after so the action can only execute once the Sui Clock has
   * reached this timestamp — the authoritative guard for scheduled swaps (§8c).
   */
  executeAfter?: bigint;
}

/** Injects the protocol-specific moveCalls (e.g. the DeepBook order) into the tx. */
export type ActionBody = (tx: Transaction) => void;

export class AgentPtbBuilder {
  /**
   * Build the guarded transaction. The caller supplies an ActionBody that adds the
   * actual protocol calls between validate and record. recordAmount defaults to
   * ctx.amount but can differ (e.g. record only the filled portion of an order).
   */
  build(ctx: ActionContext, body: ActionBody, recordAmount: bigint = ctx.amount): Transaction {
    const { packageId } = getAgentPolicyConfig();
    const tx = new Transaction();

    const policy = tx.object(ctx.policyId);
    const cap = tx.object(ctx.capabilityId);
    const clock = tx.object(CLOCK_OBJECT_ID);

    // 1. Pre-action on-chain validation — aborts the whole PTB on any violation.
    // When a time gate is set, use the Clock-checked variant so a scheduled action
    // cannot execute before its target time even if the backend fires early.
    if (ctx.executeAfter != null) {
      tx.moveCall({
        target: `${packageId}::policy::validate_action_after`,
        arguments: [
          policy,
          cap,
          tx.pure.u8(ctx.actionType),
          tx.pure.u64(ctx.amount),
          tx.pure.string(ctx.protocol),
          tx.pure.string(ctx.tokenIn),
          tx.pure.u64(ctx.executeAfter),
          clock,
        ],
      });
    } else {
      tx.moveCall({
        target: `${packageId}::policy::validate_action`,
        arguments: [
          policy,
          cap,
          tx.pure.u8(ctx.actionType),
          tx.pure.u64(ctx.amount),
          tx.pure.string(ctx.protocol),
          tx.pure.string(ctx.tokenIn),
          clock,
        ],
      });
    }

    // 2. The action itself (DeepBook swap / limit order / cancel).
    body(tx);

    // 3. Atomic spend accounting — re-checks budget on-chain, aborts if over cap.
    if (recordAmount > 0n) {
      tx.moveCall({
        target: `${packageId}::policy::record_spend`,
        arguments: [policy, cap, tx.pure.u64(recordAmount)],
      });
    }

    // 4. Structured activity log event.
    tx.moveCall({
      target: `${packageId}::policy::log_action`,
      arguments: [
        policy,
        tx.pure.u8(ctx.actionType),
        tx.pure.u64(recordAmount),
        tx.pure.string(ctx.tokenIn),
        tx.pure.string(ctx.tokenOut),
        tx.pure.u8(AgentActionStatus.Executed),
        clock,
      ],
    });

    return tx;
  }

  /**
   * A cancel doesn't spend budget but must still be validated (active policy, cap
   * present, action permitted) and logged. recordAmount is 0 so no spend is taken.
   */
  buildCancel(
    ctx: Omit<ActionContext, "actionType" | "amount"> & { amount?: bigint },
    body: ActionBody,
  ): Transaction {
    return this.build(
      { ...ctx, actionType: AgentActionType.Cancel, amount: ctx.amount ?? 0n },
      body,
      0n,
    );
  }
}

/** Helper for action bodies to reference the shared policy/cap/clock if needed. */
export function policyObjects(tx: Transaction, ctx: ActionContext): {
  policy: TransactionObjectArgument;
  cap: TransactionObjectArgument;
  clock: TransactionObjectArgument;
} {
  return {
    policy: tx.object(ctx.policyId),
    cap: tx.object(ctx.capabilityId),
    clock: tx.object(CLOCK_OBJECT_ID),
  };
}

let instance: AgentPtbBuilder | null = null;
export function getAgentPtbBuilder(): AgentPtbBuilder {
  if (!instance) instance = new AgentPtbBuilder();
  return instance;
}
