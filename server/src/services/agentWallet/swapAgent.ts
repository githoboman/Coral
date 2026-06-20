import { randomUUID } from "crypto";
import { getPolicyChecker } from "./policyChecker.js";
import { getBudgetTracker } from "./budgetTracker.js";
import { getAgentPtbBuilder } from "./ptbBuilder.js";
import { getAgentExecutor, type ExecutionResult } from "./executor.js";
import { AgentDeepBookClient, type DeepBookSetup } from "./deepbookClient.js";
import { deepbookProtocolId, assetTypeFor, toWholeTokens } from "./config.js";
import { getAgentAlerts } from "./alerts.js";
import { getWalrusArchiver } from "./walrusArchiver.js";
import { AgentActionType } from "./types.js";
import type { AgentWalletRecord } from "./types.js";

/**
 * The swap agent runs the full guarded pipeline for a single DeepBook action:
 *
 *   1. off-chain pre-flight (fast reject, saves gas)
 *   2. budget allocation (soft reservation incl. pending orders)
 *   3. build PTB: validate_action -> DeepBook fragment -> record_spend -> log_action
 *   4. sign with the AGENT key and submit
 *
 * The on-chain validate_action/record_spend in step 3 are the authoritative guard;
 * steps 1-2 are optimizations layered in front. A rejection at any stage returns a
 * reason without touching chain state.
 */
export interface SwapRequest {
  wallet: AgentWalletRecord;
  deepbook: DeepBookSetup;
  /** Symbols, e.g. tokenIn "SUI", tokenOut "USDC". */
  tokenIn: string;
  tokenOut: string;
  /** Amount of tokenIn to spend, in base units. */
  amount: bigint;
  /** True for a market swap; false for a limit order (requires price). */
  market: boolean;
  /** Limit price (in pool price units) — required when market=false. */
  price?: number;
  /**
   * Optional on-chain time gate (epoch ms). When set, the guarded PTB enforces the
   * Sui Clock has reached this time — used by scheduled swaps so the on-chain
   * contract, not the backend timer, is the authority on "not before".
   */
  executeAfter?: bigint;
}

export interface SwapOutcome {
  ok: boolean;
  reason?: string;
  digest?: string;
  orderId?: string;
  events?: ExecutionResult["events"];
}

