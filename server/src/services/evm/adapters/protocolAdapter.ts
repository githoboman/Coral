/**
 * ProtocolAdapter (FR-5.1, FR-5.3, FR-5.4).
 *
 * An adapter knows one venue: how to quote, which `@corral/core` Actions
 * realise a trade there, how to encode those Actions into calldata, how to
 * read the result back, and — crucially — which policy constraints it
 * requires. Adapters are pure: no signing, no writes, no state. The only
 * chain access is the read-only quoter passed to `quote()`.
 */
import type { Action, AssetRef, TargetConstraint, ValidatedPolicy } from "@corral/core";
import type { Address, Hex, PublicClient } from "viem";
// Chain-facing fields use viem's hex-typed Address; @corral/core's Address is
// the lowercase-normalized string inside policies and is converted at the edge.

export interface SwapRequest {
  readonly account: Address;
  /** Core asset refs (symbol is display-only; identity is the address). */
  readonly assetIn: AssetRef;
  readonly assetOut: AssetRef;
  readonly amountIn: bigint;
  /** Policy floor in basis points of the quoted output (FR-9.3 min_output_bps). */
  readonly minOutputBps: number;
}

export interface Quote {
  readonly amountOut: bigint;
  /** amountOut × minOutputBps / 10000 — what goes on-chain as amountOutMinimum. */
  readonly minAmountOut: bigint;
  readonly venue: string;
}

export interface SwapResult {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface ProtocolAdapter {
  readonly venue: string;
  quote(client: PublicClient, req: SwapRequest): Promise<Quote>;
  /** The Actions (closed DSL) that realise this swap, in execution order. */
  buildActions(req: SwapRequest, quote: Quote): readonly Action[];
  /** Calldata for one Action at this venue. Deterministic (FR-4.3). */
  encodeAction(action: Action, account: Address): { to: Address; data: Hex; value: bigint };
  /** Human sentence for the feed / review screen (FR-11.1, never hex). */
  describeForUser(req: SwapRequest, quote: Quote): string;
  /**
   * The target constraints a session policy must contain for this adapter to
   * be usable. Checked at strategy creation (FR-5.3): a mismatch is a hard
   * error then, never a surprise at execution.
   */
  requiredTargets(req: { tokenIn: Address; tokenOut: Address; maxPerExecution: bigint; minAmountOutFloor: bigint }): readonly TargetConstraint[];
  /** Does `policy` contain every required target with at-least-as-strict rules? */
  isCompatible(policy: ValidatedPolicy, req: { tokenIn: Address; tokenOut: Address }): { ok: true } | { ok: false; reason: string };
}
