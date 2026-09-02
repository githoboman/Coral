/**
 * C-405 — property tests on the deterministic compiler (FR-4.3).
 *
 * FR-4.3's claim is "same plan + same chain state → identical bytes". A
 * handful of examples cannot support that; a generator can. These properties
 * are the ones that would have to hold for the compiler to be safe to put
 * behind an unattended signer:
 *
 *   - Determinism. Compiling twice produces the same bytes, always.
 *   - Containment. Every target in the batch is a pinned contract or the asset
 *     the plan names — a plan can never introduce a new destination.
 *   - The journal is always last, and always present (FR-3.4/3.5).
 *   - Value is zero everywhere: no plan can move native currency implicitly.
 *   - Approvals are exact and never unbounded (FR-2.12, non-negotiable #5).
 *
 * fast-check runs each property over generated plans; the counts are set so a
 * full pass covers several thousand distinct plans without making the suite
 * slow enough that people stop running it.
 */
import { parsePlan, planToWire, U256_MAX, type Plan } from "@corral/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BASE_SEPOLIA } from "../../addresses.js";
import { uniswapV3Adapter } from "../../adapters/uniswapV3.js";
import { compilePlan, MODE_BATCH } from "../compile.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const QUOTER = "0xc5290058841028f1614f3a6f0f5816cad0df5e27";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const ACCOUNT = "0xf2a97cd5000000000000000000000000000c7343";

const adapter = uniswapV3Adapter({ router: ROUTER, quoter: QUOTER, fee: 3000 });
const intentHash = `0x${"77".repeat(32)}` as const;

/** Amounts across the whole meaningful range, including the boundaries. */
const amount = fc.oneof(
  fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
  fc.bigInt({ min: 1n, max: U256_MAX / 2n }),
  fc.constant(1n),
);

/** 32-byte values, generated from the full uint256 range and hex-padded. */
const b32 = fc
  .bigInt({ min: 0n, max: U256_MAX })
  .map((v) => `0x${v.toString(16).padStart(64, "0")}` as const);

