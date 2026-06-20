#[test_only]
module agent_policy::revocation_tests {

    use sui::test_scenario::{Self as ts};
    use sui::clock::{Self, Clock};
    use std::ascii;
    use agent_policy::policy::{Self, AgentPolicy};
    use agent_policy::capability::AgentCapability;

    const OWNER: address = @0xA11CE;
    const AGENT: address = @0xA6E27;

    fun deepbook(): ascii::String { ascii::string(b"0xdee9::clob") }
    fun sui_type(): ascii::String { ascii::string(b"0x2::sui::SUI") }
    fun usdc_type(): ascii::String { ascii::string(b"0xusdc::usdc::USDC") }

    fun make_clock(scenario: &mut ts::Scenario): Clock {
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, 1000);
        clock
    }

    fun create(scenario: &mut ts::Scenario, clock: &Clock) {
        ts::next_tx(scenario, OWNER);
        let cap = policy::create_policy(
            AGENT, 500,
            vector[deepbook()],
            vector[sui_type(), usdc_type()],
            vector[0u8, 1u8, 2u8],
            1_000_000, 100, clock, ts::ctx(scenario),
        );
        transfer::public_transfer(cap, AGENT);
    }

    #[test]
    fun test_revoke_deactivates_policy() {
        let mut scenario = ts::begin(OWNER);
        let clock = make_clock(&mut scenario);
        create(&mut scenario, &clock);

        // Agent hands its capability back into the owner's revoke call. In the real
        // flow the revocation PTB references the cap held by the agent address; here
        // we move it to OWNER to drive revoke from the owner's tx context.
        ts::next_tx(&mut scenario, AGENT);
        {
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            transfer::public_transfer(cap, OWNER);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::revoke(&mut p, cap, &clock, ts::ctx(&mut scenario));
            assert!(!policy::is_active(&p), 0);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure]
    fun test_capability_gone_after_revoke() {
        let mut scenario = ts::begin(OWNER);
        let clock = make_clock(&mut scenario);
        create(&mut scenario, &clock);

        ts::next_tx(&mut scenario, AGENT);
        {
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            transfer::public_transfer(cap, OWNER);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::revoke(&mut p, cap, &clock, ts::ctx(&mut scenario));
            ts::return_shared(p);
        };

        // The capability object no longer exists; trying to take it aborts.
        // This is the on-chain analogue of the agent's next tx failing on
        // object-not-found after revocation.
        ts::next_tx(&mut scenario, OWNER);
        {
            let cap = ts::take_from_sender<AgentCapability>(&scenario); // aborts
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::ENotOwner)]
    fun test_non_owner_cannot_revoke() {
        let mut scenario = ts::begin(OWNER);
        let clock = make_clock(&mut scenario);
        create(&mut scenario, &clock);

        // Agent holds the cap and tries to revoke from its own context — rejected
        // because revoke asserts sender == owner.
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::revoke(&mut p, cap, &clock, ts::ctx(&mut scenario));
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
