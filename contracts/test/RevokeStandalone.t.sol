// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISmartSession} from "./interfaces/IMatrix.sol";

interface ISafe {
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool success);
    function getOwners() external view returns (address[] memory);
}

/// @title Standalone revoke path (FR-8.1, FR-8.3, J3)
/// @notice Proves the kill-switch page's exact path on a Base Sepolia fork:
///         the OWNER's EOA calls Safe.execTransaction(SmartSessions,
///         removeSession(pid)) with the pre-approved-hash signature — no
///         EntryPoint, no relayer, no Corral service — and the session is gone.
///         Uses the live agent-demo account (dev-owner-salt8) and its session.
contract RevokeStandaloneTest is Test {
    ISmartSession internal constant SS = ISmartSession(0x00000000008bDABA73cD9815d79069c247Eb4bDA);
    address internal constant ACCOUNT = 0xF633373a0b34D3179Bd02b316EE6aCf9ebfD0A70;
    address internal constant OWNER = 0x91ac808850c33E15dc028a12Bfcaad70F1F8e6f9;
    bytes32 internal constant PID = 0xdce309d248f07d4716aba34f64aea5c1b3e5ed10205baad96a7795da6a79daa4;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    function _approvedHashSig(address owner) internal pure returns (bytes memory) {
        // r = owner, s = 0, v = 1  → "pre-validated" signature; valid iff msg.sender == owner
        return abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
    }

    function test_owner_revokes_with_a_plain_wallet_transaction() public {
        assertTrue(SS.isPermissionEnabled(PID, ACCOUNT), "fixture session must be active");
        address[] memory owners = ISafe(ACCOUNT).getOwners();
        assertEq(owners[0], OWNER, "dev EOA is the Safe owner");

        vm.prank(OWNER);
        bool ok = ISafe(ACCOUNT).execTransaction(
            address(SS), 0, abi.encodeCall(ISmartSession.removeSession, (PID)), 0, 0, 0, 0, address(0), payable(address(0)), _approvedHashSig(OWNER)
        );
        assertTrue(ok, "execTransaction must succeed");
        assertFalse(SS.isPermissionEnabled(PID, ACCOUNT), "session must be disabled");
    }

    function test_non_owner_cannot_revoke_this_way() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        ISafe(ACCOUNT).execTransaction(
            address(SS), 0, abi.encodeCall(ISmartSession.removeSession, (PID)), 0, 0, 0, 0, address(0), payable(address(0)), _approvedHashSig(stranger)
        );
        assertTrue(SS.isPermissionEnabled(PID, ACCOUNT));
    }
}
