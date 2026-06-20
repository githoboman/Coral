/// AgentPolicy is the on-chain constraint layer for the autonomous agent wallet.
/// It is a SHARED object: the agent reads constraints and records spend, the owner
/// pauses/revokes. Sharing forces Sui to sequence all agent transactions against it,
/// which is what makes budget enforcement race-free (see record_spend).
///
/// validate_action ABORTS on any violated constraint — there is no boolean return
/// path an agent could ignore. A PTB that fails validation never reaches the
/// DeepBook moveCall or record_spend, so nothing executes.
#[allow(lint(self_transfer))]
module agent_policy::policy {

    use sui::clock::{Self, Clock};
    use std::ascii::String as AsciiString;
    use agent_policy::capability::{Self, AgentCapability};
    use agent_policy::events;

    // ── Error codes ──────────────────────────────────────────────────────
    const ENotOwner: u64 = 1;
    const EPolicyInactive: u64 = 2;
    const EPolicyExpired: u64 = 3;
    const EBudgetExceeded: u64 = 4;
    const EProtocolNotAllowed: u64 = 5;
    const EAssetNotAllowed: u64 = 6;
    const EActionNotAllowed: u64 = 7;
    const ECapabilityMismatch: u64 = 8;
    const EInvalidBudget: u64 = 9;
    const EInvalidExpiry: u64 = 10;
    const ETooEarly: u64 = 11;

    // ── Action type identifiers (mirror events.move) ─────────────────────
    // Only SWAP and LIMIT_ORDER are referenced here (asset-scope applies to them);
    // CANCEL is validated via the allowed_actions whitelist without a named constant.
    const ACTION_SWAP: u8 = 0;
    const ACTION_LIMIT_ORDER: u8 = 1;

    /// The shared constraint object. Constraints set at creation are immutable
    /// except for budget_spent (incremented by the agent) and is_active (toggled
    /// by the owner). Everything else is fixed for the policy's lifetime.
    public struct AgentPolicy has key {
        id: UID,
        owner: address,
        agent_address: address,
        budget_cap: u64,
        budget_spent: u64,
        // Whitelists stored as ascii strings: protocol addresses and fully-qualified
        // coin type strings. Membership is exact-match — the off-chain builder must
        // pass the same canonical form it whitelisted.
        allowed_protocols: vector<AsciiString>,
        allowed_assets: vector<AsciiString>,
        allowed_actions: vector<u8>,
        expiry_timestamp: u64,
        is_active: bool,
        gas_reserve: u64,
        created_at: u64,
    }

    public struct PolicyCreated has copy, drop {
        policy_id: ID,
        owner: address,
        agent_address: address,
        budget_cap: u64,
        expiry_timestamp: u64,
    }

    public struct PolicyRevoked has copy, drop {
        policy_id: ID,
        owner: address,
        timestamp: u64,
    }

    public struct PolicyPaused has copy, drop {
        policy_id: ID,
        is_active: bool,
        timestamp: u64,
    }

    public struct SpendRecorded has copy, drop {
        policy_id: ID,
        amount: u64,
        budget_spent: u64,
        budget_cap: u64,
    }

    // ── Creation ─────────────────────────────────────────────────────────

