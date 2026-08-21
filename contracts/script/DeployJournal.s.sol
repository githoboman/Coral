// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CorralJournal} from "../src/CorralJournal.sol";

/// @notice CREATE2 deploy of CorralJournal with a fixed salt, so the address
///         is identical on every chain (spec §4.2). Uses the canonical
///         deterministic-deployment proxy that forge routes CREATE2 through.
///
/// Usage (contracts/.env must define DEPLOYER_PRIVATE_KEY and RPC_URL):
///   cd contracts
///   forge script script/DeployJournal.s.sol --rpc-url $env:RPC_URL --broadcast --verify
contract DeployJournal is Script {
    /// Fixed forever. Changing it changes the address on every chain — don't.
    bytes32 internal constant SALT = keccak256("corral.journal.v1");

    function run() external returns (CorralJournal journal) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        journal = new CorralJournal{salt: SALT}();
        vm.stopBroadcast();
        console.log("CorralJournal deployed at:", address(journal));
    }
}
