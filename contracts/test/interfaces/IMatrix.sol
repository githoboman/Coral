// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PackedUserOperation} from "../../src/interfaces/ISmartSessionPolicy.sol";

/// @notice Minimal external interfaces used by the violation matrix. Mirrors of
///         verified Base Sepolia contracts — function signatures only.

interface IEntryPoint {
    error FailedOp(uint256 opIndex, string reason);
    error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner);

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
}

/// @dev SmartSessions Session struct (DataTypes.sol) — layout must match the
///      fixture produced by server/src/scripts/evmMatrixFixture.ts.
struct PolicyData {
    address policy;
    bytes initData;
}

struct ERC7739Context {
    bytes32 appDomainSeparator;
    string[] contentNames;
}

struct ERC7739Data {
    ERC7739Context[] allowedERC7739Content;
    PolicyData[] erc1271Policies;
}

struct ActionData {
    bytes4 actionTargetSelector;
    address actionTarget;
    PolicyData[] actionPolicies;
}

struct Session {
    address sessionValidator;
    bytes sessionValidatorInitData;
    bytes32 salt;
    PolicyData[] userOpPolicies;
    ERC7739Data erc7739Policies;
    ActionData[] actions;
    bool permitERC4337Paymaster;
}

interface ISmartSession {
    function enableSessions(Session[] calldata sessions) external returns (bytes32[] memory permissionIds);
    function removeSession(bytes32 permissionId) external;
    function isPermissionEnabled(bytes32 permissionId, address account) external view returns (bool);
    function getPermissionId(Session calldata session) external pure returns (bytes32);
    function getEnabledActions(address account, bytes32 permissionId) external view returns (bytes32[] memory);
}

interface IERC7579Execution {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external payable returns (bytes[] memory);
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external payable;
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext) external view returns (bool);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface ICorralJournal {
    function log(bytes32 sessionId, bytes32 intentHash, bytes32 strategyId, uint32 seq) external;
}