    /// Owner creates a policy. Returns the AgentCapability to the caller (owner),
    /// who then transfers it to the agent wallet address. The policy itself is
    /// shared immediately so both parties can reference it afterward.
    ///
    /// Returns the capability rather than auto-transferring so the creation PTB can
    /// decide where it goes (normally tx-built transfer to agent_address).
    public fun create_policy(
        agent_address: address,
        budget_cap: u64,
        allowed_protocols: vector<AsciiString>,
        allowed_assets: vector<AsciiString>,
        allowed_actions: vector<u8>,
        expiry_timestamp: u64,
        gas_reserve: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): AgentCapability {
        assert!(budget_cap > 0, EInvalidBudget);
        let now = clock::timestamp_ms(clock);
        assert!(expiry_timestamp > now, EInvalidExpiry);

        let owner = tx_context::sender(ctx);
        let policy = AgentPolicy {
            id: object::new(ctx),
            owner,
            agent_address,
            budget_cap,
            budget_spent: 0,
            allowed_protocols,
            allowed_assets,
            allowed_actions,
            expiry_timestamp,
            is_active: true,
            gas_reserve,
            created_at: now,
        };

        let policy_id = object::id(&policy);
        let cap = capability::new(policy_id, agent_address, ctx);

        sui::event::emit(PolicyCreated {
            policy_id,
            owner,
            agent_address,
            budget_cap,
            expiry_timestamp,
        });

        transfer::share_object(policy);
        cap
    }

    /// Entry wrapper: creates the policy and sends the capability straight to the
    /// agent address. Convenient for the frontend's one-shot creation flow.
    public fun create_and_delegate(
        agent_address: address,
        budget_cap: u64,
        allowed_protocols: vector<AsciiString>,
        allowed_assets: vector<AsciiString>,
        allowed_actions: vector<u8>,
        expiry_timestamp: u64,
        gas_reserve: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let cap = create_policy(
            agent_address,
            budget_cap,
            allowed_protocols,
            allowed_assets,
            allowed_actions,
            expiry_timestamp,
            gas_reserve,
            clock,
            ctx,
        );
        transfer::public_transfer(cap, agent_address);
    }

    // ── Validation (the hard guarantee) ──────────────────────────────────

    /// Checks EVERY constraint and aborts if any fails. Must be called inside the
    /// same PTB as the action it guards, with the agent's capability passed by
    /// reference — if the capability was revoked, the PTB can't resolve it and
    /// aborts before reaching here.
    ///
    /// `protocol` and `asset` are the canonical ascii strings the action targets.
    /// AND logic: active, not expired, capability bound, action/protocol/asset all
    /// whitelisted, and the spend still fits the budget.
    public fun validate_action(
        policy: &AgentPolicy,
        cap: &AgentCapability,
        action_type: u8,
        amount: u64,
        protocol: AsciiString,
        asset: AsciiString,
        clock: &Clock,
    ) {
        // Capability must belong to this exact policy and agent.
        assert!(capability::policy_id(cap) == object::id(policy), ECapabilityMismatch);
        assert!(capability::agent_address(cap) == policy.agent_address, ECapabilityMismatch);

        assert!(policy.is_active, EPolicyInactive);
        assert!(!is_expired(policy, clock), EPolicyExpired);

        assert!(vector::contains(&policy.allowed_actions, &action_type), EActionNotAllowed);
        assert!(vector::contains(&policy.allowed_protocols, &protocol), EProtocolNotAllowed);

        // Cancels don't move an asset across a pair, so asset-scope is only enforced
        // for value-moving actions. Swaps and limit orders must trade whitelisted assets.
        if (action_type == ACTION_SWAP || action_type == ACTION_LIMIT_ORDER) {
            assert!(vector::contains(&policy.allowed_assets, &asset), EAssetNotAllowed);
        };

        // Pre-check budget here too so an over-cap action is rejected before the
        // DeepBook call runs. record_spend re-checks atomically after the trade.
        assert!(policy.budget_spent + amount <= policy.budget_cap, EBudgetExceeded);
    }

    /// Time-gated validation for scheduled actions (PRD §8c). Runs the full
    /// validate_action check AND asserts the on-chain Clock has reached
    /// `execute_after`. A scheduled swap's PTB calls this, so even if the backend
    /// timer fires early or is replayed, execution is impossible before the target
    /// time — the Clock is the authority, not the server's setTimeout.
    public fun validate_action_after(
        policy: &AgentPolicy,
        cap: &AgentCapability,
        action_type: u8,
        amount: u64,
        protocol: AsciiString,
        asset: AsciiString,
        execute_after: u64,
        clock: &Clock,
    ) {
        assert!(clock::timestamp_ms(clock) >= execute_after, ETooEarly);
        validate_action(policy, cap, action_type, amount, protocol, asset, clock);
    }

