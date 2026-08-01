//! Error taxonomy and retry classification (C-105, PRD §9, spec §7.1).
//!
//! Every failure maps to exactly one code; each code has a fixed retry rule
//! and a fixed user-facing message. `Never` on every policy rejection is a
//! security property, not a UX choice: a retry loop around a policy error is
//! what turns a safe system into an unsafe one. Reject any change that adds
//! a retry around one.
//!
//! Both `retry_class` and `user_message` match exhaustively with no wildcard
//! arm — adding an `ErrorCode` variant without classifying it fails to
//! compile. That is the point; do not "fix" it with `_ =>`.

use serde::{Deserialize, Serialize};

/// Canonical failure codes (PRD §9). Wire format is SCREAMING_SNAKE_CASE.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Policy rejections — terminal, always.
    PolicyAssetNotInScope,
    PolicyBudgetExceeded,
    PolicyTargetNotAllowed,
    PolicyParamViolation,
    PolicyExpired,
    PolicyUsageLimit,
    SessionRevoked,
    // Planner failures.
    PlanInvalidSchema,
    PlanUnsafeBounds,
    // Market / chain-state outcomes.
    SimulationRevert,
    SlippageExceeded,
    InsufficientBalance,
    // Transient infrastructure.
    GasSponsorUnavailable,
    RelayerTimeout,
    NonceConflict,
    SignerUnavailable,
    NodeUnavailable,
    // Safety pauses — resolved by a human, never by a retry.
    MirrorDrift,
    ModuleSetChanged,
}

/// How a failure may be retried, if at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RetryClass {
    /// Terminal. Policy rejections and safety pauses live here permanently.
    Never,
    /// Retry at once (e.g. with a fresh nonce key).
    Immediate,
    /// Exponential backoff with jitter.
    Backoff,
    /// Wait for the next schedule/usage window.
    NextWindow,
    /// Retry with a fresh quote.
    Requote,
}

/// The single source of truth for retry behaviour: `(class, max_attempts)`.
pub const fn retry_class(e: ErrorCode) -> (RetryClass, u8) {
    use ErrorCode::*;
    match e {
        PolicyAssetNotInScope
        | PolicyBudgetExceeded
        | PolicyTargetNotAllowed
        | PolicyParamViolation
        | PolicyExpired
        | SessionRevoked
        | PlanUnsafeBounds => (RetryClass::Never, 0),
        // Deterministic planner: identical input produces identical output,
        // so a schema failure cannot be retried into success.
        PlanInvalidSchema => (RetryClass::Never, 0),
        // Pause + page. Human resolution only (FR-6.3, SEC-9).
        MirrorDrift | ModuleSetChanged => (RetryClass::Never, 0),
        PolicyUsageLimit => (RetryClass::NextWindow, 1),
        InsufficientBalance => (RetryClass::NextWindow, 1),
        SlippageExceeded | SimulationRevert => (RetryClass::Requote, 3),
        RelayerTimeout | SignerUnavailable | NodeUnavailable | GasSponsorUnavailable => {
            (RetryClass::Backoff, 5)
        }
        NonceConflict => (RetryClass::Immediate, 3),
    }
}

impl ErrorCode {
    /// Fixed user-facing message templates (PRD §9; FR-11.8: never a raw
    /// revert or hex). `{...}` placeholders are interpolated by the frontend.
    /// `None` means the failure is deliberately silent to the user.
    pub const fn user_message(self) -> Option<&'static str> {
        use ErrorCode::*;
        match self {
            PolicyAssetNotInScope => Some("This agent isn't allowed to use that asset."),
            PolicyBudgetExceeded => Some("Budget for {asset} is used up."),
            PolicyTargetNotAllowed => Some("This agent can only trade on {venue}."),
            PolicyParamViolation => Some("The planned action didn't meet your rules."),
            PolicyExpired => Some("This agent's permission expired on {date}."),
            PolicyUsageLimit => Some("Daily action limit reached."),
            SessionRevoked => Some("You revoked this agent."),
            PlanInvalidSchema => Some("Couldn't build a valid plan; nothing was executed."),
            PlanUnsafeBounds => Some("Plan looked unusual and was blocked."),
            SimulationRevert => Some("Trade would have failed; skipped this run."),
            SlippageExceeded => Some("Price moved too much; skipped this run."),
            InsufficientBalance => Some("Not enough {asset} in your account."),
            GasSponsorUnavailable | RelayerTimeout | SignerUnavailable | NodeUnavailable => {
                Some("Temporary network issue; will retry.")
            }
            NonceConflict => None,
            MirrorDrift => Some("Paused for a safety check."),
            ModuleSetChanged => Some("Paused: your account settings changed unexpectedly."),
        }
    }
}
