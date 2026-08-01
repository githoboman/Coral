//! C-101 acceptance: no arithmetic path can silently overflow, and the wire
//! format is a decimal string — never hex, never a float, never negative.
#![allow(clippy::unwrap_used)] // in tests, unwrap IS the assertion

use alloy_primitives::U256;
use corral_core::amount::TokenAmount;
use proptest::prelude::*;

fn u256() -> impl Strategy<Value = U256> {
    any::<[u8; 32]>().prop_map(|b| U256::from_be_bytes(b))
}

proptest! {
    /// Addition either returns the exact sum or refuses. There is no third outcome.
    #[test]
    fn add_never_silently_overflows(a in u256(), b in u256()) {
        let (ta, tb) = (TokenAmount::from_base_units(a), TokenAmount::from_base_units(b));
        match ta.checked_add(tb) {
            Some(sum) => {
                // Exact: sum - a == b, and no wrap occurred.
                prop_assert!(sum.get() >= a && sum.get() >= b);
                prop_assert_eq!(sum.get() - a, b);
            }
            None => prop_assert!(b > U256::MAX - a, "refused an addition that does not overflow"),
        }
    }

    /// Subtraction either returns the exact difference or refuses; no wrap-around.
    #[test]
    fn sub_never_silently_underflows(a in u256(), b in u256()) {
        let (ta, tb) = (TokenAmount::from_base_units(a), TokenAmount::from_base_units(b));
        match ta.checked_sub(tb) {
            Some(diff) => {
                prop_assert!(a >= b);
                prop_assert_eq!(diff.get() + b, a);
            }
            None => prop_assert!(a < b, "refused a subtraction that does not underflow"),
        }
    }

    /// Wire format: a JSON string of ASCII digits, round-tripping exactly.
    #[test]
    fn serde_is_decimal_string_round_trip(a in u256()) {
        let ta = TokenAmount::from_base_units(a);
        let json = serde_json::to_string(&ta).unwrap();
        prop_assert!(json.starts_with('"') && json.ends_with('"'));
        let inner = &json[1..json.len() - 1];
        prop_assert!(inner.bytes().all(|c| c.is_ascii_digit()), "non-decimal wire form: {}", json);
        prop_assert_eq!(inner, a.to_string());
        let back: TokenAmount = serde_json::from_str(&json).unwrap();
        prop_assert_eq!(back, ta);
    }
}

#[test]
fn rejects_non_decimal_wire_forms() {
    for bad in [
        "\"0x10\"",  // hex
        "\"-1\"",    // negative
        "\"1.5\"",   // fractional
        "\"1e18\"",  // exponent
        "\"\"",      // empty
        "\" 1\"",    // whitespace
        "\"1_000\"", // separators
        "10",        // JSON number, not string — ambiguous precision, refuse
        "null",
    ] {
        assert!(
            serde_json::from_str::<TokenAmount>(bad).is_err(),
            "accepted invalid wire form: {bad}"
        );
    }
}

#[test]
fn rejects_values_above_u256_max() {
    let too_big = format!("\"{}9\"", U256::MAX); // one extra digit
    assert!(serde_json::from_str::<TokenAmount>(&too_big).is_err());
}

#[test]
fn zero_and_max_round_trip() {
    assert_eq!(serde_json::to_string(&TokenAmount::ZERO).unwrap(), "\"0\"");
    let max = TokenAmount::from_base_units(U256::MAX);
    let json = serde_json::to_string(&max).unwrap();
    assert_eq!(serde_json::from_str::<TokenAmount>(&json).unwrap(), max);
}

#[test]
fn checked_boundaries() {
    let max = TokenAmount::from_base_units(U256::MAX);
    let one = TokenAmount::from_base_units(U256::from(1u64));
    assert_eq!(max.checked_add(one), None);
    assert_eq!(TokenAmount::ZERO.checked_sub(one), None);
    assert_eq!(max.checked_sub(max), Some(TokenAmount::ZERO));
    assert_eq!(TokenAmount::ZERO.checked_add(max), Some(max));
}
