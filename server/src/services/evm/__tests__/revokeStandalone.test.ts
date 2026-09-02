/**
 * FR-8.3: the standalone revoke page's hand-written encoder must produce
 * exactly what viem would — this test imports the page's real JS (no copy)
 * and compares against viem's ABI encoding. Selectors are pinned too.
 */
import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector } from "viem";
// The page is dependency-free JS under app/public; import it directly.
import { approvedHashSignature, buildRevokeTx, execTransactionCalldata, isPermissionEnabledCalldata, removeSessionCalldata } from "../../../../../app/public/revoke/revoke.js";

const SS = "0x00000000008bDABA73cD9815d79069c247Eb4bDA" as const;
const ACCOUNT = "0xF633373a0b34D3179Bd02b316EE6aCf9ebfD0A70" as const;
const OWNER = "0x91ac808850c33E15dc028a12Bfcaad70F1F8e6f9" as const;
const PID = "0xdce309d248f07d4716aba34f64aea5c1b3e5ed10205baad96a7795da6a79daa4" as const;

const safeExecAbi = [{
  type: "function", name: "execTransaction", stateMutability: "payable",
  inputs: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "signatures", type: "bytes" },
  ], outputs: [{ type: "bool" }],
}] as const;
const ssAbi = [
  { type: "function", name: "isPermissionEnabled", stateMutability: "view", inputs: [{ name: "permissionId", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "removeSession", stateMutability: "nonpayable", inputs: [{ name: "permissionId", type: "bytes32" }], outputs: [] },
] as const;

describe("standalone revoke page encoder == viem", () => {
  it("pins the selectors", () => {
    expect(toFunctionSelector("isPermissionEnabled(bytes32,address)")).toBe("0xadbc532f");
    expect(toFunctionSelector("removeSession(bytes32)")).toBe("0xf867b08e");
    expect(toFunctionSelector("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)")).toBe("0x6a761202");
  });

  it("isPermissionEnabled / removeSession calldata match viem", () => {
    expect(isPermissionEnabledCalldata(PID, ACCOUNT).toLowerCase()).toBe(encodeFunctionData({ abi: ssAbi, functionName: "isPermissionEnabled", args: [PID, ACCOUNT] }).toLowerCase());
    expect(removeSessionCalldata(PID).toLowerCase()).toBe(encodeFunctionData({ abi: ssAbi, functionName: "removeSession", args: [PID] }).toLowerCase());
  });

  it("execTransaction with the pre-approved-hash signature matches viem byte for byte", () => {
    const sig = approvedHashSignature(OWNER) as `0x${string}`;
    expect(sig.length).toBe(2 + 65 * 2);
    const ours = execTransactionCalldata({ to: SS, data: removeSessionCalldata(PID), signatures: sig });
    const ref = encodeFunctionData({
      abi: safeExecAbi, functionName: "execTransaction",
      args: [SS, 0n, encodeFunctionData({ abi: ssAbi, functionName: "removeSession", args: [PID] }), 0, 0n, 0n, 0n, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", sig],
    });
    expect(ours.toLowerCase()).toBe(ref.toLowerCase());
  });

  it("buildRevokeTx targets the account, from the owner, on a supported chain only", () => {
    const tx = buildRevokeTx({ chainId: 84532, account: ACCOUNT, owner: OWNER, permissionId: PID });
    expect(tx.to).toBe(ACCOUNT);
    expect(tx.from).toBe(OWNER);
    expect(tx.data.startsWith("0x6a761202")).toBe(true);
    expect(() => buildRevokeTx({ chainId: 8453, account: ACCOUNT, owner: OWNER, permissionId: PID })).toThrow();
  });
});
