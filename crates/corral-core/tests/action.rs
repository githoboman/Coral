//! C-103 acceptance: the Action DSL is closed and `Plan` is strict — an extra
//! JSON field anywhere fails deserialisation (FR-4.2: a model adding a
//! "helpful" field must be rejected, never passed through).
#![allow(clippy::unwrap_used)] // in tests, unwrap IS the assertion

use alloy_primitives::{address, b256, U256};
use corral_core::action::{Action, Plan};
use corral_core::amount::TokenAmount;
use corral_core::policy::{ActionKind, AssetRef};

fn usdc() -> AssetRef {
    AssetRef {
        symbol: "USDC".into(),
        address: Some(address!("833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")),
    }
}

fn weth() -> AssetRef {
    AssetRef {
        symbol: "WETH".into(),
        address: Some(address!("4200000000000000000000000000000000000006")),
    }
}

fn amt(v: u64) -> TokenAmount {
    TokenAmount::from_base_units(U256::from(v))
}

fn sample_plan() -> Plan {
    Plan {
        chain_id: 84532,
        session_id: b256!("1111111111111111111111111111111111111111111111111111111111111111"),
        strategy_id: Some(b256!(
            "2222222222222222222222222222222222222222222222222222222222222222"
        )),
        seq: 3,
        actions: vec![
            Action::Approve {
                asset: usdc(),
                spender: address!("000000000022D473030F116dDEE9F6B43aC78BA3"),
                amount: amt(125_000_000),
            },
            Action::Swap {
                asset_in: usdc(),
                asset_out: weth(),
                amount_in: amt(125_000_000),
                min_amount_out: amt(30_000_000_000_000_000),
            },
        ],
    }
}

#[test]
fn plan_round_trips() {
    let p = sample_plan();
    let json = serde_json::to_string(&p).unwrap();
    let back: Plan = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

#[test]
fn plan_rejects_unknown_fields() {
    let mut v = serde_json::to_value(sample_plan()).unwrap();
    v.as_object_mut()
        .unwrap()
        .insert("execute_immediately".into(), serde_json::json!(true));
    assert!(serde_json::from_value::<Plan>(v).is_err());
}

#[test]
fn action_rejects_unknown_fields() {
    let mut v = serde_json::to_value(sample_plan()).unwrap();
    v["actions"][1]
        .as_object_mut()
        .unwrap()
        .insert("callback_address".into(), serde_json::json!("0x00"));
    assert!(serde_json::from_value::<Plan>(v).is_err());
}

#[test]
fn action_rejects_unknown_kind() {
    // The DSL is closed: no DELEGATECALL, no CUSTOM, no raw calldata.
    let json = serde_json::json!({
        "action": "DELEGATECALL",
        "target": "0x2626664c2603336E57B271c5C0b26F421741e481",
        "data": "0xdeadbeef"
    });
    assert!(serde_json::from_value::<Action>(json).is_err());
}

#[test]
fn there_is_no_raw_calldata_variant() {
    // Every variant serialises to a tag in the closed set; the tag names
    // match ActionKind's wire names one-to-one.
    let tags: Vec<String> = sample_plan()
        .actions
        .iter()
        .map(|a| {
            serde_json::to_value(a).unwrap()["action"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(tags, vec!["APPROVE", "SWAP"]);
}

#[test]
fn action_kind_mapping_is_total() {
    let wrap = Action::Wrap { amount: amt(1) };
    let unwrap_ = Action::Unwrap { amount: amt(1) };
    let transfer = Action::Transfer {
        asset: usdc(),
        to: address!("1111111111111111111111111111111111111111"),
        amount: amt(1),
    };
    assert_eq!(wrap.kind(), ActionKind::Wrap);
    assert_eq!(unwrap_.kind(), ActionKind::Unwrap);
    assert_eq!(transfer.kind(), ActionKind::Transfer);
    assert_eq!(sample_plan().actions[0].kind(), ActionKind::Approve);
    assert_eq!(sample_plan().actions[1].kind(), ActionKind::Swap);
}
