/**
 * `TokenAmount` — the only representation of a token quantity in the entire
 * system (CLAUDE.md §2.10). Base units, checked arithmetic, decimal-string
 * wire format. A silent overflow in a spending limit is the worst bug this
 * system can have.
 *
 * Parity port of `crates/corral-core/src/amount.rs`. Rust's `U256` newtype
 * made misuse uncompilable; in TS the substitutes are: a branded `bigint`
 * (plain bigints and numbers don't typecheck where a TokenAmount is
 * required), range-checked constructors, checked-only arithmetic helpers,
 * and a wire schema that accepts nothing but a pure decimal string.
 */

import { z } from "zod";

declare const TokenAmountBrand: unique symbol;

/**
 * A token amount in base units: a `bigint` proven to lie in `[0, 2^256 - 1]`.
 *
 * There are deliberately no arithmetic operators for this type — native
 * `+`/`-` on the underlying bigints would bypass the range guarantee. Every
 * arithmetic step goes through `checkedAdd`/`checkedSub` and must handle
 * `null`.
 */
export type TokenAmount = bigint & { readonly [TokenAmountBrand]: "TokenAmount" };

/** The EVM word ceiling: 2^256 − 1. */
export const U256_MAX: bigint = (1n << 256n) - 1n;

export const TOKEN_AMOUNT_ZERO: TokenAmount = 0n as TokenAmount;

/**
 * Wrap a raw base-unit value. The only way in. Throws `RangeError` outside
 * `[0, U256_MAX]` — negative and oversized amounts are unrepresentable, not
 * merely invalid.
 */
export function tokenAmount(v: bigint): TokenAmount {
  if (v < 0n || v > U256_MAX) {
    throw new RangeError(`token amount out of range: ${v}`);
  }
  return v as TokenAmount;
}

export function isZero(a: TokenAmount): boolean {
  return a === 0n;
}

/**
 * Checked addition: `null` on overflow past `U256_MAX`. There is
 * intentionally no unchecked, wrapping, or saturating alternative.
 * A `null` here means an overflow was prevented — it must be handled.
 */
export function checkedAdd(a: TokenAmount, b: TokenAmount): TokenAmount | null {
  const sum = a + b;
  return sum > U256_MAX ? null : (sum as TokenAmount);
}

/** Checked subtraction: `null` on underflow below zero. */
export function checkedSub(a: TokenAmount, b: TokenAmount): TokenAmount | null {
  return a < b ? null : ((a - b) as TokenAmount);
}

/** Wire form: pure decimal string, matching Postgres `numeric(78,0)`. */
export function formatTokenAmount(a: TokenAmount): string {
  return a.toString(10);
}

const DECIMAL_ONLY = /^[0-9]+$/;

/**
 * The wire schema. Strictly a string of ASCII digits: no sign, no hex or
 * binary prefix, no exponent, no separators, no whitespace, not empty, and
 * never a bare JSON number (ambiguous precision). Validated *before*
 * `BigInt()` — `BigInt(" 1")` and `BigInt("")` would silently accept.
 */
export const TokenAmountSchema: z.ZodType<TokenAmount, string> = z
  .string()
  .regex(DECIMAL_ONLY, "token amount must be a base-unit decimal string")
  .transform((s, ctx) => {
    const v = BigInt(s);
    if (v > U256_MAX) {
      ctx.addIssue({ code: "custom", message: "token amount exceeds U256_MAX" });
      return z.NEVER;
    }
    return v as TokenAmount;
  });
