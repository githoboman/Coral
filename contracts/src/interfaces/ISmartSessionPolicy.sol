// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal mirror of the SmartSessions policy interfaces (verified
///         source of UsageLimitPolicy at 0x00000000001d4479…, Base Sepolia),
///         declared locally so this repo depends on no Rhinestone packages.
///         Function signatures — and therefore `type(I).interfaceId` — must
///         match the originals exactly; `CorralRateLimitPolicy.t.sol` pins
///         the interface ids against the values SmartSessions probes for.

/// @dev ERC-4337 v0.7 PackedUserOperation — field order defines the selector.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

type ConfigId is bytes32;

uint256 constant VALIDATION_SUCCESS = 0;
uint256 constant VALIDATION_FAILED = 1;

interface IERC165 {
    function supportsInterface(bytes4 interfaceID) external view returns (bool);
}

interface IPolicy is IERC165 {
    event PolicySet(ConfigId id, address multiplexer, address account);

    error PolicyNotInitialized(ConfigId id, address multiplexer, address account);

    function initializeWithMultiplexer(address account, ConfigId configId, bytes calldata initData) external;
}

interface IUserOpPolicy is IPolicy {
    function checkUserOpPolicy(ConfigId id, PackedUserOperation calldata userOp) external returns (uint256);
}
