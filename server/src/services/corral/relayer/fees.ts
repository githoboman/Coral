/**
 * EIP-1559 fee selection and replacement bumping (I-403).
 *
 * Two rules drive everything here:
 *
 *  1. A replacement transaction reusing a nonce must raise BOTH `maxFeePerGas`
 *     and `maxPriorityFeePerGas` by at least 10%, or the node rejects it as
 *     underpriced — leaving the original stuck and the nonce still blocked.
 *     Nodes compare against the *original* fees, so each bump is computed
 *     from the previous attempt, never from the current market alone.
 *
 *  2. Bumping is bounded. An unbounded escalation ladder turns a congested
 *     chain into a gas-drain on our own relayer key. Past the ceiling we stop
 *     and surface it, because a stuck transaction is an operational problem
 *     and paying any price to clear it is not a decision code should make.
 *
 * All arithmetic is bigint wei. There is no float anywhere in this file, and
 * `.toString()` is used only at the logging boundary.
 */

export interface Fees {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

/** Geth/reth minimum replacement bump, in percent. */
export const MIN_BUMP_PCT = 10n;

/** We bump by more than the minimum so a bump isn't rejected by a rounding edge. */
export const BUMP_PCT = 15n;

export class FeeCeilingExceeded extends Error {
  constructor(
    readonly attempted: bigint,
    readonly ceiling: bigint,
  ) {
    super(`replacement fee ${attempted.toString(10)} wei exceeds ceiling ${ceiling.toString(10)} wei`);
    this.name = "FeeCeilingExceeded";
  }
}

/** Ceiling on `maxFeePerGas`, in wei. Base is cheap; this is deliberately generous. */
export function feeCeilingWei(): bigint {
  const raw = process.env["RELAYER_MAX_FEE_WEI"];
  if (raw === undefined || raw === "") return 5_000_000_000n; // 5 gwei
  if (!/^[0-9]+$/.test(raw)) throw new Error(`RELAYER_MAX_FEE_WEI must be a wei integer, got ${raw}`);
  return BigInt(raw);
}

/** Percentage increase, rounded UP — rounding down can land a wei under the threshold. */
function raiseByPct(value: bigint, pct: bigint): bigint {
  const numerator = value * (100n + pct);
  const rounded = numerator / 100n;
  return numerator % 100n === 0n ? rounded : rounded + 1n;
}

/**
 * Fees for a first attempt: the market rate with headroom on the base fee so
 * a couple of blocks of increase doesn't strand the transaction.
 */
export function initialFees(market: Fees): Fees {
  const maxPriorityFeePerGas = market.maxPriorityFeePerGas > 0n ? market.maxPriorityFeePerGas : 1_000_000n;
  // Room for roughly four consecutive full blocks (base fee rises 12.5% each).
  const maxFeePerGas = market.maxFeePerGas > 0n ? raiseByPct(market.maxFeePerGas, 60n) : maxPriorityFeePerGas * 2n;
  return {
    maxFeePerGas: maxFeePerGas > maxPriorityFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
    maxPriorityFeePerGas,
  };
}

/**
 * Fees for a replacement of a stuck transaction.
 *
 * Takes the higher of "previous + bump" and the current market, then applies
 * the bump floor to both fields — satisfying the node's replacement rule even
 * when the market has fallen since the original attempt.
 *
 * Throws `FeeCeilingExceeded` rather than escalating without limit.
 */
export function bumpFees(previous: Fees, market: Fees, ceiling: bigint = feeCeilingWei()): Fees {
  const minMaxFee = raiseByPct(previous.maxFeePerGas, BUMP_PCT);
  const minPriority = raiseByPct(previous.maxPriorityFeePerGas, BUMP_PCT);

  const maxPriorityFeePerGas = market.maxPriorityFeePerGas > minPriority ? market.maxPriorityFeePerGas : minPriority;
  let maxFeePerGas = market.maxFeePerGas > minMaxFee ? market.maxFeePerGas : minMaxFee;
  // maxFee must always cover the priority fee, whichever source won.
  if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;

  if (maxFeePerGas > ceiling) throw new FeeCeilingExceeded(maxFeePerGas, ceiling);
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Does `next` satisfy the node's replacement rule against `previous`? */
export function isValidReplacement(previous: Fees, next: Fees): boolean {
  return (
    next.maxFeePerGas >= raiseByPct(previous.maxFeePerGas, MIN_BUMP_PCT) &&
    next.maxPriorityFeePerGas >= raiseByPct(previous.maxPriorityFeePerGas, MIN_BUMP_PCT)
  );
}
