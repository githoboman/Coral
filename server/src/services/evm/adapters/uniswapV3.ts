/**
 * Uniswap v3 adapter (FR-5.2): `SwapRouter02.exactInputSingle` only,
 * recipient pinned to the account, `amountOutMinimum` from a QuoterV2 quote
 * floored by the policy's `min_output_bps`.
 *
 * Token flow: SwapRouter02 pulls `tokenIn` with `transferFrom`, so the
 * preceding Action is an EXACT `approve(router, amountIn)` — never more,
 * never unbounded (CLAUDE.md §2.5), and the session's UniversalActionPolicy
 * LTE rule caps it per execution anyway. (Permit2 belongs to the Universal
 * Router, not SwapRouter02 — the spec §4.3 example was corrected accordingly.)
 */
import { tokenAmount, type Action, type TargetConstraint, type ValidatedPolicy } from "@corral/core";
import { encodeFunctionData, toFunctionSelector, type Address, type Hex, type PublicClient } from "viem";

import { quoterV2Abi } from "../abi/quoterV2.js";
import { swapRouter02Abi } from "../abi/swapRouter02.js";
import type { ProtocolAdapter, Quote, SwapRequest } from "./protocolAdapter.js";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const SELECTOR_APPROVE = toFunctionSelector("approve(address,uint256)");
export const SELECTOR_EXACT_INPUT_SINGLE = toFunctionSelector(
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
);

export interface UniswapV3Config {
  readonly router: Address;
  readonly quoter: Address;
  /** Pool fee tier in hundredths of a bip (500 | 3000 | 10000). One per adapter instance: policies pin one value. */
  readonly fee: 500 | 3000 | 10000;
}

const BPS = 10_000n;
const lc = (s: string): string => s.toLowerCase();

export function uniswapV3Adapter(cfg: UniswapV3Config): ProtocolAdapter {
  const venue = `uniswap-v3/${cfg.fee}`;

  return {
    venue,

    async quote(client: PublicClient, req: SwapRequest): Promise<Quote> {
      // QuoterV2 functions are non-view (they revert-to-return internally);
      // eth_call via simulateContract reads them without a transaction.
      const tokenIn = req.assetIn.address;
      const tokenOut = req.assetOut.address;
      if (tokenIn === null || tokenOut === null) throw new Error("native assets are not supported by this adapter");
      const { result } = await client.simulateContract({
        address: cfg.quoter,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, amountIn: req.amountIn, fee: cfg.fee, sqrtPriceLimitX96: 0n }],
      });
      const amountOut = result[0];
      const minAmountOut = (amountOut * BigInt(req.minOutputBps)) / BPS;
      return { amountOut, minAmountOut, venue };
    },

    buildActions(req: SwapRequest, quote: Quote): readonly Action[] {
      const assetIn = req.assetIn;
      const assetOut = req.assetOut;
      return [
        { action: "APPROVE", asset: assetIn, spender: cfg.router, amount: tokenAmount(req.amountIn) },
        { action: "SWAP", asset_in: assetIn, asset_out: assetOut, amount_in: tokenAmount(req.amountIn), min_amount_out: tokenAmount(quote.minAmountOut) },
      ];
    },

    encodeAction(action: Action, account: Address): { to: Address; data: Hex; value: bigint } {
      switch (action.action) {
        case "APPROVE":
          if (action.asset.address === null) throw new Error("cannot approve the native asset");
          return {
            to: action.asset.address as Address,
            value: 0n,
            data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [action.spender as Address, action.amount] }),
          };
        case "SWAP": {
          if (action.asset_in.address === null || action.asset_out.address === null) throw new Error("native swaps are not supported by this adapter");
          return {
            to: cfg.router,
            value: 0n,
            data: encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn: action.asset_in.address as Address,
                  tokenOut: action.asset_out.address as Address,
                  fee: cfg.fee,
                  recipient: account, // the anti-exfiltration pin (§2.6) — never a parameter
                  amountIn: action.amount_in,
                  amountOutMinimum: action.min_amount_out,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
          };
        }
        case "TRANSFER":
        case "WRAP":
        case "UNWRAP":
          throw new Error(`${action.action} is not an action of the Uniswap v3 adapter`);
      }
    },

    describeForUser(req: SwapRequest, quote: Quote): string {
      return `Swap ${req.amountIn.toString(10)} base units of ${req.assetIn.symbol} for at least ${quote.minAmountOut.toString(10)} base units of ${req.assetOut.symbol} on Uniswap v3 (${cfg.fee / 10_000}% pool), delivered to your own account.`;
    },

    requiredTargets(req): readonly TargetConstraint[] {
      return [
        {
          address: lc(req.tokenIn),
          selector: SELECTOR_APPROVE,
          action: "APPROVE",
          param_rules: [
            { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: lc(cfg.router) }] },
            { rule: "LTE", param_index: 1, max: tokenAmount(req.maxPerExecution) },
          ],
        },
        {
          address: lc(cfg.router),
          selector: SELECTOR_EXACT_INPUT_SINGLE,
          action: "SWAP",
          param_rules: [
            { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: lc(req.tokenIn) }] },
            { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: lc(req.tokenOut) }] },
            { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: cfg.fee }] },
            { rule: "EQ_ACCOUNT", param_index: 3 },
            { rule: "LTE", param_index: 4, max: tokenAmount(req.maxPerExecution) },
            { rule: "GTE", param_index: 5, min: tokenAmount(req.minAmountOutFloor) },
          ],
        },
      ];
    },

    isCompatible(policy: ValidatedPolicy, req): { ok: true } | { ok: false; reason: string } {
      const approve = policy.target_scope.find((t) => t.address === lc(req.tokenIn) && t.selector === SELECTOR_APPROVE && t.action === "APPROVE");
      if (!approve) return { ok: false, reason: `policy has no APPROVE target for ${req.tokenIn}` };
      const spenderOk = approve.param_rules.some(
        (r) => r.rule === "IN_SET" && r.param_index === 0 && r.allowed.length === 1 && r.allowed[0]?.kind === "address" && r.allowed[0].value === lc(cfg.router),
      );
      if (!spenderOk) return { ok: false, reason: `policy does not allow approving ${cfg.router} (SwapRouter02) as spender` };
      const swap = policy.target_scope.find((t) => t.address === lc(cfg.router) && t.selector === SELECTOR_EXACT_INPUT_SINGLE && t.action === "SWAP");
      if (!swap) return { ok: false, reason: "policy has no exactInputSingle target on SwapRouter02" };
      const pin = (i: number, v: string): boolean =>
        swap.param_rules.some((r) => r.rule === "IN_SET" && r.param_index === i && r.allowed.length === 1 && String(r.allowed[0]?.value).toLowerCase() === v);
      if (!pin(0, lc(req.tokenIn))) return { ok: false, reason: `policy does not allow ${req.tokenIn} as tokenIn` };
      if (!pin(1, lc(req.tokenOut))) return { ok: false, reason: `policy does not allow ${req.tokenOut} as tokenOut` };
      if (!pin(2, String(cfg.fee))) return { ok: false, reason: `policy does not allow the ${cfg.fee} fee tier` };
      if (!swap.param_rules.some((r) => r.rule === "EQ_ACCOUNT" && r.param_index === 3)) return { ok: false, reason: "policy lacks the recipient == account pin" };
      if (!swap.param_rules.some((r) => r.rule === "GTE" && r.param_index === 5)) return { ok: false, reason: "policy lacks an amountOutMinimum floor" };
      return { ok: true };
    },
  };
}
