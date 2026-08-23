/**
 * ValidatedPolicy → SmartSessions `Session` (T-008, spec §4.3).
 *
 * Composition is the one place policy semantics meet module semantics, so
 * it also emits a `SessionExpectation`: the exact on-chain state the session
 * must produce, which `verify.ts` checks after install (CLAUDE.md §2.2).
 * Anything the modules cannot express is a hard error here, never a silent
 * approximation (FR-5.3) — a policy that installs cleanly but enforces
 * something else is the worst failure this product has.
 *
 * Pure: no I/O. Uses only the pinned SDK builders (whose output addresses
 * are asserted against addresses.ts by the pins test).
 */
import type { ParamRule, TargetConstraint, ValidatedPolicy } from "@corral/core";
import {
  getOwnableValidator,
  getPermissionId,
  getSpendingLimitsPolicy,
  getTimeFramePolicy,
  getUniversalActionPolicy,
  getUsageLimitPolicy,
  getValueLimitPolicy,
  type Session,
} from "@rhinestone/module-sdk";
import { encodeAbiParameters, pad, toFunctionSelector, toHex, type Address, type Hex } from "viem";

import type { ChainAddresses } from "../addresses.js";
import { actionId } from "./ids.js";

export class ComposeError extends Error {
  constructor(
    readonly code: "CHAIN_MISMATCH" | "RULE_NOT_EXPRESSIBLE",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ComposeError";
  }
}

/** ParamCondition enum of UniversalActionPolicy (V2). */
export const UAP_CONDITION = {
  EQUAL: 0,
  GREATER_THAN: 1,
  LESS_THAN: 2,
  GREATER_THAN_OR_EQUAL: 3,
  LESS_THAN_OR_EQUAL: 4,
  NOT_EQUAL: 5,
  IN_RANGE: 6,
} as const;
const MAX_RULES = 16;
const ZERO32: Hex = `0x${"0".repeat(64)}`;

