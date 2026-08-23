import { describe, expect, it } from "vitest";
import { getActionId } from "@rhinestone/module-sdk";
import { encodePacked, keccak256 } from "viem";
import { actionConfigId, actionId, actionPolicyId, userOpConfigId } from "../ids.js";

const T = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
const SEL = "0x04e45aaf" as const;
const ACCT = "0xf2A97cd5439C01D5CE8bE75e0f7a8Dc8294C7343" as const;
const PID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

describe("SmartSessions id derivations", () => {
  it("actionId agrees with the pinned SDK", async () => {
    expect(actionId(T, SEL)).toBe(await getActionId({ target: T, selector: SEL }));
  });
  it("actionId is keccak(target ‖ selector) — the on-chain IdLib formula", () => {
    expect(actionId(T, SEL)).toBe(keccak256(encodePacked(["address", "bytes4"], [T, SEL])));
  });
  it("config ids chain exactly as IdLib does", () => {
    const a = actionId(T, SEL);
    const ap = actionPolicyId(PID, a);
    expect(ap).toBe(keccak256(encodePacked(["bytes32", "bytes32"], [PID, a])));
    expect(actionConfigId(ACCT, PID, a)).toBe(keccak256(encodePacked(["address", "bytes32"], [ACCT, ap])));
    expect(userOpConfigId(ACCT, PID)).toBe(keccak256(encodePacked(["address", "bytes32"], [ACCT, PID])));
  });
  it("ids are account-scoped: a different account yields different config ids", () => {
    const other = "0x0000000000000000000000000000000000000001";
    expect(userOpConfigId(ACCT, PID)).not.toBe(userOpConfigId(other, PID));
  });
});
