/// AgentCapability is the bearer object the agent wallet holds to prove it is
/// authorized to act under a given policy. Revocation works by destroying this
/// object: once deleted, any PTB that references it aborts at input resolution
/// (object-not-found), so the agent is hard-stopped on-chain with no bypass.
module agent_policy::capability {

    /// Held by the agent wallet. Links back to the policy it acts under.
    /// `store` lets the owner transfer it to the agent address on creation.
    public struct AgentCapability has key, store {
        id: UID,
        policy_id: ID,
        agent_address: address,
    }

    /// Only the policy module mints capabilities — it does so inside create_policy,
    /// guaranteeing the capability and policy are bound at birth.
    public(package) fun new(policy_id: ID, agent_address: address, ctx: &mut TxContext): AgentCapability {
        AgentCapability {
            id: object::new(ctx),
            policy_id,
            agent_address,
        }
    }

    public fun policy_id(cap: &AgentCapability): ID {
        cap.policy_id
    }

    public fun agent_address(cap: &AgentCapability): address {
        cap.agent_address
    }

    /// Consume and delete the capability. Called by the policy module's revoke().
    /// Returns the policy_id so revoke() can assert the cap matches the policy.
    public(package) fun destroy(cap: AgentCapability): ID {
        let AgentCapability { id, policy_id, agent_address: _ } = cap;
        object::delete(id);
        policy_id
    }
}
