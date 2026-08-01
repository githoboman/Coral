//! C-102 acceptance: each of the six parse-time invariants (PRD §8) has a
//! failing case, and `ValidatedPolicy` is only constructible via
//! `TryFrom<RawPolicy>`.
#![allow(clippy::unwrap_used)] // in tests, unwrap IS the assertion

use alloy_primitives::{address, fixed_bytes, Address, U256};
use corral_core::amount::TokenAmount;
use corral_core::policy::{
    ActionKind, AssetRef, BudgetConstraint, ParamRule, PolicyError, RawPolicy, RuleValue,
    TargetConstraint, ValidatedPolicy,
};

const USDC: Address = address!("833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH: Address = address!("4200000000000000000000000000000000000006");
const ROUTER: Address = address!("2626664c2603336E57B271c5C0b26F421741e481");
const PERMIT2: Address = address!("000000000022D473030F116dDEE9F6B43aC78BA3");

fn usdc() -> AssetRef {
    AssetRef {
        symbol: "USDC".into(),
        address: Some(USDC),
    }
}

fn amt(v: u64) -> TokenAmount {
    TokenAmount::from_base_units(U256::from(v))
}

/// The worked example from spec §4.3: weekly DCA, 500 USDC over 30 days.
fn valid_policy() -> RawPolicy {
    RawPolicy {
        version: 1,
        chain_id: 84532,
        asset_scope: vec![usdc()],
        budgets: vec![BudgetConstraint {
            asset: usdc(),
            max_total: amt(500_000_000),
        }],
        max_native_value: TokenAmount::ZERO,
        target_scope: vec![
            TargetConstraint {
                address: USDC,
                selector: fixed_bytes!("095ea7b3"), // approve(address,uint256)
                action: ActionKind::Approve,
                param_rules: vec![
                    ParamRule::InSet {
                        param_index: 0,
                        allowed: vec![RuleValue::Address(PERMIT2)],
                    },
                    ParamRule::Lte {
                        param_index: 1,
                        max: amt(125_000_000),
                    },
                ],
            },
            TargetConstraint {
                address: ROUTER,
                selector: fixed_bytes!("04e45aaf"), // exactInputSingle
                action: ActionKind::Swap,
                param_rules: vec![
                    ParamRule::InSet {
                        param_index: 0,
                        allowed: vec![RuleValue::Address(USDC)],
                    },
                    ParamRule::InSet {
                        param_index: 1,
                        allowed: vec![RuleValue::Address(WETH)],
                    },
                    ParamRule::InSet {
                        param_index: 2,
                        allowed: vec![RuleValue::Uint(500), RuleValue::Uint(3000)],
                    },
                    ParamRule::EqAccount { param_index: 3 }, // recipient
                    ParamRule::Lte {
                        param_index: 4,
                        max: amt(125_000_000),
                    },
                ],
            },
        ],
        action_scope: vec![ActionKind::Approve, ActionKind::Swap],
        valid_after: 1_754_000_000,
        valid_until: 1_756_600_000,
        max_executions: 8,
        max_executions_per_24h: 2,
        min_output_bps: 9800,
    }
}

#[test]
fn the_worked_example_validates() {
    assert!(ValidatedPolicy::try_from(valid_policy()).is_ok());
}

// ── Invariant 4 (FR-2.6): valid_until > valid_after ─────────────────────────

#[test]
fn rejects_bad_time_window() {
    let mut p = valid_policy();
    p.valid_until = p.valid_after;
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::BadTimeWindow
    );

    let mut p = valid_policy();
    p.valid_until = p.valid_after - 1;
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::BadTimeWindow
    );
}

// ── Invariant 5 (FR-2.7): 24h cap ≤ total cap ───────────────────────────────

#[test]
fn rejects_inconsistent_usage_caps() {
    let mut p = valid_policy();
    p.max_executions_per_24h = p.max_executions + 1;
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::UsageCapsInconsistent
    );
}

// ── Invariant 6 (FR-9.3): min_output_bps in 5000..=10000 ────────────────────

#[test]
fn rejects_slippage_out_of_range() {
    for bad in [0u16, 4999, 10001, u16::MAX] {
        let mut p = valid_policy();
        p.min_output_bps = bad;
        assert_eq!(
            ValidatedPolicy::try_from(p).unwrap_err(),
            PolicyError::SlippageOutOfRange(bad)
        );
    }
    for ok in [5000u16, 9800, 10000] {
        let mut p = valid_policy();
        p.min_output_bps = ok;
        assert!(ValidatedPolicy::try_from(p).is_ok());
    }
}

// ── Invariant 1 (FR-2.1 + FR-2.2): every in-scope asset has a budget ────────

#[test]
fn rejects_asset_without_budget() {
    let mut p = valid_policy();
    p.asset_scope.push(AssetRef {
        symbol: "WETH".into(),
        address: Some(WETH),
    });
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::AssetWithoutBudget("WETH".into())
    );
}

#[test]
fn budget_matching_is_by_address_not_symbol() {
    // Same symbol, different address: the budget must NOT satisfy the scope entry.
    let mut p = valid_policy();
    p.asset_scope = vec![AssetRef {
        symbol: "USDC".into(),
        address: Some(WETH),
    }];
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::AssetWithoutBudget("USDC".into())
    );
}

// ── Invariant 2 (FR-2.5): every swap target pins recipient == account ───────

#[test]
fn rejects_swap_target_without_recipient_pin() {
    let mut p = valid_policy();
    p.target_scope[1]
        .param_rules
        .retain(|r| !matches!(r, ParamRule::EqAccount { .. }));
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::MissingRecipientPin(ROUTER)
    );
}

// ── Invariant 3 (FR-2.12): unbounded approvals are unencodable ──────────────

#[test]
fn rejects_approval_without_amount_cap() {
    let mut p = valid_policy();
    p.target_scope[0]
        .param_rules
        .retain(|r| !matches!(r, ParamRule::Lte { .. }));
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::UnboundedApproval(PERMIT2)
    );
}

#[test]
fn rejects_approval_capped_at_u256_max() {
    // A cap of U256::MAX is not a cap.
    let mut p = valid_policy();
    for r in &mut p.target_scope[0].param_rules {
        if let ParamRule::Lte { max, .. } = r {
            *max = TokenAmount::from_base_units(U256::MAX);
        }
    }
    assert_eq!(
        ValidatedPolicy::try_from(p).unwrap_err(),
        PolicyError::UnboundedApproval(PERMIT2)
    );
}

// ── Boundary discipline ─────────────────────────────────────────────────────

#[test]
fn raw_policy_rejects_unknown_fields() {
    let mut v = serde_json::to_value(valid_policy()).unwrap();
    v.as_object_mut()
        .unwrap()
        .insert("helpful_extra".into(), serde_json::json!(true));
    assert!(serde_json::from_value::<RawPolicy>(v).is_err());
}

#[test]
fn validated_policy_serializes_and_exposes_raw() {
    let vp = ValidatedPolicy::try_from(valid_policy()).unwrap();
    assert_eq!(vp.raw().max_executions, 8);
    // Serialize works (for hashing/summary); Deserialize is deliberately not
    // implemented — "unvalidated policy past the boundary" stays unrepresentable.
    serde_json::to_string(&vp).unwrap();
}
