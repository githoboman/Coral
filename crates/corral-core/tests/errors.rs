//! C-105 acceptance: every error code has exactly one retry rule and one
//! user-facing message; policy rejections are never retried. Exhaustiveness
//! is compile-time — `retry_class` has no wildcard arm, so adding a variant
//! without classifying it fails to compile.
#![allow(clippy::unwrap_used)] // in tests, unwrap IS the assertion

use corral_core::errors::{retry_class, ErrorCode, RetryClass};

/// The security property (PRD §9): a retry loop around a policy rejection is
/// what turns a safe system into an unsafe one.
#[test]
fn policy_rejections_are_terminal() {
    for code in [
        ErrorCode::PolicyAssetNotInScope,
        ErrorCode::PolicyBudgetExceeded,
        ErrorCode::PolicyTargetNotAllowed,
        ErrorCode::PolicyParamViolation,
        ErrorCode::PolicyExpired,
        ErrorCode::SessionRevoked,
        ErrorCode::PlanUnsafeBounds,
        ErrorCode::PlanInvalidSchema,
    ] {
        assert_eq!(
            retry_class(code),
            (RetryClass::Never, 0),
            "{code:?} must never be retried"
        );
    }
}

/// Safety pauses are terminal for the pipeline too — resolution is human.
#[test]
fn safety_pauses_are_terminal() {
    for code in [ErrorCode::MirrorDrift, ErrorCode::ModuleSetChanged] {
        assert_eq!(retry_class(code), (RetryClass::Never, 0));
    }
}

#[test]
fn transient_infra_errors_back_off() {
    for code in [
        ErrorCode::RelayerTimeout,
        ErrorCode::SignerUnavailable,
        ErrorCode::NodeUnavailable,
        ErrorCode::GasSponsorUnavailable,
    ] {
        let (class, attempts) = retry_class(code);
        assert_eq!(class, RetryClass::Backoff);
        assert_eq!(attempts, 5);
    }
}

#[test]
fn market_movement_requotes() {
    for code in [ErrorCode::SlippageExceeded, ErrorCode::SimulationRevert] {
        assert_eq!(retry_class(code), (RetryClass::Requote, 3));
    }
}

#[test]
fn window_and_nonce_rules() {
    assert_eq!(
        retry_class(ErrorCode::PolicyUsageLimit),
        (RetryClass::NextWindow, 1)
    );
    assert_eq!(
        retry_class(ErrorCode::InsufficientBalance),
        (RetryClass::NextWindow, 1)
    );
    assert_eq!(
        retry_class(ErrorCode::NonceConflict),
        (RetryClass::Immediate, 3)
    );
}

/// Wire format matches the PRD §9 code names exactly.
#[test]
fn serializes_as_prd_code_names() {
    for (code, name) in [
        (
            ErrorCode::PolicyAssetNotInScope,
            "\"POLICY_ASSET_NOT_IN_SCOPE\"",
        ),
        (
            ErrorCode::PolicyBudgetExceeded,
            "\"POLICY_BUDGET_EXCEEDED\"",
        ),
        (ErrorCode::SessionRevoked, "\"SESSION_REVOKED\""),
        (ErrorCode::RelayerTimeout, "\"RELAYER_TIMEOUT\""),
        (ErrorCode::NodeUnavailable, "\"NODE_UNAVAILABLE\""),
        (ErrorCode::MirrorDrift, "\"MIRROR_DRIFT\""),
    ] {
        assert_eq!(serde_json::to_string(&code).unwrap(), name);
        assert_eq!(serde_json::from_str::<ErrorCode>(name).unwrap(), code);
    }
}

/// FR-11.8: every code has a plain-language message (or is deliberately
/// silent) — no raw revert string ever reaches a user.
#[test]
fn user_messages_exist_and_nonce_conflict_is_silent() {
    assert!(ErrorCode::NonceConflict.user_message().is_none());
    for code in [
        ErrorCode::PolicyBudgetExceeded,
        ErrorCode::PolicyExpired,
        ErrorCode::SessionRevoked,
        ErrorCode::SlippageExceeded,
        ErrorCode::MirrorDrift,
        ErrorCode::ModuleSetChanged,
    ] {
        let msg = code.user_message().unwrap();
        assert!(!msg.is_empty());
        assert!(!msg.contains("0x"), "no hex in user messages: {msg}");
    }
}
