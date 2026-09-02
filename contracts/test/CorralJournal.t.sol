// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CorralJournal} from "../src/CorralJournal.sol";

/// T-006 acceptance: 100% line/branch coverage on CorralJournal (trivially,
/// one function and zero branches — the tests pin the parts that matter:
/// event shape, msg.sender binding, timestamp source, and the deliberate
/// absence of access control).
contract CorralJournalTest is Test {
    CorralJournal internal journal;

    event Logged(
        address indexed account,
        bytes32 indexed sessionId,
        bytes32 indexed intentHash,
        bytes32 strategyId,
        uint32 seq,
        uint64 timestamp
    );

    function setUp() public {
        journal = new CorralJournal();
    }

    /// The account in the event is msg.sender, never a parameter — a caller
    /// cannot attribute an entry to someone else's account.
    function test_log_binds_account_to_msg_sender() public {
        address account = makeAddr("account");
        vm.warp(1_754_000_000);

        vm.expectEmit(true, true, true, true, address(journal));
        emit Logged(
            account,
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(uint256(3)),
            7,
            uint64(1_754_000_000)
        );

        vm.prank(account);
        journal.log(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), 7);
    }

    /// Deliberately permissionless (spec §4.2): third-party noise cannot
    /// pollute an account's history because consumers filter on `account`.
    function test_log_has_no_access_control() public {
        address stranger = makeAddr("stranger");
        vm.expectEmit(true, true, true, true, address(journal));
        emit Logged(stranger, bytes32(0), bytes32(0), bytes32(0), 0, uint64(block.timestamp));
        vm.prank(stranger);
        journal.log(bytes32(0), bytes32(0), bytes32(0), 0);
    }

    /// Timestamp comes from block.timestamp at inclusion, truncated to uint64.
    function test_log_timestamp_is_block_timestamp(uint64 ts) public {
        vm.warp(ts);
        vm.expectEmit(true, true, true, true, address(journal));
        emit Logged(address(this), bytes32(0), bytes32(0), bytes32(0), 0, ts);
        journal.log(bytes32(0), bytes32(0), bytes32(0), 0);
    }

    /// Every field round-trips exactly for arbitrary values.
    function testFuzz_log_emits_exact_fields(
        address account,
        bytes32 sessionId,
        bytes32 intentHash,
        bytes32 strategyId,
        uint32 seq
    ) public {
        vm.expectEmit(true, true, true, true, address(journal));
        emit Logged(account, sessionId, intentHash, strategyId, seq, uint64(block.timestamp));
        vm.prank(account);
        journal.log(sessionId, intentHash, strategyId, seq);
    }

    /// The contract holds no funds and accepts none: no receive/fallback.
    function test_rejects_plain_ether() public {
        address sender = makeAddr("funded");
        vm.deal(sender, 1 ether);
        vm.prank(sender);
        (bool ok,) = address(journal).call{value: 1 ether}("");
        assertFalse(ok, "journal must not accept ether");
        assertEq(address(journal).balance, 0);
    }
}
