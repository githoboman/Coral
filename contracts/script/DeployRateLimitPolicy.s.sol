// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CorralRateLimitPolicy} from "../src/CorralRateLimitPolicy.sol";

/// @notice CREATE2 deploy of CorralRateLimitPolicy (D26) with a fixed salt —
///         chain-invariant address, like CorralJournal.
///   forge script script/DeployRateLimitPolicy.s.sol --rpc-url $RPC_URL --broadcast --verify
contract DeployRateLimitPolicy is Script {
    bytes32 internal constant SALT = keccak256("corral.ratelimit.v1");

    function run() external returns (CorralRateLimitPolicy policy) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        policy = new CorralRateLimitPolicy{salt: SALT}();
        vm.stopBroadcast();
        console.log("CorralRateLimitPolicy deployed at:", address(policy));
    }
}
