// T-002 acceptance — parity port of crates/corral-core/tests/amount.rs:
// no arithmetic path can silently overflow, and the wire format is a decimal
// string — never hex, never a float, never negative, never a bare number.

import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  TOKEN_AMOUNT_ZERO,
  TokenAmountSchema,
  U256_MAX,
  checkedAdd,
  checkedSub,
  formatTokenAmount,
  tokenAmount,
} from "../src/amount.js";

const u256 = fc.bigInt({ min: 0n, max: U256_MAX });

describe("checked arithmetic (parity: add_never_silently_overflows / sub_never_silently_underflows)", () => {
  test("addition returns the exact sum or refuses — no third outcome", () => {
    fc.assert(
      fc.property(u256, u256, (a, b) => {
        const sum = checkedAdd(tokenAmount(a), tokenAmount(b));
        if (sum === null) {
          expect(b > U256_MAX - a, "refused an addition that does not overflow").toBe(true);
        } else {
          expect(sum >= a && sum >= b).toBe(true);
          expect(sum - a).toBe(b);
        }
      }),
    );
  });

  test("subtraction returns the exact difference or refuses — no wrap-around", () => {
    fc.assert(
      fc.property(u256, u256, (a, b) => {
        const diff = checkedSub(tokenAmount(a), tokenAmount(b));
        if (diff === null) {
          expect(a < b, "refused a subtraction that does not underflow").toBe(true);
        } else {
          expect(a >= b).toBe(true);
          expect(diff + b).toBe(a);
        }
      }),
    );
  });

  test("checked boundaries", () => {
    const max = tokenAmount(U256_MAX);
    const one = tokenAmount(1n);
    expect(checkedAdd(max, one)).toBeNull();
    expect(checkedSub(TOKEN_AMOUNT_ZERO, one)).toBeNull();
    expect(checkedSub(max, max)).toBe(TOKEN_AMOUNT_ZERO);
    expect(checkedAdd(TOKEN_AMOUNT_ZERO, max)).toBe(max);
  });
});

describe("wire format (parity: serde_is_decimal_string_round_trip)", () => {
  test("round-trips as a pure decimal string", () => {
    fc.assert(
      fc.property(u256, (a) => {
        const wire = formatTokenAmount(tokenAmount(a));
        expect(/^[0-9]+$/.test(wire), `non-decimal wire form: ${wire}`).toBe(true);
        expect(wire).toBe(a.toString(10));
        expect(TokenAmountSchema.parse(wire)).toBe(a);
      }),
    );
  });

  test("rejects non-decimal wire forms (parity: rejects_non_decimal_wire_forms)", () => {
    const bad: unknown[] = [
      "0x10", // hex
      "-1", // negative
      "1.5", // fractional
      "1e18", // exponent
      "", // empty
      " 1", // whitespace (BigInt(" 1") would silently accept — schema must not)
      "1_000", // separators
      10, // bare number — ambiguous precision, refuse
      10n, // bare bigint — wire format is string only
      null,
      undefined,
    ];
    for (const b of bad) {
      expect(TokenAmountSchema.safeParse(b).success, `accepted invalid wire form: ${String(b)}`).toBe(false);
    }
  });

  test("rejects values above U256_MAX (parity: rejects_values_above_u256_max)", () => {
    expect(TokenAmountSchema.safeParse(`${U256_MAX}9`).success).toBe(false);
    expect(TokenAmountSchema.safeParse((U256_MAX + 1n).toString()).success).toBe(false);
  });

  test("zero and max round-trip (parity: zero_and_max_round_trip)", () => {
    expect(formatTokenAmount(TOKEN_AMOUNT_ZERO)).toBe("0");
    const maxWire = formatTokenAmount(tokenAmount(U256_MAX));
    expect(TokenAmountSchema.parse(maxWire)).toBe(U256_MAX);
  });
});

describe("constructor bounds (TS-specific: Rust's U256 made these unrepresentable)", () => {
  test("tokenAmount rejects negatives and > U256_MAX", () => {
    expect(() => tokenAmount(-1n)).toThrow(RangeError);
    expect(() => tokenAmount(U256_MAX + 1n)).toThrow(RangeError);
    expect(tokenAmount(0n)).toBe(0n);
    expect(tokenAmount(U256_MAX)).toBe(U256_MAX);
  });
});