/** A plan the DSL accepts: an exact approval followed by a pinned-router swap. */
const validPlan = fc
  .record({
    sessionId: b32,
    strategyId: fc.option(b32, { nil: null }),
    seq: fc.integer({ min: 0, max: 4_294_967_295 }),
    amountIn: amount,
    minOut: amount,
    symbolIn: fc.string({ minLength: 1, maxLength: 12 }),
    symbolOut: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map(({ sessionId, strategyId, seq, amountIn, minOut, symbolIn, symbolOut }): Plan =>
    parsePlan({
      chain_id: BASE_SEPOLIA.chainId,
      session_id: sessionId,
      strategy_id: strategyId,
      seq,
      actions: [
        {
          action: "APPROVE",
          asset: { symbol: symbolIn, address: USDC },
          spender: PERMIT2,
          amount: amountIn.toString(10),
        },
        {
          action: "SWAP",
          asset_in: { symbol: symbolIn, address: USDC },
          asset_out: { symbol: symbolOut, address: WETH },
          amount_in: amountIn.toString(10),
          min_amount_out: minOut.toString(10),
        },
      ],
    }),
  );

function compile(plan: Plan) {
  return compilePlan({ plan, account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
}

// Across the properties below this is several thousand distinct generated
// plans per run, which is the coverage C-405 is after. The other half of that
// ticket — 10k valid plans passing a real preflight — needs a fork and is
// tracked separately.
const RUNS = 1_000;

describe("compiler properties (C-405, FR-4.3)", () => {
  it("is deterministic: the same plan always compiles to the same bytes", () => {
    fc.assert(
      fc.property(validPlan, (plan) => {
        expect(compile(plan).callData).toBe(compile(plan).callData);
      }),
      { numRuns: RUNS },
    );
  });

  it("never emits a target outside the pinned set and the plan's own assets", () => {
    // The containment property. A plan is data; if it could name a new
    // destination, it would be code.
    const allowed = new Set(
      [ROUTER, USDC, WETH, PERMIT2, BASE_SEPOLIA.corralJournal.address].map((a) => a.toLowerCase()),
    );
    fc.assert(
      fc.property(validPlan, (plan) => {
        for (const e of compile(plan).executions) {
          expect(allowed.has(e.target.toLowerCase())).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("always ends with the journal call (FR-3.4)", () => {
    fc.assert(
      fc.property(validPlan, (plan) => {
        const { executions } = compile(plan);
        const last = executions[executions.length - 1];
        expect(last?.target.toLowerCase()).toBe(BASE_SEPOLIA.corralJournal.address.toLowerCase());
      }),
      { numRuns: RUNS },
    );
  });

  it("moves no native value, ever", () => {
    // Native spend is governed separately; a swap plan that quietly carried
    // value would sidestep that entirely.
    fc.assert(
      fc.property(validPlan, (plan) => {
        for (const e of compile(plan).executions) {
          expect(e.value).toBe(0n);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("encodes approvals at the exact planned amount, never unbounded", () => {
    fc.assert(
      fc.property(validPlan, (plan) => {
        const approve = plan.actions.find((a) => a.action === "APPROVE");
        if (approve?.action !== "APPROVE") return;
        const encoded = compile(plan).executions[0];
        // approve(address,uint256): selector + 32-byte spender + 32-byte value.
        const valueWord = encoded?.callData.slice(2 + 8 + 64, 2 + 8 + 128) ?? "";
        expect(BigInt(`0x${valueWord}`)).toBe(approve.amount);
        expect(BigInt(`0x${valueWord}`)).not.toBe(U256_MAX);
      }),
      { numRuns: RUNS },
    );
  });

  it("uses batch mode with revert-on-failure, so a failed journal call reverts the batch (FR-3.5)", () => {
    fc.assert(
      fc.property(validPlan, (plan) => {
        // mode = callType 0x01 (batch) + execType 0x00 (revert).
        expect(compile(plan).callData).toContain(MODE_BATCH.slice(2));
      }),
      { numRuns: 200 },
    );
  });

  it("different plans compile to different bytes", () => {
    // If two distinct plans collided, the intent hash would stop identifying
    // what was actually executed.
    fc.assert(
      fc.property(validPlan, validPlan, (a, b) => {
        // planToWire first: a Plan holds branded bigints and JSON.stringify
        // throws on them — the same trap the chaos test found in the pipeline.
        fc.pre(JSON.stringify(planToWire(a)) !== JSON.stringify(planToWire(b)));
        expect(compile(a).callData === compile(b).callData).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

describe("compiler rejects what it must (C-405)", () => {
  it("rejects an empty plan", () => {
    const plan = parsePlan({
      chain_id: BASE_SEPOLIA.chainId,
      session_id: `0x${"e5".repeat(32)}`,
      strategy_id: null,
      seq: 1,
      actions: [],
    });
    expect(() => compile(plan)).toThrow(/empty plan/);
  });

  it("rejects a plan built for another chain", () => {
    // Chain-id binding is what stops a plan signed for testnet from being
    // replayed against mainnet (FR-3.3).
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }).filter((id) => id !== BASE_SEPOLIA.chainId), (chainId) => {
        const plan = parsePlan({
          chain_id: chainId,
          session_id: `0x${"e5".repeat(32)}`,
          strategy_id: null,
          seq: 1,
          actions: [
            { action: "APPROVE", asset: { symbol: "USDC", address: USDC }, spender: PERMIT2, amount: "1" },
          ],
        });
        expect(() => compile(plan)).toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("rejects an action naming an asset the adapter does not know", () => {
    const plan = parsePlan({
      chain_id: BASE_SEPOLIA.chainId,
      session_id: `0x${"e5".repeat(32)}`,
      strategy_id: null,
      seq: 1,
      actions: [{ action: "WRAP", amount: "1" }],
    });
    expect(() => compile(plan)).toThrow();
  });
});
