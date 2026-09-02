/**
 * SmartSessions id derivations, reproduced exactly from the verified
 * SmartSessions source (Base Sepolia 0x00000000008bDABA…, IdLib):
 *
 *   actionId        = keccak256(abi.encodePacked(target, selector))
 *   actionPolicyId  = keccak256(abi.encodePacked(permissionId, actionId))
 *   userOpConfigId  = keccak256(abi.encodePacked(account, permissionId))
 *   actionConfigId  = keccak256(abi.encodePacked(account, actionPolicyId))
 *
 * These are what the policy modules key their stored configs by, so the
 * post-install read-back (verify.ts) needs them to be bit-exact. Pure —
 * no I/O.
 */
import { encodePacked, keccak256, type Address, type Hex } from "viem";

export function actionId(target: Address, selector: Hex): Hex {
  return keccak256(encodePacked(["address", "bytes4"], [target, selector]));
}

export function actionPolicyId(permissionId: Hex, action: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [permissionId, action]));
}

/** ConfigId under which userOp-level policies store this session's config. */
export function userOpConfigId(account: Address, permissionId: Hex): Hex {
  return keccak256(encodePacked(["address", "bytes32"], [account, permissionId]));
}

/** ConfigId under which action-level policies store this (session, action) config. */
export function actionConfigId(account: Address, permissionId: Hex, action: Hex): Hex {
  return keccak256(encodePacked(["address", "bytes32"], [account, actionPolicyId(permissionId, action)]));
}