/** ABI of the ActionConfig struct as encoded for UniversalActionPolicy — verify.ts decodes expectations with it. */
export const UAP_ACTION_CONFIG_ABI = [
  {
    type: "tuple",
    components: [
      { name: "valueLimitPerUse", type: "uint256" },
      {
        name: "paramRules",
        type: "tuple",
        components: [
          { name: "length", type: "uint256" },
          {
            name: "rules",
            type: "tuple[16]",
            components: [
              { name: "condition", type: "uint8" },
              { name: "offset", type: "uint64" },
              { name: "isLimited", type: "bool" },
              { name: "ref", type: "bytes32" },
              {
                name: "usage",
                type: "tuple",
                components: [
                  { name: "limit", type: "uint256" },
                  { name: "used", type: "uint256" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
] as const;

interface UapRule {
  condition: number;
  offset: bigint;
  isLimited: boolean;
  ref: Hex;
  usage: { limit: bigint; used: bigint };
}
const zeroRule = (): UapRule => ({
  condition: UAP_CONDITION.EQUAL,
  offset: 0n,
  isLimited: false,
  ref: ZERO32,
  usage: { limit: 0n, used: 0n },
});

export type ExpectedUserOpPolicy =
  | { kind: "VALUE_LIMIT"; address: Address; initData: Hex; limit: bigint }
  | { kind: "USAGE_LIMIT"; address: Address; initData: Hex; limit: bigint }
  | { kind: "TIME_FRAME"; address: Address; initData: Hex; packedTimeFrame: bigint }
  | { kind: "RATE_LIMIT"; address: Address; initData: Hex; limit: bigint; window: bigint };

/** Rolling window of FR-2.7, in seconds. */
export const RATE_LIMIT_WINDOW_SECONDS = 86_400n;
/** Mirrors CorralRateLimitPolicy.MAX_LIMIT — bounds validation gas. */
export const RATE_LIMIT_MAX = 64n;

/** initData for CorralRateLimitPolicy: abi.encode(uint32 limit, uint32 windowSeconds). */
export function rateLimitInitData(limit: bigint, window: bigint): Hex {
  return encodeAbiParameters([{ type: "uint32" }, { type: "uint32" }], [Number(limit), Number(window)]);
}

export type ExpectedActionPolicy =
  | { kind: "UNIVERSAL_ACTION"; address: Address; initData: Hex }
  | { kind: "SPENDING_LIMITS"; address: Address; initData: Hex; token: Address; limit: bigint };

export interface ExpectedAction {
  readonly actionId: Hex;
  readonly target: Address;
  readonly selector: Hex;
  readonly policies: readonly ExpectedActionPolicy[];
}

export interface SessionExpectation {
  readonly chainId: number;
  readonly account: Address;
  readonly permissionId: Hex;
  readonly sessionValidator: Address;
  readonly sessionValidatorInitData: Hex;
  readonly userOpPolicies: readonly ExpectedUserOpPolicy[];
  readonly actions: readonly ExpectedAction[];
}

export interface ComposeInput {
  readonly policy: ValidatedPolicy;
  /** The account the session is installed on (needed for EQ_ACCOUNT refs). */
  readonly account: Address;
  /** The agent's session-signer address — sole owner of this session's OwnableValidator config. */
  readonly agentSigner: Address;
  readonly addresses: ChainAddresses;
  /** 32-byte salt; part of the permissionId. */
  readonly salt: Hex;
}

export interface ComposedSession {
  readonly session: Session;
  readonly permissionId: Hex;
  readonly expectation: SessionExpectation;
}

/** Word offset of a static calldata parameter: the policy strips the selector, so word i starts at i*32. */
const wordOffset = (paramIndex: number): bigint => BigInt(paramIndex) * 32n;

function refOf(v: { kind: "address"; value: string } | { kind: "uint"; value: number }): Hex {
  return v.kind === "address" ? pad(v.value as Address, { size: 32 }) : pad(toHex(BigInt(v.value)), { size: 32 });
}

function ruleFor(r: ParamRule, account: Address, target: TargetConstraint): UapRule {
  const base = { isLimited: false, usage: { limit: 0n, used: 0n }, offset: wordOffset(r.param_index) };
  switch (r.rule) {
    case "EQ_ACCOUNT":
      return { ...base, condition: UAP_CONDITION.EQUAL, ref: pad(account, { size: 32 }) };
    case "IN_SET": {
      if (r.allowed.length !== 1) {
        // UniversalActionPolicy ANDs one rule per parameter; an allowlist of
        // several values has no on-chain encoding. Refuse rather than widen.
        throw new ComposeError(
          "RULE_NOT_EXPRESSIBLE",
          `IN_SET with ${r.allowed.length} values on ${target.address} param ${r.param_index}`,
        );
      }
      const only = r.allowed[0];
      if (only === undefined) throw new ComposeError("RULE_NOT_EXPRESSIBLE", "empty IN_SET");
      return { ...base, condition: UAP_CONDITION.EQUAL, ref: refOf(only) };
    }
    case "LTE":
      return { ...base, condition: UAP_CONDITION.LESS_THAN_OR_EQUAL, ref: pad(toHex(r.max), { size: 32 }) };
    case "GTE":
      return { ...base, condition: UAP_CONDITION.GREATER_THAN_OR_EQUAL, ref: pad(toHex(r.min), { size: 32 }) };
  }
}

function universalActionFor(rules: UapRule[]): { policy: Address; initData: Hex } {
  if (rules.length > MAX_RULES) throw new ComposeError("RULE_NOT_EXPRESSIBLE", `${rules.length} rules > ${MAX_RULES}`);
  if (rules.length === 0) {
    // UniversalActionPolicy treats an all-zero config (no rules, no value
    // limit) as NOT INITIALIZED and reverts every call (found via the
    // violation matrix, 2026-08-23). An action must carry at least one rule.
    throw new ComposeError("RULE_NOT_EXPRESSIBLE", "an action needs at least one parameter rule (zero-rule UAP configs are uninitialized on-chain)");
  }
  const padded = [...rules, ...Array.from({ length: MAX_RULES - rules.length }, zeroRule)];
  const p = getUniversalActionPolicy({
    valueLimitPerUse: 0n,
    paramRules: { length: BigInt(rules.length), rules: padded as never },
  });
  return { policy: p.policy, initData: p.initData };
}

export function composeSession(input: ComposeInput): ComposedSession {
  const { policy, account, agentSigner, addresses, salt } = input;
  if (policy.chain_id !== addresses.chainId) {
    throw new ComposeError("CHAIN_MISMATCH", `policy chain ${policy.chain_id} differs from pinned table ${addresses.chainId}`);
  }

  // Session validator: the agent signer, threshold 1.
  const validator = getOwnableValidator({ threshold: 1, owners: [agentSigner] });

  // permissionId = keccak(validator, validatorInitData, salt) — independent of
  // policies and actions, so it is known before the actions are built and can
  // be pinned into the journal action's rules (FR-3.4: every journal entry
  // must cite the session it ran under).
  const permissionId = getPermissionId({
    session: {
      sessionValidator: validator.address,
      sessionValidatorInitData: validator.initData,
      salt,
      userOpPolicies: [],
      erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },
      actions: [],
      permitERC4337Paymaster: false,
      chainId: BigInt(policy.chain_id),
    },
  });

  // userOp-level policies (apply to every execution).
  const usageLimit = getUsageLimitPolicy({ limit: BigInt(policy.max_executions) });
  const timeFrame = getTimeFramePolicy({ validUntil: policy.valid_until, validAfter: policy.valid_after });
  const userOpPolicies: ExpectedUserOpPolicy[] = [
    { kind: "USAGE_LIMIT", address: usageLimit.policy, initData: usageLimit.initData, limit: BigInt(policy.max_executions) },
    {
      kind: "TIME_FRAME",
      address: timeFrame.policy,
      initData: timeFrame.initData,
      packedTimeFrame: (BigInt(policy.valid_until) << 48n) | BigInt(policy.valid_after),
    },
  ];
  // Native value (FR-2.3). ValueLimitPolicy V2 treats a zero limit as
  // "not initialized" and reverts PolicyNotInitialized at install (observed
  // on Base Sepolia 2026-08-23, trace of tx 0x67b2081d…), so a zero cap is
  // enforced by each action's UniversalActionPolicy valueLimitPerUse = 0
  // instead — no action may carry ETH, which is exact.
  // A non-zero cap installs ValueLimitPolicy as the cumulative ceiling.
  if (policy.max_native_value > 0n) {
    const valueLimit = getValueLimitPolicy({ limit: policy.max_native_value });
    userOpPolicies.unshift({ kind: "VALUE_LIMIT", address: valueLimit.policy, initData: valueLimit.initData, limit: policy.max_native_value });
  }
  // Rolling 24h cap (FR-2.7, D26) via our own CorralRateLimitPolicy. The
  // scheduler enforces the same pacing off-chain (defense in depth). A cap
  // of 0 means "no per-window cap" (the lifetime cap still applies).
  const perDay = BigInt(policy.max_executions_per_24h);
  if (perDay > 0n) {
    if (perDay > RATE_LIMIT_MAX) {
      throw new ComposeError("RULE_NOT_EXPRESSIBLE", `max_executions_per_24h ${perDay} exceeds CorralRateLimitPolicy.MAX_LIMIT ${RATE_LIMIT_MAX}`);
    }
    userOpPolicies.push({
      kind: "RATE_LIMIT",
      address: addresses.corralRateLimitPolicy.address,
      initData: rateLimitInitData(perDay, RATE_LIMIT_WINDOW_SECONDS),
      limit: perDay,
      window: RATE_LIMIT_WINDOW_SECONDS,
    });
  }

  // Actions: one per whitelisted (target, selector).
  const actions: ExpectedAction[] = policy.target_scope.map((t) => {
    const uap = universalActionFor(t.param_rules.map((r) => ruleFor(r, account, t)));
    const policies: ExpectedActionPolicy[] = [{ kind: "UNIVERSAL_ACTION", address: uap.policy, initData: uap.initData }];
    // Token targets (approve/transfer on an in-scope asset) carry the
    // cumulative per-asset budget (FR-2.2) via SpendingLimitsPolicy.
    const budget = policy.budgets.find((b) => b.asset.address === t.address);
    if (budget && (t.action === "APPROVE" || t.action === "TRANSFER")) {
      const token = t.address as Address;
      const sl = getSpendingLimitsPolicy([{ token, limit: budget.max_total }]);
      policies.push({ kind: "SPENDING_LIMITS", address: sl.policy, initData: sl.initData, token, limit: budget.max_total });
    }
    const target = t.address as Address;
    const selector = t.selector as Hex;
    return { actionId: actionId(target, selector), target, selector, policies };
  });

  // Journal action: always present, never user-configurable (FR-3.4). Its one
  // rule pins log(sessionId, …) to THIS session's permissionId — entries cannot
  // cite another session, and the config is non-zero (hence initialized).
  const journalSel = toFunctionSelector("log(bytes32,bytes32,bytes32,uint32)");
  const journalUap = universalActionFor([
    { condition: UAP_CONDITION.EQUAL, offset: wordOffset(0), isLimited: false, ref: permissionId, usage: { limit: 0n, used: 0n } },
  ]);
  actions.push({
    actionId: actionId(addresses.corralJournal.address, journalSel),
    target: addresses.corralJournal.address,
    selector: journalSel,
    policies: [{ kind: "UNIVERSAL_ACTION", address: journalUap.policy, initData: journalUap.initData }],
  });

  const session: Session = {
    sessionValidator: validator.address,
    sessionValidatorInitData: validator.initData,
    salt,
    userOpPolicies: userOpPolicies.map((p) => ({ policy: p.address, initData: p.initData })),
    erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },
    actions: actions.map((a) => ({
      actionTarget: a.target,
      actionTargetSelector: a.selector,
      actionPolicies: a.policies.map((p) => ({ policy: p.address, initData: p.initData })),
    })),
    permitERC4337Paymaster: false,
    chainId: BigInt(policy.chain_id),
  };
  if (getPermissionId({ session }) !== permissionId) {
    throw new ComposeError("RULE_NOT_EXPRESSIBLE", "permissionId changed after adding actions — SmartSessions hashing assumption broken");
  }

  return {
    session,
    permissionId,
    expectation: {
      chainId: policy.chain_id,
      account,
      permissionId,
      sessionValidator: validator.address,
      sessionValidatorInitData: validator.initData,
      userOpPolicies,
      actions,
    },
  };
}
