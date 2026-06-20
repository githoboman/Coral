#[test_only]
module agent_policy::policy_tests {

    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::ascii;
    use agent_policy::policy::{Self, AgentPolicy};
    use agent_policy::capability::AgentCapability;

    const OWNER: address = @0xA11CE;
    const AGENT: address = @0xA6E27;

    // Canonical test identifiers.
    fun deepbook(): ascii::String { ascii::string(b"0xdee9::clob") }
    fun other_protocol(): ascii::String { ascii::string(b"0xbad::amm") }
    fun sui_type(): ascii::String { ascii::string(b"0x2::sui::SUI") }
    fun usdc_type(): ascii::String { ascii::string(b"0xusdc::usdc::USDC") }
    fun unlisted_type(): ascii::String { ascii::string(b"0xscam::token::SCAM") }

    // Build a standard policy: cap 500, DeepBook only, SUI+USDC, swap+limit+cancel,
    // expiry far in the future. Clock starts at t=1000.
    fun setup(scenario: &mut Scenario): Clock {
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, 1000);

        ts::next_tx(scenario, OWNER);
        {
            let cap = policy::create_policy(
                AGENT,
                500,
                vector[deepbook()],
                vector[sui_type(), usdc_type()],
                vector[0u8, 1u8, 2u8],
                1_000_000, // expiry well past t=1000
                100,       // gas reserve
                &clock,
                ts::ctx(scenario),
            );
            transfer::public_transfer(cap, AGENT);
        };
        clock
    }

    #[test]
    fun test_create_and_views() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            assert!(policy::owner(&p) == OWNER, 0);
            assert!(policy::agent_address(&p) == AGENT, 1);
            assert!(policy::budget_cap(&p) == 500, 2);
            assert!(policy::budget_spent(&p) == 0, 3);
            assert!(policy::remaining_budget(&p) == 500, 4);
            assert!(policy::is_active(&p), 5);
            assert!(!policy::is_expired(&p, &clock), 6);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_valid_swap_passes() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            // Swap (0) of 100 SUI on DeepBook — all whitelisted, within budget.
            policy::validate_action(&p, &cap, 0, 100, deepbook(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EProtocolNotAllowed)]
    fun test_non_whitelisted_protocol_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, other_protocol(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EAssetNotAllowed)]
    fun test_non_whitelisted_asset_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, deepbook(), unlisted_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EBudgetExceeded)]
    fun test_over_budget_validate_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            // 501 > cap 500.
            policy::validate_action(&p, &cap, 0, 501, deepbook(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_budget_exact_cap_passes_then_record() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, AGENT);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            // Exactly the cap is allowed (<=).
            policy::validate_action(&p, &cap, 0, 500, deepbook(), sui_type(), &clock);
            policy::record_spend(&mut p, &cap, 500);
            assert!(policy::budget_spent(&p) == 500, 0);
            assert!(policy::remaining_budget(&p) == 0, 1);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EBudgetExceeded)]
    fun test_record_spend_overflow_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        // First spend 400 (succeeds), then attempt 200 -> 600 > 500 aborts.
        // Mirrors the two-tx race the PRD describes, sequenced by shared object.
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::record_spend(&mut p, &cap, 400);
            assert!(policy::budget_spent(&p) == 400, 0);
            policy::record_spend(&mut p, &cap, 200); // aborts
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EPolicyExpired)]
    fun test_expired_policy_aborts() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup(&mut scenario);

        // Jump past expiry.
        clock::set_for_testing(&mut clock, 2_000_000);

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, deepbook(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EPolicyInactive)]
    fun test_paused_policy_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            policy::pause(&mut p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(p);
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, deepbook(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_pause_then_resume_restores() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            policy::pause(&mut p, &clock, ts::ctx(&mut scenario));
            assert!(!policy::is_active(&p), 0);
            policy::resume(&mut p, &clock, ts::ctx(&mut scenario));
            assert!(policy::is_active(&p), 1);
            ts::return_shared(p);
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, deepbook(), sui_type(), &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::ENotOwner)]
    fun test_non_owner_pause_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario);

        // AGENT (not owner) tries to pause.
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut p = ts::take_shared<AgentPolicy>(&scenario);
            policy::pause(&mut p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_time_gate_passes_at_or_after_target() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = setup(&mut scenario);
        clock::set_for_testing(&mut clock, 5000); // at/after the 5000 target

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action_after(&p, &cap, 0, 100, deepbook(), sui_type(), 5000, &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::ETooEarly)]
    fun test_time_gate_aborts_before_target() {
        let mut scenario = ts::begin(OWNER);
        let clock = setup(&mut scenario); // clock at 1000, target 5000

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action_after(&p, &cap, 0, 100, deepbook(), sui_type(), 5000, &clock);
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = policy::EActionNotAllowed)]
    fun test_disallowed_action_aborts() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1000);

        // Policy that only allows cancels (action 2), not swaps.
        ts::next_tx(&mut scenario, OWNER);
        {
            let cap = policy::create_policy(
                AGENT, 500,
                vector[deepbook()],
                vector[sui_type(), usdc_type()],
                vector[2u8],
                1_000_000, 100, &clock, ts::ctx(&mut scenario),
            );
            transfer::public_transfer(cap, AGENT);
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            let p = ts::take_shared<AgentPolicy>(&scenario);
            let cap = ts::take_from_sender<AgentCapability>(&scenario);
            policy::validate_action(&p, &cap, 0, 100, deepbook(), sui_type(), &clock); // swap not allowed
            ts::return_to_sender(&scenario, cap);
            ts::return_shared(p);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
