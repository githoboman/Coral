//! Policy types and parse-time validation (C-102, PRD §8).
//!
//! "Parse, don't validate": [`ValidatedPolicy`] can only be constructed
//! through `TryFrom<RawPolicy>`, and everything downstream — encoder,
//! compiler, API, WASM bindings — accepts only [`ValidatedPolicy`], so an
//! unvalidated policy past the boundary is unrepresentable.

use alloy_primitives::{Address, FixedBytes, U256};
use serde::{Deserialize, Serialize};

use crate::amount::TokenAmount;

/// Reference to an asset the policy talks about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRef {
    /// Display symbol. Never used for identity — see [`AssetRef::same_as`].
    pub symbol: String,
    /// ERC-20 contract address; `None` means the chain's native asset.
    pub address: Option<Address>,
}

impl AssetRef {
    /// Identity is the address, never the symbol: symbols are attacker-chosen.
    pub fn same_as(&self, other: &AssetRef) -> bool {
        self.address == other.address
    }
}

/// Cumulative per-asset spend cap over the session's life (FR-2.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetConstraint {
    pub asset: AssetRef,
    pub max_total: TokenAmount,
}

/// The closed action DSL (FR-2.8). `Plan`s may contain nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionKind {
    Swap,
    Transfer,
    Approve,
    Wrap,
    Unwrap,
}

/// A value a [`ParamRule`] compares against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum RuleValue {
    Address(Address),
    /// Small scalar (e.g. a Uniswap fee tier). Token amounts use
    /// [`ParamRule::Lte`]/[`ParamRule::Gte`] with [`TokenAmount`] instead.
    Uint(u64),
}

/// Constraint on one calldata parameter of a whitelisted call (FR-2.5).
/// Names mirror the on-chain UniversalActionPolicy comparators (C-304).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "rule", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ParamRule {
    /// Parameter must equal the account address. This is the anti-exfiltration
    /// rule: budget caps bound theft, the recipient pin prevents it.
    EqAccount {
        param_index: u8,
    },
    InSet {
        param_index: u8,
        allowed: Vec<RuleValue>,
    },
    Lte {
        param_index: u8,
        max: TokenAmount,
    },
    Gte {
        param_index: u8,
        min: TokenAmount,
    },
}

/// Allowlisted (contract, selector) pair with parameter constraints (FR-2.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetConstraint {
    pub address: Address,
    pub selector: FixedBytes<4>,
    pub action: ActionKind,
    pub param_rules: Vec<ParamRule>,
}

impl TargetConstraint {
    pub fn is_swap_target(&self) -> bool {
        self.action == ActionKind::Swap
    }

    pub fn has_recipient_pin(&self) -> bool {
        self.param_rules
            .iter()
            .any(|r| matches!(r, ParamRule::EqAccount { .. }))
    }

    /// For an approve target: `Some(spender)` if the approval amount is not
    /// capped below `U256::MAX`. A cap of `U256::MAX` is not a cap (FR-2.12).
    pub fn unbounded_approval_spender(&self) -> Option<Address> {
        if self.action != ActionKind::Approve {
            return None;
        }
        let capped = self
            .param_rules
            .iter()
            .any(|r| matches!(r, ParamRule::Lte { max, .. } if max.get() < U256::MAX));
        if capped {
            return None;
        }
        // Identify the spender for the error message: the first address in an
        // IN_SET rule if one exists, else the target contract itself.
        let spender = self.param_rules.iter().find_map(|r| match r {
            ParamRule::InSet { allowed, .. } => allowed.iter().find_map(|v| match v {
                RuleValue::Address(a) => Some(*a),
                RuleValue::Uint(_) => None,
            }),
            _ => None,
        });
        Some(spender.unwrap_or(self.address))
    }
}

/// A policy exactly as it arrives from the wire — untrusted (PRD §8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawPolicy {
    pub version: u8,
    pub chain_id: u64,
    pub asset_scope: Vec<AssetRef>,
    pub budgets: Vec<BudgetConstraint>,
    pub max_native_value: TokenAmount,
    pub target_scope: Vec<TargetConstraint>,
    pub action_scope: Vec<ActionKind>,
    pub valid_after: u64,
    pub valid_until: u64,
    pub max_executions: u32,
    pub max_executions_per_24h: u32,
    pub min_output_bps: u16,
}

/// A policy that has passed every parse-time invariant. Cannot be constructed
/// any other way, and deliberately does not implement `Deserialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValidatedPolicy(RawPolicy);

impl ValidatedPolicy {
    /// Read access for the encoder, compiler and summary code. There is no
    /// mutable access: editing a policy means revoke + create new (FR-2.9).
    pub fn raw(&self) -> &RawPolicy {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PolicyError {
    #[error("validUntil must be after validAfter")]
    BadTimeWindow,
    #[error("24h execution cap exceeds total cap")]
    UsageCapsInconsistent,
    #[error("asset {0} is in scope but has no budget")]
    AssetWithoutBudget(String),
    #[error("swap target {0} lacks a recipient==account rule")]
    MissingRecipientPin(Address),
    #[error("approval to {0} is unbounded")]
    UnboundedApproval(Address),
    #[error("minOutputBps {0} outside 5000..=10000")]
    SlippageOutOfRange(u16),
}

impl TryFrom<RawPolicy> for ValidatedPolicy {
    type Error = PolicyError;

    fn try_from(p: RawPolicy) -> Result<Self, Self::Error> {
        if p.valid_until <= p.valid_after {
            return Err(PolicyError::BadTimeWindow);
        }
        if p.max_executions_per_24h > p.max_executions {
            return Err(PolicyError::UsageCapsInconsistent);
        }
        if !(5000..=10000).contains(&p.min_output_bps) {
            return Err(PolicyError::SlippageOutOfRange(p.min_output_bps));
        }

        // Every in-scope asset must carry a budget. An asset in scope without
        // a budget is an unbounded spend — the exact bug this product exists
        // to prevent.
        for a in &p.asset_scope {
            if !p.budgets.iter().any(|b| b.asset.same_as(a)) {
                return Err(PolicyError::AssetWithoutBudget(a.symbol.clone()));
            }
        }

        // Every swap target must pin the recipient to the account, or the
        // agent can swap the user's funds and send the output anywhere.
        // Budget caps bound theft; they do not prevent it (spec §4.3).
        for t in &p.target_scope {
            if t.is_swap_target() && !t.has_recipient_pin() {
                return Err(PolicyError::MissingRecipientPin(t.address));
            }
            if let Some(spender) = t.unbounded_approval_spender() {
                return Err(PolicyError::UnboundedApproval(spender));
            }
        }
        Ok(ValidatedPolicy(p))
    }
}
