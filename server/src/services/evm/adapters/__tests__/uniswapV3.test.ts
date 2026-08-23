/**
 * Uniswap v3 adapter (FR-5.2/5.3/5.4): pure encoding is deterministic and
 * exact; the adapter's required targets form a policy that parses and that
 * the adapter itself accepts; mismatches are caught at creation time.
 */
import { describe, expect, it } from "vitest";
import { parsePolicy, tokenAmount } from "@corral/core";
import { createPublicClient, decodeFunctionData, http } from "viem";
import { baseSepolia } from "viem/chains";
import { swapRouter02Abi } from "../../abi/swapRouter02.js";
import { SELECTOR_APPROVE, SELECTOR_EXACT_INPUT_SINGLE, uniswapV3Adapter } from "../uniswapV3.js";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4" as const;
const QUOTER = "0xc5290058841028f1614f3a6f0f5816cad0df5e27" as const;
const ACCOUNT = "0x6E2A6F54703e67f1Bfcc92c4a2Bd602E7546f360" as const;

const adapter = uniswapV3Adapter({ router: ROUTER, quoter: QUOTER, fee: 3000 });
const req = { account: ACCOUNT, assetIn: { symbol: "USDC", address: USDC }, assetOut: { symbol: "WETH", address: WETH }, amountIn: 125_000_000n, minOutputBps: 9800 } as const;
const quote = { amountOut: 50_000_000_000_000_000n, minAmountOut: 49_000_000_000_000_000n, venue: adapter.venue };

describe("uniswapV3Adapter — actions and encoding", () => {
  it("builds [APPROVE router exact amount, SWAP] — never more than the swap needs", () => {
    const actions = adapter.buildActions(req, quote);
    expect(actions.map((a) => a.action)).toStrictEqual(["APPROVE", "SWAP"]);
    const approve = actions[0]!;
    if (approve.action !== "APPROVE") throw new Error();
    expect(approve.spender).toBe(ROUTER);
    expect(approve.amount).toBe(tokenAmount(125_000_000n));
    const swap = actions[1]!;
    if (swap.action !== "SWAP") throw new Error();
    expect(swap.min_amount_out).toBe(tokenAmount(quote.minAmountOut));
  });

  it("encodes exactInputSingle with the recipient pinned to the account — a constant, not an input", () => {
    const [, swap] = adapter.buildActions(req, quote);
    const { to, data, value } = adapter.encodeAction(swap!, ACCOUNT);
    expect(to).toBe(ROUTER);
    expect(value).toBe(0n);
    expect(data.slice(0, 10)).toBe(SELECTOR_EXACT_INPUT_SINGLE);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data });
    const p = (decoded.args as readonly [Record<string, unknown>])[0];
    expect(String(p["recipient"]).toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(p["fee"]).toBe(3000);
    expect(p["amountIn"]).toBe(125_000_000n);
    expect(p["amountOutMinimum"]).toBe(quote.minAmountOut);
    expect(p["sqrtPriceLimitX96"]).toBe(0n);
  });

  it("encoding is deterministic: same action → identical bytes (FR-4.3)", () => {
    const [approve, swap] = adapter.buildActions(req, quote);
    expect(adapter.encodeAction(swap!, ACCOUNT)).toStrictEqual(adapter.encodeAction(swap!, ACCOUNT));
    expect(adapter.encodeAction(approve!, ACCOUNT).data.slice(0, 10)).toBe(SELECTOR_APPROVE);
  });

  it("refuses actions outside its venue", () => {
    expect(() => adapter.encodeAction({ action: "WRAP", amount: tokenAmount(1n) }, ACCOUNT)).toThrow();
  });
});

describe("uniswapV3Adapter — policy compatibility (FR-5.3)", () => {
  const targets = adapter.requiredTargets({ tokenIn: USDC, tokenOut: WETH, maxPerExecution: 125_000_000n, minAmountOutFloor: 1n });
  const policyWire = (overrideTargets = targets) => ({
    version: 1,
    chain_id: 84532,
    asset_scope: [{ symbol: "USDC", address: USDC }],
    budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "500000000" }],
    max_native_value: "0",
    target_scope: overrideTargets.map((t) => ({
      ...t,
      param_rules: t.param_rules.map((r) => (r.rule === "LTE" ? { ...r, max: r.max.toString(10) } : r.rule === "GTE" ? { ...r, min: r.min.toString(10) } : r)),
    })),
    action_scope: ["APPROVE", "SWAP"],
    valid_after: 1_750_000_000,
    valid_until: 1_900_000_000,
    max_executions: 8,
    max_executions_per_24h: 2,
    min_output_bps: 9800,
  });

  it("its required targets form a policy that parses (all six invariants) and that it accepts", () => {
    const policy = parsePolicy(policyWire());
    expect(adapter.isCompatible(policy, { tokenIn: USDC, tokenOut: WETH })).toStrictEqual({ ok: true });
  });

  it("a policy allowing a different spender is incompatible — caught at creation, not execution", () => {
    const wrong = targets.map((t) =>
      t.action === "APPROVE"
        ? { ...t, param_rules: t.param_rules.map((r) => (r.rule === "IN_SET" ? { ...r, allowed: [{ kind: "address" as const, value: "0x000000000022d473030f116ddee9f6b43ac78ba3" }] } : r)) }
        : t,
    );
    const res = adapter.isCompatible(parsePolicy(policyWire(wrong)), { tokenIn: USDC, tokenOut: WETH });
    expect(res.ok).toBe(false);
  });

  it("a policy for another pair is incompatible", () => {
    const res = adapter.isCompatible(parsePolicy(policyWire()), { tokenIn: WETH, tokenOut: USDC });
    expect(res.ok).toBe(false);
  });
});

const RPC = process.env.EVM_RPC_URL;
describe.skipIf(!RPC)("uniswapV3Adapter — live quote on Base Sepolia", () => {
  it("quotes 1 USDC → WETH on the 0.3% pool and floors by min_output_bps", async () => {
    const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
    const q = await adapter.quote(client, { ...req, amountIn: 1_000_000n });
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.minAmountOut).toBe((q.amountOut * 9800n) / 10_000n);
  }, 60_000);
});
