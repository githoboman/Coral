// Corral standalone kill switch (FR-8.1/8.3/8.4, journey J3).
//
// DELIBERATELY DEPENDENCY-FREE AND DUPLICATED (CLAUDE.md §9): no viem, no
// bundler, no Corral API, no Corral RPC. It talks to the user's injected
// wallet (EIP-1193) and hand-encodes two calls:
//   1. SmartSessions.isPermissionEnabled(permissionId, account)   [eth_call]
//   2. Safe.execTransaction(to=SmartSessions, data=removeSession(permissionId), ...)
//      signed with the Safe "pre-approved hash" signature type: when the
//      transaction sender IS an owner, signatures = r=owner, s=0, v=1.
//      The owner's wallet just sends a normal transaction. Nothing else.
// Addresses are hardcoded per chain. Edit them only with a codehash review.

export const CHAINS = {
  84532: {
    name: "Base Sepolia",
    smartSessions: "0x00000000008bDABA73cD9815d79069c247Eb4bDA",
    explorer: "https://sepolia.basescan.org/tx/",
  },
};

const SEL_IS_PERMISSION_ENABLED = "0xadbc532f"; // isPermissionEnabled(bytes32,address)
const SEL_REMOVE_SESSION = "0xf867b08e"; // removeSession(bytes32)
const SEL_EXEC_TRANSACTION = "0x6a761202"; // execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)

const strip = (h) => h.replace(/^0x/, "");
const pad32 = (hex) => strip(hex).toLowerCase().padStart(64, "0");
const uint = (n) => BigInt(n).toString(16).padStart(64, "0");
const addr = (a) => pad32(a);

/** ABI-encode a dynamic `bytes` value: length word + data padded to 32 bytes. */
function bytesWord(hex) {
  const h = strip(hex);
  const len = h.length / 2;
  const padded = h + "0".repeat((64 - (h.length % 64)) % 64);
  return uint(len) + padded;
}

export function isPermissionEnabledCalldata(permissionId, account) {
  return SEL_IS_PERMISSION_ENABLED + pad32(permissionId) + addr(account);
}

export function removeSessionCalldata(permissionId) {
  return SEL_REMOVE_SESSION + pad32(permissionId);
}

/** Safe pre-approved-hash signature for `owner` (valid only when msg.sender == owner). */
export function approvedHashSignature(owner) {
  return "0x" + addr(owner) + "0".repeat(64) + "01";
}

/**
 * execTransaction(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures)
 * Head: 10 words; dynamic `data` and `signatures` live in the tail.
 */
export function execTransactionCalldata({ to, data, signatures }) {
  const headWords = 10;
  const dataTail = bytesWord(data);
  const dataOffset = headWords * 32;
  const sigOffset = dataOffset + dataTail.length / 2;
  const head =
    addr(to) + // to
    uint(0) + // value
    uint(dataOffset) + // data (offset)
    uint(0) + // operation = CALL
    uint(0) + // safeTxGas
    uint(0) + // baseGas
    uint(0) + // gasPrice
    uint(0) + // gasToken
    uint(0) + // refundReceiver
    uint(sigOffset); // signatures (offset)
  return SEL_EXEC_TRANSACTION + head + dataTail + bytesWord(signatures);
}

/** Build the full revoke transaction for the owner's wallet to send. */
export function buildRevokeTx({ chainId, account, owner, permissionId }) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  return {
    from: owner,
    to: account,
    value: "0x0",
    data: execTransactionCalldata({
      to: chain.smartSessions,
      data: removeSessionCalldata(permissionId),
      signatures: approvedHashSignature(owner),
    }),
  };
}

export async function readPermissionEnabled(provider, chainId, account, permissionId) {
  const chain = CHAINS[chainId];
  const res = await provider.request({
    method: "eth_call",
    params: [{ to: chain.smartSessions, data: isPermissionEnabledCalldata(permissionId, account) }, "latest"],
  });
  return BigInt(res) === 1n;
}
