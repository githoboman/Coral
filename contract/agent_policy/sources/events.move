/// Structured on-chain activity log. Every agent action emits one AgentActionEvent,
/// queryable via suix_queryEvents filtered on policy_id. This is the PRD's
/// non-negotiable live feed, separate from (and not dependent on) Walrus archiving.
module agent_policy::events {

    use sui::event;
    use std::ascii::String as AsciiString;

    // action_type values
    const ACTION_SWAP: u8 = 0;
    const ACTION_LIMIT_ORDER: u8 = 1;
    const ACTION_CANCEL: u8 = 2;
    const ACTION_CLAIM_FILL: u8 = 3;

    // status values
    const STATUS_EXECUTED: u8 = 0;
    const STATUS_FAILED: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;

    /// Emitted on every agent action. token_in/token_out are stored as the fully
    /// qualified type strings (e.g. "0x2::sui::SUI") rather than TypeName so the
    /// off-chain indexer can read them directly from parsedJson without extra decoding.
    public struct AgentActionEvent has copy, drop {
        policy_id: ID,
        action_type: u8,
        amount: u64,
        token_in: AsciiString,
        token_out: AsciiString,
        timestamp: u64,
        status: u8,
    }

    /// Package-internal emit. Callers in the policy/settlement modules pass the
    /// already-resolved type strings so this module stays dependency-free.
    public(package) fun emit_action(
        policy_id: ID,
        action_type: u8,
        amount: u64,
        token_in: AsciiString,
        token_out: AsciiString,
        timestamp: u64,
        status: u8,
    ) {
        event::emit(AgentActionEvent {
            policy_id,
            action_type,
            amount,
            token_in,
            token_out,
            timestamp,
            status,
        });
    }

    // Accessors so other modules and tests use the constants rather than magic numbers.
    public fun action_swap(): u8 { ACTION_SWAP }
    public fun action_limit_order(): u8 { ACTION_LIMIT_ORDER }
    public fun action_cancel(): u8 { ACTION_CANCEL }
    public fun action_claim_fill(): u8 { ACTION_CLAIM_FILL }
    public fun status_executed(): u8 { STATUS_EXECUTED }
    public fun status_failed(): u8 { STATUS_FAILED }
    public fun status_cancelled(): u8 { STATUS_CANCELLED }
}