    // ── Spend accounting (the atomic budget guard) ───────────────────────

    /// Increments budget_spent, aborting if it would exceed the cap. Because the
    /// policy is shared, two concurrent agent txs are sequenced: the first commits
    /// spent+=amount, the second sees the updated value and aborts if over cap.
    /// This is the race-free hard limit. Mutates the policy, so it requires the
    /// shared object by &mut and the capability to prove authorization.
    public fun record_spend(
        policy: &mut AgentPolicy,
        cap: &AgentCapability,
        amount: u64,
    ) {
        assert!(capability::policy_id(cap) == object::id(policy), ECapabilityMismatch);
        assert!(policy.budget_spent + amount <= policy.budget_cap, EBudgetExceeded);
        policy.budget_spent = policy.budget_spent + amount;

        sui::event::emit(SpendRecorded {
            policy_id: object::id(policy),
            amount,
            budget_spent: policy.budget_spent,
            budget_cap: policy.budget_cap,
        });
    }

    /// Emit a structured action event. Thin wrapper so execution PTBs log via the
    /// policy module (which holds the policy_id) without depending on events directly.
    public fun log_action(
        policy: &AgentPolicy,
        action_type: u8,
        amount: u64,
        token_in: AsciiString,
        token_out: AsciiString,
        status: u8,
        clock: &Clock,
    ) {
        events::emit_action(
            object::id(policy),
            action_type,
            amount,
            token_in,
            token_out,
            clock::timestamp_ms(clock),
            status,
        );
    }

    // ── Owner controls ───────────────────────────────────────────────────

    /// Owner destroys the capability and deactivates the policy. After this, the
    /// agent's capability object no longer exists, so any agent PTB referencing it
    /// aborts at input resolution. The on-chain orders/funds cleanup is composed in
    /// the same revocation PTB off-chain (cancel orders + sweep), not here.
    public fun revoke(
        policy: &mut AgentPolicy,
        cap: AgentCapability,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        // Capability must belong to this policy, else we'd be destroying the wrong one.
        let bound_id = capability::destroy(cap);
        assert!(bound_id == object::id(policy), ECapabilityMismatch);

        policy.is_active = false;
        sui::event::emit(PolicyRevoked {
            policy_id: object::id(policy),
            owner: policy.owner,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public fun pause(policy: &mut AgentPolicy, clock: &Clock, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        policy.is_active = false;
        sui::event::emit(PolicyPaused {
            policy_id: object::id(policy),
            is_active: false,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public fun resume(policy: &mut AgentPolicy, clock: &Clock, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        assert!(!is_expired(policy, clock), EPolicyExpired);
        policy.is_active = true;
        sui::event::emit(PolicyPaused {
            policy_id: object::id(policy),
            is_active: true,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    // ── Views ────────────────────────────────────────────────────────────

    public fun is_expired(policy: &AgentPolicy, clock: &Clock): bool {
        clock::timestamp_ms(clock) >= policy.expiry_timestamp
    }

    public fun owner(policy: &AgentPolicy): address { policy.owner }
    public fun agent_address(policy: &AgentPolicy): address { policy.agent_address }
    public fun budget_cap(policy: &AgentPolicy): u64 { policy.budget_cap }
    public fun budget_spent(policy: &AgentPolicy): u64 { policy.budget_spent }
    public fun remaining_budget(policy: &AgentPolicy): u64 { policy.budget_cap - policy.budget_spent }
    public fun is_active(policy: &AgentPolicy): bool { policy.is_active }
    public fun gas_reserve(policy: &AgentPolicy): u64 { policy.gas_reserve }
    public fun expiry_timestamp(policy: &AgentPolicy): u64 { policy.expiry_timestamp }
}
