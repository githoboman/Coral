/**
 * The plain-language worst-case rendering of a policy (FR-11.1).
 *
 * This lives in `@corral/core`, next to `parsePolicy`, deliberately. The
 * requirement is not "show the user a summary" — it is that the sentence the
 * user reads before signing is derived from the same code that validates the
 * configuration going on-chain. A summary written in the frontend would be a
 * second, unverified description of the policy, free to drift from what is
 * actually enforced. This one cannot.
 *
 * The governing rule for everything below: **never understate**. An ugly
 * sentence is a cosmetic defect. A sentence that says "your own account"
 * about a policy that permits sending anywhere is the product failing at the
 * one job it has. Where the policy is ambiguous, the summary reports the
 * worse reading and raises a warning.
 *
 * Copy is English, written short. That is a product decision (a 9th-grade
 * reading level target), not an accident of implementation.
 */

import { formatUnits, type TokenAmount } from "./amount.js";
import type { Address, TargetConstraint, ValidatedPolicy } from "./policy.js";

/** Assets can leave the account through these; approvals are tracked apart. */
const VALUE_MOVING = new Set(["SWAP", "TRANSFER"]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Key used for the native asset in the `decimals` lookup. */
export const NATIVE_KEY = "native";

export interface SummaryOptions {
  /**
   * Token decimals by lowercase address, plus `native` for the chain asset.
   * Omitted entries render as base units and are flagged — the summary never
   * guesses a scale, because guessing 18 for a 6-decimal token understates a
   * cap by a factor of a trillion.
   */
  decimals?: Readonly<Record<string, number>>;
  /**
   * Human names for contracts, by lowercase address. Display only: a label
   * never replaces the address in the summary's identity checks, so a
   * hostile label cannot rename a contract into looking safe.
   */
  labels?: Readonly<Record<string, string>>;
  /** Symbol for the chain's native asset. Defaults to `ETH`. */
  nativeSymbol?: string;
}

export interface SpendCap {
  symbol: string;
  /** `null` for the native asset. */
  address: Address | null;
  /** Base units — the authoritative figure. */
  maxTotal: string;
  /** Human display, or base units when the token's scale is unknown. */
  display: string;
  decimalsKnown: boolean;
  /** Worst-case ceiling for a single execution, base units. */
  perExecutionMax: string | null;
  perExecutionDisplay: string | null;
}

export interface VenueSummary {
  address: Address;
  /** The supplied label, or the address itself. Never a guess. */
  label: string;
  selector: string;
  action: TargetConstraint["action"];
  recipientPinned: boolean;
  maxPerExecution: string | null;
  allowedAddresses: Address[];
}

export type Destinations =
  /** Every value-moving call pins the recipient to the account. */
  | { kind: "account-only" }
  /** Value may also reach these specific addresses. */
  | { kind: "allowlist"; addresses: Address[] }
  /** At least one call can send value to an address the policy never bounds. */
  | { kind: "unrestricted"; via: Address[] };

export interface PolicySummary {
  /** One sentence. The thing to read if you read nothing else. */
  worstCase: string;
  spendCaps: SpendCap[];
  destinations: Destinations;
  venues: VenueSummary[];
  /** Addresses that may hold a spending allowance on the account's tokens. */
  allowanceHolders: Address[];
  window: {
    validAfter: number;
    validUntil: number;
    startsAt: string;
    endsAt: string;
    startsAtIso: string;
    endsAtIso: string;
    days: number;
  };
  usage: {
    maxExecutions: number;
    maxPer24h: number;
    maxNativeValue: string;
    maxNativeDisplay: string;
    minOutputBps: number;
    minOutputPct: string;
  };
  /** What this configuration structurally prevents. */
  guarantees: string[];
  /** What deserves a second look before signing. */
  warnings: string[];
  /** The full rendering, in reading order. Every entry is one sentence. */
  lines: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function utcDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ""} ${String(d.getUTCFullYear())}`;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** `9800` → `"98"`, `9750` → `"97.5"`. Integer math; bps is already an int. */
function bpsToPct(bps: number): string {
  // Integer division without Math.*: bps is a non-negative int, so removing
  // the remainder before dividing is exact. (The money-path lint bans Math.*
  // package-wide; percentages are not money, but the rule earns its keep by
  // having no exceptions.)
  const rem = bps % 100;
  const whole = (bps - rem) / 100;
  if (rem === 0) return String(whole);
  const frac = String(rem).padStart(2, "0").replace(/0+$/, "");
  return `${String(whole)}.${frac}`;
}

function decimalsFor(address: Address | null, opts: SummaryOptions): number | null {
  const key = address ?? NATIVE_KEY;
  const d = opts.decimals?.[key];
  return typeof d === "number" ? d : null;
}

function display(amount: TokenAmount, symbol: string, decimals: number | null): string {
  return decimals === null
    ? `${amount.toString(10)} ${symbol} (smallest units)`
    : `${formatUnits(amount, decimals)} ${symbol}`;
}

function inSetAddresses(t: TargetConstraint): Address[] {
  const out: Address[] = [];
  for (const r of t.param_rules) {
    if (r.rule !== "IN_SET") continue;
    for (const v of r.allowed) {
      if (v.kind === "address" && !out.includes(v.value)) out.push(v.value);
    }
  }
  return out;
}

/** The tightest LTE bound the target declares, or `null` if it declares none. */
function perExecutionBound(t: TargetConstraint): TokenAmount | null {
  let bound: TokenAmount | null = null;
  for (const r of t.param_rules) {
    if (r.rule === "LTE" && (bound === null || r.max > bound)) bound = r.max;
  }
  return bound;
}

function pinsRecipient(t: TargetConstraint): boolean {
  return t.param_rules.some((r) => r.rule === "EQ_ACCOUNT");
}

/** Does this target move, or authorise moving, the given asset? */
function touchesAsset(t: TargetConstraint, address: Address | null): boolean {
  if (address === null) return false;
  return t.address === address || inSetAddresses(t).includes(address);
}

function sentence(list: string[], conjunction: string): string {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0] ?? "";
  const head = list.slice(0, -1).join(", ");
  return `${head} ${conjunction} ${String(list[list.length - 1])}`;
}

// ── the summary ─────────────────────────────────────────────────────────────

/**
 * Render a validated policy as the worst-case block FR-11.1 requires.
 *
 * Pure and deterministic: the same policy and options always produce a
 * byte-identical result, which is what lets a review screen be diffed
 * against what was actually installed on-chain.
 */
export function policySummary(p: ValidatedPolicy, opts: SummaryOptions = {}): PolicySummary {
  const nativeSymbol =
    opts.nativeSymbol ?? p.asset_scope.find((a) => a.address === null)?.symbol ?? "ETH";

  // ── caps ──
  const spendCaps: SpendCap[] = p.budgets.map((b) => {
    const decimals = decimalsFor(b.asset.address, opts);
    const bound = p.target_scope
      .filter((t) => touchesAsset(t, b.asset.address))
      .reduce<TokenAmount | null>((acc, t) => {
        const x = perExecutionBound(t);
        if (x === null) return acc;
        return acc === null || x > acc ? x : acc;
      }, null);
    return {
      symbol: b.asset.symbol,
      address: b.asset.address,
      maxTotal: b.max_total.toString(10),
      display: display(b.max_total, b.asset.symbol, decimals),
      decimalsKnown: decimals !== null,
      perExecutionMax: bound === null ? null : bound.toString(10),
      perExecutionDisplay: bound === null ? null : display(bound, b.asset.symbol, decimals),
    };
  });

  // ── venues ──
  const venues: VenueSummary[] = p.target_scope.map((t) => {
    const bound = perExecutionBound(t);
    return {
      address: t.address,
      label: opts.labels?.[t.address] ?? t.address,
      selector: t.selector,
      action: t.action,
      recipientPinned: pinsRecipient(t),
      maxPerExecution: bound === null ? null : bound.toString(10),
      allowedAddresses: inSetAddresses(t),
    };
  });

  // ── destinations ──
  // Worst reading wins. A value-moving call that neither pins the recipient
  // nor bounds it to an allowlist can send anywhere, and must say so.
  const unrestrictedVia: Address[] = [];
  const allowlisted: Address[] = [];
  for (const t of p.target_scope) {
    if (!VALUE_MOVING.has(t.action) || pinsRecipient(t)) continue;
    const allowed = inSetAddresses(t);
    if (allowed.length === 0) unrestrictedVia.push(t.address);
    else for (const a of allowed) if (!allowlisted.includes(a)) allowlisted.push(a);
  }
  const destinations: Destinations =
    unrestrictedVia.length > 0
      ? { kind: "unrestricted", via: unrestrictedVia }
      : allowlisted.length > 0
        ? { kind: "allowlist", addresses: allowlisted }
        : { kind: "account-only" };

  const allowanceHolders: Address[] = [];
  for (const t of p.target_scope) {
    if (t.action !== "APPROVE") continue;
    for (const a of inSetAddresses(t)) if (!allowanceHolders.includes(a)) allowanceHolders.push(a);
  }

  // ── window ──
  const windowSeconds = p.valid_until - p.valid_after;
  const days = (windowSeconds - (windowSeconds % 86_400)) / 86_400;
  const endsAt = utcDate(p.valid_until);

  const nativeDecimals = decimalsFor(null, opts);
  const maxNativeDisplay = display(p.max_native_value, nativeSymbol, nativeDecimals);

  // ── copy ──
  const capPhrase = sentence(
    spendCaps.map((c) => c.display),
    "and",
  );

  const destinationPhrase =
    destinations.kind === "account-only"
      ? "Anything it trades comes back to your own account"
      : destinations.kind === "allowlist"
        ? `Funds can go to your own account or to ${sentence(destinations.addresses, "or")}`
        : "It can send funds to any address";

  const worstCase =
    spendCaps.length === 0
      ? `This agent has no spending budget. All permission ends on ${endsAt}.`
      : `In the worst case this agent spends ${capPhrase}. ${destinationPhrase}. All permission ends on ${endsAt}.`;

  const lines: string[] = [];
  if (spendCaps.length > 0) lines.push(`The agent can spend at most ${capPhrase} in total.`);
  const perRun = spendCaps.filter((c) => c.perExecutionDisplay !== null);
  if (perRun.length > 0) {
    lines.push(
      `Each single run is capped at ${sentence(
        perRun.map((c) => String(c.perExecutionDisplay)),
        "and",
      )}.`,
    );
  }
  lines.push(`${destinationPhrase}.`);
  if (venues.length > 0) {
    const names = venues.map((v) => v.label);
    const unique = [...new Set(names)];
    lines.push(
      unique.length <= 4
        ? `It can only call ${sentence(unique, "and")}.`
        : `It can only call ${String(unique.length)} approved contracts.`,
    );
  }
  lines.push(
    `It can run at most ${String(p.max_executions)} times, and no more than ${String(p.max_executions_per_24h)} times in any 24 hours.`,
  );
  lines.push(`Every trade must return at least ${bpsToPct(p.min_output_bps)}% of the quoted amount.`);
  lines.push(
    p.max_native_value === 0n
      ? `It cannot spend any ${nativeSymbol}.`
      : `It can spend at most ${maxNativeDisplay} on top of the budgets above.`,
  );
  lines.push(`Permission starts on ${utcDate(p.valid_after)} and ends on ${endsAt}.`);
  lines.push("These limits cannot be edited. Changing them means revoking this agent and making a new one.");

  const guarantees: string[] = [
    "These limits are enforced by your account itself, not by the agent's software.",
    "You can revoke this at any time, without our help.",
  ];
  if (destinations.kind === "account-only") {
    guarantees.push("Funds can never leave your own account.");
  }
  if (p.max_native_value === 0n) {
    guarantees.push(`It can move no ${nativeSymbol} at all.`);
  }
  guarantees.push(`It stops working by itself on ${endsAt}.`);

  const warnings: string[] = [];
  if (destinations.kind === "unrestricted") {
    warnings.push(
      `This agent can send funds to any address. Check that this is what you meant before you sign.`,
    );
  }
  if (destinations.kind === "allowlist") {
    warnings.push(`This agent can send funds to addresses other than your own.`);
  }
  for (const c of spendCaps) {
    if (!c.decimalsKnown) {
      warnings.push(`The scale of ${c.symbol} is unknown here, so its cap is shown in smallest units.`);
    }
  }
  if (days > 90) {
    warnings.push(`This permission lasts ${String(days)} days. Shorter is safer.`);
  }
  if (p.min_output_bps < 9500) {
    warnings.push(`A trade may return as little as ${bpsToPct(p.min_output_bps)}% of its quote.`);
  }
  if (allowanceHolders.length > 0) {
    warnings.push(
      `${sentence(allowanceHolders, "and")} can hold a spending allowance, capped per run by the limits above.`,
    );
  }

  return {
    worstCase,
    spendCaps,
    destinations,
    venues,
    allowanceHolders,
    window: {
      validAfter: p.valid_after,
      validUntil: p.valid_until,
      startsAt: utcDate(p.valid_after),
      endsAt,
      startsAtIso: iso(p.valid_after),
      endsAtIso: iso(p.valid_until),
      days,
    },
    usage: {
      maxExecutions: p.max_executions,
      maxPer24h: p.max_executions_per_24h,
      maxNativeValue: p.max_native_value.toString(10),
      maxNativeDisplay,
      minOutputBps: p.min_output_bps,
      minOutputPct: bpsToPct(p.min_output_bps),
    },
    guarantees,
    warnings,
    lines,
  };
}
