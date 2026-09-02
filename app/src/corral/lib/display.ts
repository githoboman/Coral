/**
 * Display helpers for the Corral screens.
 *
 * Everything that turns a number or a code into words comes from
 * `@corral/core`. Nothing in this file reimplements a rule — it arranges what
 * core already decided. That boundary is the point of FR-11.9: if the frontend
 * could compute a cap or phrase a guarantee on its own, the sentence on screen
 * would stop being derived from the thing that is actually enforced.
 */
import {
  formatUnits,
  policySummary,
  statusTone,
  userMessage,
  type ExecutionStatus,
  type PolicySummary,
  type RawPolicy,
  type StatusTone,
} from "@corral/core";

/** Token decimals for the assets we know about on Base. */
export const KNOWN_DECIMALS: Record<string, number> = {
  native: 18,
  // USDC (Base and Base Sepolia)
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6,
  // WETH
  "0x4200000000000000000000000000000000000006": 18,
};

export const KNOWN_LABELS: Record<string, string> = {
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap v3",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Permit2",
  "0x4fd6dad6e04cf974e94f9af94b651766c1b6036f": "Corral journal",
};

/**
 * Build the worst-case summary for a policy.
 *
 * The decimals map is passed in rather than guessed — core refuses to invent a
 * scale, and an unknown token renders in base units with a warning instead of
 * quietly understating a cap.
 */
export function summarise(policy: RawPolicy): PolicySummary {
  // `policy` arrives already validated by the server; parsing again here would
  // be belt and braces, but the summary function takes a ValidatedPolicy and
  // the cast is the honest way to say "the server validated this".
  return policySummary(policy as Parameters<typeof policySummary>[0], {
    decimals: KNOWN_DECIMALS,
    labels: KNOWN_LABELS,
  });
}

/** Amount for display, or base units when we do not know the token's scale. */
export function amount(base: string | null, assetAddress: string | null, symbol?: string): string {
  if (base === null) return "—";
  const decimals = KNOWN_DECIMALS[(assetAddress ?? "native").toLowerCase()];
  if (decimals === undefined) return `${base}${symbol ? ` ${symbol} (smallest units)` : ""}`;
  return `${formatUnits(BigInt(base) as never, decimals)}${symbol ? ` ${symbol}` : ""}`;
}

/** Wei as ETH, for gas. Never shown alongside a budget figure (FR-6.5). */
export function wei(value: string | null): string {
  if (value === null) return "—";
  return `${formatUnits(BigInt(value) as never, 18)} ETH`;
}

/** Percentage of a budget used. Integer basis points, no float. */
export function percentUsed(spent: string, limit: string): number {
  const l = BigInt(limit);
  if (l <= 0n) return 0;
  const pct = (BigInt(spent) * 100n) / l;
  return pct > 100n ? 100 : Number(pct);
}

/**
 * How stale a reading is, in words.
 *
 * FR-6.4 wants the source *and* the freshness. "on-chain, 12s ago" is a very
 * different claim from "on-chain", and the difference is exactly what a user
 * needs when deciding whether to trust a number before acting on it.
 */
export function freshness(readAt: string | null, now: number = Date.now()): string {
  if (!readAt) return "never read";
  const ageMs = now - new Date(readAt).getTime();
  if (ageMs < 0) return "just now";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/** True when a reading is old enough that the UI should say so loudly. */
export function isStale(readAt: string | null, now: number = Date.now(), thresholdMs = 120_000): boolean {
  if (!readAt) return true;
  return now - new Date(readAt).getTime() > thresholdMs;
}

/**
 * The user-facing explanation of an error code (FR-11.8).
 *
 * A code with no mapping falls back to a generic sentence rather than being
 * printed. A raw code or revert string on screen is a defect, not a detail.
 */
export function explain(code: string | null): string {
  if (!code) return "Something went wrong.";
  const message = userMessage(code as Parameters<typeof userMessage>[0]);
  return message ?? "Something went wrong. We are looking into it.";
}

export interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
  readonly explanation: string;
}

/**
 * How a status should be shown.
 *
 * A policy rejection gets its own tone and its own words. FR-11.6 requires
 * failures and aborts to be visually distinct from rejections, and the reason
 * is not cosmetic: a rejection means the limits worked. Rendering it as a
 * fault teaches users to distrust their own protection.
 */
export function present(status: ExecutionStatus | string, errorCode: string | null): StatusPresentation {
  const known = ["PLANNED", "SIMULATED", "SUBMITTED", "INCLUDED", "SUCCEEDED", "FAILED", "REJECTED", "ABORTED", "EXPIRED"];
  if (!known.includes(status)) {
    return { label: "Unknown", tone: "pending", explanation: "We do not have a status for this yet." };
  }
  const tone = statusTone(status as ExecutionStatus);
  switch (status) {
    case "SUCCEEDED":
      return { label: "Done", tone, explanation: "The trade went through." };
    case "REJECTED":
      return {
        label: "Stopped by your limits",
        tone,
        explanation: `${explain(errorCode)} Your limits worked — nothing moved.`,
      };
    case "FAILED":
    case "ABORTED":
      return { label: "Did not go through", tone, explanation: explain(errorCode) };
    case "EXPIRED":
      return { label: "Expired", tone, explanation: "This run's time window passed before it could go out." };
    default:
      return { label: "In progress", tone, explanation: "This one is still being worked on." };
  }
}
