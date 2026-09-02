// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CorralRateLimitPolicy} from "../src/CorralRateLimitPolicy.sol";
import {ConfigId, IERC165, IPolicy, IUserOpPolicy, PackedUserOperation, VALIDATION_FAILED, VALIDATION_SUCCESS}
    from "../src/interfaces/ISmartSessionPolicy.sol";

/// D26 / FR-2.7 acceptance (test-first): at most `limit` executions in any
/// trailing `window`, exact, per (config, multiplexer, account); interface ids
/// identical to the ones SmartSessions probes for.
contract CorralRateLimitPolicyTest is Test {
    CorralRateLimitPolicy internal policy;

    ConfigId internal constant ID = ConfigId.wrap(keccak256("config"));
    address internal constant ACCOUNT = address(0xA11CE);
    address internal mxer; // this test contract acts as SmartSessions (the multiplexer)
    uint32 internal constant DAY = 86_400;

    function setUp() public {
        policy = new CorralRateLimitPolicy();
        mxer = address(this);
        vm.warp(1_756_000_000);
    }

    function _init(uint32 limit, uint32 window) internal {
        policy.initializeWithMultiplexer(ACCOUNT, ID, abi.encode(limit, window));
    }

    function _op(address sender) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
    }

    function _check() internal returns (uint256) {
        return policy.checkUserOpPolicy(ID, _op(ACCOUNT));
    }

    // ── Interface ids: must equal what SmartSessions probes (seen in traces) ──

    function test_interface_ids_match_smartsessions_probes() public view {
        // SmartSessions probed supportsInterface(0x7129edce) on the V2 policies
        // during enable (trace of tx 0x67b2081d…): that is IUserOpPolicy.
        assertEq(type(IUserOpPolicy).interfaceId, bytes4(0x7129edce), "IUserOpPolicy id drifted from SmartSessions");
        assertTrue(policy.supportsInterface(type(IERC165).interfaceId));
        assertTrue(policy.supportsInterface(type(IPolicy).interfaceId));
        assertTrue(policy.supportsInterface(type(IUserOpPolicy).interfaceId));
        assertFalse(policy.supportsInterface(0xffffffff));
    }

    // ── Initialization ───────────────────────────────────────────────────────

    function test_init_rejects_zero_limit_zero_window_and_oversize() public {
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, mxer, ACCOUNT));
        _init(0, DAY);
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, mxer, ACCOUNT));
        _init(2, 0);
        uint32 tooMany = policy.MAX_LIMIT() + 1; // read before expectRevert: it targets the NEXT call
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, mxer, ACCOUNT));
        _init(tooMany, DAY);
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, mxer, ACCOUNT));
        policy.initializeWithMultiplexer(ACCOUNT, ID, hex"01"); // malformed
    }

    function test_init_stores_config_and_uninitialized_check_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, mxer, ACCOUNT));
        _check();
        _init(2, DAY);
        (uint32 limit, uint32 window, uint32 count) = policy.getRateLimitConfig(ID, mxer, ACCOUNT);
        assertEq(limit, 2);
        assertEq(window, DAY);
        assertEq(count, 0);
    }

    // ── Rolling window semantics ─────────────────────────────────────────────

    function test_limit_2_per_day_exact_rolling_behaviour() public {
        _init(2, DAY);
        uint256 t0 = block.timestamp;
        assertEq(_check(), VALIDATION_SUCCESS, "1st");
        vm.warp(t0 + 1 hours);
        assertEq(_check(), VALIDATION_SUCCESS, "2nd");
        vm.warp(t0 + 2 hours);
        assertEq(_check(), VALIDATION_FAILED, "3rd within window must fail");
        assertEq(policy.getUsedInWindow(ID, mxer, ACCOUNT, uint48(block.timestamp)), 2);
        // exactly 24h after the first: first one is now outside the trailing window
        vm.warp(t0 + DAY);
        assertEq(_check(), VALIDATION_SUCCESS, "first expired, one slot free");
        vm.warp(t0 + DAY + 30 minutes);
        assertEq(_check(), VALIDATION_FAILED, "second (t0+1h) still inside");
        vm.warp(t0 + DAY + 1 hours);
        assertEq(_check(), VALIDATION_SUCCESS, "second expired");
    }

    function test_failed_attempts_do_not_consume_slots() public {
        _init(1, DAY);
        assertEq(_check(), VALIDATION_SUCCESS);
        for (uint256 i = 0; i < 5; i++) {
            vm.warp(block.timestamp + 1 minutes);
            assertEq(_check(), VALIDATION_FAILED);
        }
        (,, uint32 count) = policy.getRateLimitConfig(ID, mxer, ACCOUNT);
        assertEq(count, 1, "rejected attempts must not be recorded");
    }

    function test_reinit_resets_ring() public {
        _init(1, DAY);
        assertEq(_check(), VALIDATION_SUCCESS);
        assertEq(_check(), VALIDATION_FAILED);
        _init(1, DAY);
        assertEq(_check(), VALIDATION_SUCCESS, "re-enable starts fresh");
    }

    function test_isolation_by_multiplexer_and_account() public {
        _init(1, DAY);
        assertEq(_check(), VALIDATION_SUCCESS);
        assertEq(_check(), VALIDATION_FAILED);
        // another account under the same config id and multiplexer is independent
        policy.initializeWithMultiplexer(address(0xB0B), ID, abi.encode(uint32(1), DAY));
        assertEq(policy.checkUserOpPolicy(ID, _op(address(0xB0B))), VALIDATION_SUCCESS);
        // another multiplexer (a different caller) has no config → revert, not leak
        vm.prank(address(0xDEAD));
        vm.expectRevert(abi.encodeWithSelector(IPolicy.PolicyNotInitialized.selector, ID, address(0xDEAD), ACCOUNT));
        policy.checkUserOpPolicy(ID, _op(ACCOUNT));
    }

    // ── Fuzz: never more than `limit` successes in any trailing window ───────

    function testFuzz_never_exceeds_limit_in_any_window(uint8 limitRaw, uint16[40] memory gaps) public {
        uint32 limit = uint32(bound(uint256(limitRaw), 1, policy.MAX_LIMIT()));
        _init(limit, DAY);
        uint256 n = 0;
        uint48[] memory accepted = new uint48[](40);
        for (uint256 i = 0; i < 40; i++) {
            vm.warp(block.timestamp + uint256(gaps[i]) * 60); // 0..~45 days in minute steps
            uint48 nowTs = uint48(block.timestamp);
            // reference model: count accepted timestamps strictly inside the trailing window
            uint256 inWindow = 0;
            for (uint256 j = 0; j < n; j++) {
                if (accepted[j] > nowTs - DAY) inWindow++;
            }
            uint256 res = _check();
            if (inWindow >= limit) {
                assertEq(res, VALIDATION_FAILED, "model says full");
            } else {
                assertEq(res, VALIDATION_SUCCESS, "model says room");
                accepted[n++] = nowTs;
            }
        }
    }
}
