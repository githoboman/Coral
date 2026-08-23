/**
 * Violation-matrix fixture: emit the EXACT session our composer produces for
 * the worked-example policy, ABI-encoded for Foundry (vm.readFile +
 * abi.decode), so the matrix tests enforcement of what the product installs
 * — one source of truth (compose.ts). Pure; no chain access.
 *
 * Inputs are fixed test constants: the live dev account on Base Sepolia
 * (EQ_ACCOUNT refs) and an agent key Foundry can sign with (vm.addr(AGENT_PK)).
 */
import { writeFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, stringToHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parsePolicy } from "@corral/core";

import { BASE_SEPOLIA } from "../services/evm/addresses.js";
import { composeSession } from "../services/evm/session/compose.js";

const ACCOUNT = "0x6E2A6F54703e67f1Bfcc92c4a2Bd602E7546f360"; // dev-owner-salt5 (Safe7579, initialized)
const AGENT_PK = toHex(0xa11cen, { size: 32 }); // Foundry: vm.addr(0xA11CE)
const agent = privateKeyToAccount(AGENT_PK);
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const WETH = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER_02 = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

// Fixed, far-future window so the fixture stays valid; matrix cases warp around it.
const VALID_AFTER = 1_750_000_000;
const VALID_UNTIL = 1_900_000_000;

const policy = parsePolicy({
  version: 1,
  chain_id: 84532,
  asset_scope: [{ symbol: "USDC", address: USDC }],
  budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: "500000000" }],
  max_native_value: "0",
  target_scope: [
    { address: USDC, selector: "0x095ea7b3", action: "APPROVE", param_rules: [
      { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
      { rule: "LTE", param_index: 1, max: "125000000" } ] },
    { address: SWAP_ROUTER_02, selector: "0x04e45aaf", action: "SWAP", param_rules: [
      { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
      { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
      { rule: "IN_SET", param_index: 2, allowed: [{ kind: "uint", value: 3000 }] },
      { rule: "EQ_ACCOUNT", param_index: 3 },
      { rule: "LTE", param_index: 4, max: "125000000" },
      // amountOutMinimum floor (FR-5.2 / V7). The product computes this per quote;
      // the fixture pins a constant floor so the matrix can test "below floor".
      { rule: "GTE", param_index: 5, min: "1000000000000000" } ] },
  ],
  action_scope: ["APPROVE", "SWAP"],
  valid_after: VALID_AFTER,
  valid_until: VALID_UNTIL,
  max_executions: 8,
  max_executions_per_24h: 2,
  min_output_bps: 9800,
});

const composed = composeSession({ policy, account: ACCOUNT, agentSigner: agent.address, addresses: BASE_SEPOLIA, salt: keccak256(stringToHex("corral.matrix.v1")) });
const s = composed.session;

// ABI layout of SmartSessions' Session struct (DataTypes.sol).
const SESSION_ABI = [{
  type: "tuple", components: [
    { name: "sessionValidator", type: "address" },
    { name: "sessionValidatorInitData", type: "bytes" },
    { name: "salt", type: "bytes32" },
    { name: "userOpPolicies", type: "tuple[]", components: [{ name: "policy", type: "address" }, { name: "initData", type: "bytes" }] },
    { name: "erc7739Policies", type: "tuple", components: [
      { name: "allowedERC7739Content", type: "tuple[]", components: [{ name: "appDomainSeparator", type: "bytes32" }, { name: "contentNames", type: "string[]" }] },
      { name: "erc1271Policies", type: "tuple[]", components: [{ name: "policy", type: "address" }, { name: "initData", type: "bytes" }] } ] },
    { name: "actions", type: "tuple[]", components: [
      { name: "actionTargetSelector", type: "bytes4" },
      { name: "actionTarget", type: "address" },
      { name: "actionPolicies", type: "tuple[]", components: [{ name: "policy", type: "address" }, { name: "initData", type: "bytes" }] } ] },
    { name: "permitERC4337Paymaster", type: "bool" },
  ],
}] as const;

const encoded = encodeAbiParameters(SESSION_ABI, [{
  sessionValidator: s.sessionValidator,
  sessionValidatorInitData: s.sessionValidatorInitData,
  salt: s.salt,
  userOpPolicies: s.userOpPolicies.map((p) => ({ policy: p.policy, initData: p.initData })),
  erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },
  actions: s.actions.map((a) => ({ actionTargetSelector: a.actionTargetSelector, actionTarget: a.actionTarget, actionPolicies: a.actionPolicies.map((p) => ({ policy: p.policy, initData: p.initData })) })),
  permitERC4337Paymaster: false,
}]);

const out = { account: ACCOUNT, agent: agent.address, permissionId: composed.permissionId, validAfter: VALID_AFTER, validUntil: VALID_UNTIL, sessionAbi: encoded };
writeFileSync("../contracts/test/fixtures/matrix-session.json", JSON.stringify(out, null, 2) + "\n");
console.log(`fixture written: account ${ACCOUNT}, agent ${agent.address}, permissionId ${composed.permissionId}, ${encoded.length / 2 - 1} bytes`);