export class SwapAgent {
  async execute(req: SwapRequest): Promise<SwapOutcome> {
    const { wallet } = req;
    if (!wallet.policyId || !wallet.capabilityId) {
      return { ok: false, reason: "Agent wallet is not bound to a policy" };
    }

    const actionType = req.market ? AgentActionType.Swap : AgentActionType.LimitOrder;
    const protocol = deepbookProtocolId();
    const tokenInType = assetTypeFor(req.tokenIn);
    const tokenOutType = assetTypeFor(req.tokenOut);

    // 1. Off-chain pre-flight.
    const pre = await getPolicyChecker().preflight(wallet.policyId, {
      actionType,
      amount: req.amount,
      protocol,
      asset: tokenInType,
    });
    if (!pre.ok) return { ok: false, reason: pre.reason };

    // 2. Soft budget allocation (released on settle/fail).
    const allocationId = randomUUID();
    const tracker = getBudgetTracker();
    const allocated = await tracker.tryAllocate(wallet.policyId, allocationId, req.amount);
    if (!allocated) {
      return { ok: false, reason: "Insufficient available budget after pending allocations" };
    }

    try {
      const dbClient = new AgentDeepBookClient(req.deepbook);
      const clientOrderId = allocationId;

      // 3. The DeepBook fragment injected between validate and record.
      //
      // DeepBook denominates order `quantity` in WHOLE BASE tokens, regardless of
      // side. The agent, however, tracks `req.amount` as base units of *tokenIn*
      // (what the user spends). Reconcile the two:
      //   - SELL (isBid=false): tokenIn is the base asset. quantity = amount in
      //     whole base tokens.
      //   - BUY  (isBid=true):  tokenIn is the quote asset. The spend must be
      //     converted to a base quantity via price (limit) or a book estimate
      //     (market), since you can't express "spend N quote" as a base quantity
      //     directly.
      const baseSymbol = dbClient.baseSymbol();
      const quoteSymbol = dbClient.quoteSymbol();
      const isBid = req.tokenIn.toUpperCase() === quoteSymbol.toUpperCase(); // quote->base = bid

      let baseQuantity: number;
      if (!isBid) {
        // Selling base: amount is already denominated in the base asset.
        baseQuantity = toWholeTokens(req.amount, baseSymbol);
      } else {
        // Buying base with quote: amount is a quote spend. Convert to base.
        const quoteWhole = toWholeTokens(req.amount, quoteSymbol);
        if (req.market) {
          // No fixed price — ask the book how much base this quote buys.
          baseQuantity = await dbClient.baseOutForQuote(quoteWhole);
        } else {
          if (req.price == null) {
            tracker.release(wallet.policyId, allocationId);
            return { ok: false, reason: "Limit order requires a price" };
          }
          baseQuantity = quoteWhole / req.price; // base = quote / (quote-per-base)
        }
      }

      if (!(baseQuantity > 0)) {
        tracker.release(wallet.policyId, allocationId);
        return { ok: false, reason: "Resolved DeepBook quantity is zero — check amount/price and book liquidity" };
      }

      let body: (tx: any) => void;
      if (req.market) {
        body = dbClient.placeMarketOrderFragment({
          clientOrderId,
          quantity: baseQuantity,
          isBid,
        });
      } else {
        if (req.price == null) {
          tracker.release(wallet.policyId, allocationId);
          return { ok: false, reason: "Limit order requires a price" };
        }
        body = dbClient.placeLimitOrderFragment({
          clientOrderId,
          price: req.price,
          quantity: baseQuantity,
          isBid,
        });
      }

      const tx = getAgentPtbBuilder().build(
        {
          policyId: wallet.policyId,
          capabilityId: wallet.capabilityId,
          actionType,
          amount: req.amount,
          protocol,
          tokenIn: tokenInType,
          tokenOut: tokenOutType,
          executeAfter: req.executeAfter,
        },
        body,
      );

      // 4. Sign with agent key + submit.
      const result = await getAgentExecutor().execute(wallet, tx);

      if (!result.success) {
        // On-chain rejection (e.g. revoked cap, over budget) or network error.
        tracker.release(wallet.policyId, allocationId);
        getAgentAlerts().actionFailed(wallet.ownerAddress, result.error ?? "Unknown error", {
          policyId: wallet.policyId,
          tokenIn: req.tokenIn,
          tokenOut: req.tokenOut,
        });
        // Archive the failed attempt too — full traceability of the lifecycle.
        void getWalrusArchiver().archive({
          intent: `${req.market ? "swap" : "limit order"} ${req.amount} ${req.tokenIn}->${req.tokenOut}`,
          ownerAddress: wallet.ownerAddress,
          agentAddress: wallet.agentAddress,
          policyId: wallet.policyId,
          actionType,
          tokenIn: tokenInType,
          tokenOut: tokenOutType,
          amount: req.amount.toString(),
          status: "failed",
          reason: result.error,
          settledAt: new Date().toISOString(),
        });
        return { ok: false, reason: result.error };
      }

      // Market swaps settle immediately -> release the allocation; limit orders stay
      // allocated until the order manager observes a fill/cancel.
      if (req.market) tracker.release(wallet.policyId, allocationId);

      const orderId = result.created?.[0];

      // Notify + archive post-settlement. Both are additive and non-blocking; the
      // on-chain AgentActionEvent emitted inside the PTB is the authoritative record.
      getAgentAlerts().actionSucceeded(
        wallet.ownerAddress,
        req.market ? "Swap executed" : "Limit order placed",
        `${req.amount} ${req.tokenIn} -> ${req.tokenOut}`,
        { digest: result.digest, orderId },
      );
      void getWalrusArchiver().archive({
        intent: `${req.market ? "swap" : "limit order"} ${req.amount} ${req.tokenIn}->${req.tokenOut}`,
        ownerAddress: wallet.ownerAddress,
        agentAddress: wallet.agentAddress,
        policyId: wallet.policyId,
        actionType,
        tokenIn: tokenInType,
        tokenOut: tokenOutType,
        amount: req.amount.toString(),
        digest: result.digest,
        orderId,
        status: "executed",
        settledAt: new Date().toISOString(),
      });
      // Surface budget/expiry warnings after the spend lands.
      void getAgentAlerts().evaluatePolicy(wallet.ownerAddress, wallet.policyId);

      return { ok: true, digest: result.digest, orderId, events: result.events };
    } catch (err: any) {
      tracker.release(wallet.policyId, allocationId);
      return { ok: false, reason: err?.message || String(err) };
    }
  }
}

let instance: SwapAgent | null = null;
export function getSwapAgent(): SwapAgent {
  if (!instance) instance = new SwapAgent();
  return instance;
}
