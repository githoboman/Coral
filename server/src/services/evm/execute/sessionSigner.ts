/**
 * SessionSigner: the only thing that can produce an agent signature.
 *
 * The interface is deliberately tiny — `signHash` over a 32-byte userOp
 * hash — so the KMS-backed mainnet implementation (D23) is a drop-in and
 * the key material never appears outside this boundary. The testnet
 * implementation wraps an in-memory key (from the encrypted-at-rest store,
 * or an env var in scripts) and is marked as such.
 */
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface SessionSigner {
  readonly address: Address;
  /** Sign a raw 32-byte hash (no EIP-191 prefix — OwnableValidator recovers over the hash itself). */
  signHash(hash: Hex): Promise<Hex>;
}

/** TESTNET ONLY (D23): key held in process memory for the signer's lifetime. */
export function localSessionSigner(privateKey: Hex): SessionSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    signHash: (hash) => account.sign({ hash }),
  };
}

/** SmartSessions USE-mode signature envelope: 0x00 ‖ permissionId ‖ validator signature. */
export function encodeUseSignature(permissionId: Hex, signature: Hex): Hex {
  return `0x00${permissionId.slice(2)}${signature.slice(2)}`;
}
