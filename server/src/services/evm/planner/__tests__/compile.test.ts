import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parsePlan } from "@corral/core";
import { decodeAbiParameters, decodeFunctionData, keccak256, stringToHex } from "viem";
import { BASE_SEPOLIA } from "../../addresses.js";
import { corralJournalAbi } from "../../abi/corralJournal.js";
import { uniswapV3Adapter } from "../../adapters/uniswapV3.js";
import { MODE_BATCH, compilePlan } from "../compile.js";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4" as const;
const ACCOUNT = "0x20E552c77b0Ac46F4088aA66f809D15Ab5338564" as const;
const adapter = uniswapV3Adapter({ router: ROUTER, quoter: "0xc5290058841028f1614f3a6f0f5816cad0df5e27", fee: 3000 });
const SESSION = "0x9a4efa0aef21562313d5c3a48ea5b0d7c1c40c70c9c45d4a2636cad93b5087f6";

function planWire(amountIn: bigint, minOut: bigint, seq = 1) {
  return {
    chain_id: 84532,
    session_id: SESSION,
    strategy_id: null,
    seq,
    actions: [
      { action: "APPROVE", asset: { symbol: "USDC", address: USDC }, spender: ROUTER, amount: amountIn.toString() },
      { action: "SWAP", asset_in: { symbol: "USDC", address: USDC }, asset_out: { symbol: "WETH", address: WETH }, amount_in: amountIn.toString(), min_amount_out: minOut.toString() },
    ],
  };
}
const intentHash = keccak256(stringToHex("intent-1"));

describe("compilePlan", () => {
  it("produces a batch execute with the journal entry appended last (FR-3.4)", () => {
    const c = compilePlan({ plan: parsePlan(planWire(125_000_000n, 1n)), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
    expect(c.executions).toHaveLength(3);
    const last = c.executions[2]!;
    expect(last.target.toLowerCase()).toBe(BASE_SEPOLIA.corralJournal.address.toLowerCase());
    const d = decodeFunctionData({ abi: corralJournalAbi, data: last.callData });
    expect(d.functionName).toBe("log");
    expect(d.args).toStrictEqual([SESSION, intentHash, `0x${"0".repeat(64)}`, 1]);
    // outer calldata is execute(MODE_BATCH, abi.encode(Execution[]))
    const outer = decodeFunctionData({
      abi: [{ type: "function", name: "execute", stateMutability: "payable", inputs: [{ name: "mode", type: "bytes32" }, { name: "executionCalldata", type: "bytes" }], outputs: [] }] as const,
      data: c.callData,
    });
    expect(outer.args[0]).toBe(MODE_BATCH);
    const [execs] = decodeAbiParameters([{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }] as const, outer.args[1]);
    expect(execs).toHaveLength(3);
  });

  it("is deterministic: identical plan → identical bytes (FR-4.3)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 125_000_000n }), fc.bigInt({ min: 1n, max: 10n ** 18n }), fc.integer({ min: 0, max: 1000 }), (amt, minOut, seq) => {
        const a = compilePlan({ plan: parsePlan(planWire(amt, minOut, seq)), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
        const b = compilePlan({ plan: parsePlan(planWire(amt, minOut, seq)), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
        expect(a.callData).toBe(b.callData);
      }),
    );
  });

  it("any change to the plan changes the bytes", () => {
    const a = compilePlan({ plan: parsePlan(planWire(100n, 1n)), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
    const b = compilePlan({ plan: parsePlan(planWire(101n, 1n)), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash });
    expect(a.callData).not.toBe(b.callData);
  });

  it("rejects an empty plan and a plan for another chain", () => {
    expect(() => compilePlan({ plan: parsePlan({ ...planWire(1n, 1n), actions: [] }), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash })).toThrow();
    expect(() => compilePlan({ plan: parsePlan({ ...planWire(1n, 1n), chain_id: 8453 }), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash })).toThrow();
  });

  it("rejects an action the adapter cannot encode — no bytes for unknown venues", () => {
    const w = planWire(1n, 1n);
    (w.actions as unknown[]).push({ action: "WRAP", amount: "1" });
    expect(() => compilePlan({ plan: parsePlan(w), account: ACCOUNT, adapter, addresses: BASE_SEPOLIA, intentHash })).toThrow();
  });
});
