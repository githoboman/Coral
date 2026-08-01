//! The closed Action DSL and `Plan` (C-103, FR-2.8, FR-4.1/4.2).
//!
//! A `Plan` is a typed, validated sequence of Actions — never raw calldata.
//! Every type here is `deny_unknown_fields`: an LLM (or anything else) adding
//! a helpful extra field fails deserialisation rather than passing something
//! unmodelled into the compiler.

use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};

use crate::amount::TokenAmount;
use crate::policy::{ActionKind, AssetRef};

/// One primitive from the closed DSL. There is deliberately no variant that
/// carries raw calldata, an arbitrary target, or a delegatecall.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum Action {
    Swap {
        asset_in: AssetRef,
        asset_out: AssetRef,
        amount_in: TokenAmount,
        /// Enforced on-chain via the GTE rule on `amountOutMinimum` (FR-5.2).
        min_amount_out: TokenAmount,
    },
    Transfer {
        asset: AssetRef,
        to: Address,
        amount: TokenAmount,
    },
    Approve {
        asset: AssetRef,
        spender: Address,
        /// Always exact and per-execution — the parse-time unbounded-approval
        /// invariant (FR-2.12) makes anything else unencodable anyway.
        amount: TokenAmount,
    },
    Wrap {
        amount: TokenAmount,
    },
    Unwrap {
        amount: TokenAmount,
    },
}

impl Action {
    /// The policy-scope kind of this action (total: every variant maps).
    pub fn kind(&self) -> ActionKind {
        match self {
            Action::Swap { .. } => ActionKind::Swap,
            Action::Transfer { .. } => ActionKind::Transfer,
            Action::Approve { .. } => ActionKind::Approve,
            Action::Wrap { .. } => ActionKind::Wrap,
            Action::Unwrap { .. } => ActionKind::Unwrap,
        }
    }
}

/// A typed, ordered execution bundle derived from an Intent (PRD §5).
///
/// The compiler (C-404) turns this into calldata deterministically; the
/// journal call is appended there, not modelled here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub chain_id: u64,
    pub session_id: B256,
    pub strategy_id: Option<B256>,
    /// Monotonic per-session sequence number; part of the idempotency key
    /// and the journal entry (FR-3.4).
    pub seq: u32,
    pub actions: Vec<Action>,
}
