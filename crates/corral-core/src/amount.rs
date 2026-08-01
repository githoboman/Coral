//! `TokenAmount` — the only representation of a token quantity in the entire
//! system (CLAUDE.md §2.10). Base units, checked arithmetic, decimal-string
//! wire format. A silent overflow in a spending limit is the worst bug this
//! system can have, so overflow is unrepresentable rather than discouraged.

use alloy_primitives::U256;
use core::fmt;
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};

/// A token amount in base units.
///
/// Deliberately NOT convertible to or from floats or primitive integers
/// without an explicit call, and deliberately without `Add`/`Sub`/`Mul`
/// impls: every arithmetic step must go through a `checked_*` method and
/// handle the `None` case.
///
/// Wire format is a decimal string (`"500000000"`), matching Postgres
/// `numeric(78,0)`. Hex, exponents, signs, separators and bare JSON numbers
/// are rejected on input.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TokenAmount(U256);

impl TokenAmount {
    pub const ZERO: Self = Self(U256::ZERO);

    /// Wrap a raw base-unit value. The only way in.
    pub const fn from_base_units(v: U256) -> Self {
        Self(v)
    }

    /// The raw base-unit value. The only way out.
    pub const fn get(self) -> U256 {
        self.0
    }

    pub fn is_zero(self) -> bool {
        self.0.is_zero()
    }

    /// Checked addition: `None` on overflow. There is intentionally no
    /// unchecked, wrapping, or saturating alternative.
    #[must_use = "a None here means an overflow was prevented — it must be handled"]
    pub fn checked_add(self, other: Self) -> Option<Self> {
        self.0.checked_add(other.0).map(Self)
    }

    /// Checked subtraction: `None` on underflow.
    #[must_use = "a None here means an underflow was prevented — it must be handled"]
    pub fn checked_sub(self, other: Self) -> Option<Self> {
        self.0.checked_sub(other.0).map(Self)
    }
}

impl fmt::Display for TokenAmount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // U256's Display is decimal; this is also the wire format.
        write!(f, "{}", self.0)
    }
}

impl Serialize for TokenAmount {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for TokenAmount {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl de::Visitor<'_> for V {
            type Value = TokenAmount;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a base-unit token amount as a decimal string")
            }

            fn visit_str<E: de::Error>(self, s: &str) -> Result<TokenAmount, E> {
                // Strictly ASCII digits: no sign, no hex/binary prefix, no
                // exponent, no separators, no whitespace, not empty. U256's
                // own FromStr would accept "0x…" — too permissive for money.
                if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) {
                    return Err(E::invalid_value(de::Unexpected::Str(s), &self));
                }
                U256::from_str_radix(s, 10)
                    .map(TokenAmount)
                    .map_err(|_| E::custom("token amount exceeds U256::MAX"))
            }
        }
        deserializer.deserialize_str(V)
    }
}
