// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConfigId, IERC165, IPolicy, IUserOpPolicy, PackedUserOperation, VALIDATION_FAILED, VALIDATION_SUCCESS}
    from "./interfaces/ISmartSessionPolicy.sol";

/// @title CorralRateLimitPolicy
/// @notice SmartSessions userOp policy enforcing at most `limit` executions
///         per rolling `window` seconds, per (session config, account) — the
///         on-chain half of FR-2.7 (ADR D26). The off-chain scheduler enforces
///         the same pacing as defense in depth.
///
/// @dev Exact rolling window: a ring buffer holds the timestamps of the last
///      `limit` accepted executions; an execution is accepted iff fewer than
///      `limit` of them fall inside the trailing window. Per check: ≤ `limit`
///      SLOADs, bounded by MAX_LIMIT.
///
///      Reads `block.timestamp` during ERC-4337 validation. That is forbidden
///      by public bundlers' mempool rules (ERC-7562) and is acceptable here
///      ONLY because Corral submits through its own relayer (D13) — this
///      policy must never be relied on for ops relayed by third parties.
///
///      Storage is keyed [configId][multiplexer = SmartSessions][account],
///      exactly like Rhinestone's policies, so a session's config id maps to
///      it the same way post-install verification expects.
contract CorralRateLimitPolicy is IUserOpPolicy {
    /// @notice Hard ceiling on `limit`, bounding validation gas.
    uint32 public constant MAX_LIMIT = 64;

    struct RateLimitConfig {
        uint32 limit; // executions allowed per window; 0 = not initialized
        uint32 window; // seconds
        uint32 head; // next ring slot to overwrite
        uint32 count; // stored timestamps (≤ limit)
    }

    mapping(ConfigId id => mapping(address multiplexer => mapping(address account => RateLimitConfig))) internal
        $configs;
    mapping(ConfigId id => mapping(address multiplexer => mapping(address account => mapping(uint256 slot => uint48))))
        internal $ring;

    /// @inheritdoc IPolicy
    /// @dev initData = abi.encode(uint32 limit, uint32 windowSeconds).
    ///      Re-initialization (session re-enable) resets the ring.
    function initializeWithMultiplexer(address account, ConfigId configId, bytes calldata initData) external {
        if (initData.length != 64) revert PolicyNotInitialized(configId, msg.sender, account);
        (uint32 limit, uint32 window) = abi.decode(initData, (uint32, uint32));
        if (limit == 0 || limit > MAX_LIMIT || window == 0) revert PolicyNotInitialized(configId, msg.sender, account);
        $configs[configId][msg.sender][account] = RateLimitConfig({limit: limit, window: window, head: 0, count: 0});
        emit PolicySet(configId, msg.sender, account);
    }

    /// @inheritdoc IUserOpPolicy
    function checkUserOpPolicy(ConfigId id, PackedUserOperation calldata userOp) external returns (uint256) {
        RateLimitConfig storage cfg = $configs[id][msg.sender][userOp.sender];
        uint32 limit = cfg.limit;
        if (limit == 0) revert PolicyNotInitialized(id, msg.sender, userOp.sender);

        uint48 nowTs = uint48(block.timestamp);
        if (_usedInWindow(id, msg.sender, userOp.sender, cfg, nowTs) >= limit) {
            return VALIDATION_FAILED;
        }

        mapping(uint256 => uint48) storage ring = $ring[id][msg.sender][userOp.sender];
        ring[cfg.head] = nowTs;
        cfg.head = (cfg.head + 1) % limit;
        if (cfg.count < limit) cfg.count += 1;
        return VALIDATION_SUCCESS;
    }

    /// @notice Executions recorded inside the trailing window as of `asOf`.
    function getUsedInWindow(ConfigId id, address multiplexer, address account, uint48 asOf)
        external
        view
        returns (uint32)
    {
        return _usedInWindow(id, multiplexer, account, $configs[id][multiplexer][account], asOf);
    }

    /// @notice Stored configuration — read back by post-install verification.
    function getRateLimitConfig(ConfigId id, address multiplexer, address account)
        external
        view
        returns (uint32 limit, uint32 window, uint32 count)
    {
        RateLimitConfig storage cfg = $configs[id][multiplexer][account];
        return (cfg.limit, cfg.window, cfg.count);
    }

    function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
        return interfaceID == type(IERC165).interfaceId || interfaceID == type(IPolicy).interfaceId
            || interfaceID == type(IUserOpPolicy).interfaceId;
    }

    function _usedInWindow(
        ConfigId id,
        address multiplexer,
        address account,
        RateLimitConfig storage cfg,
        uint48 asOf
    ) internal view returns (uint32 used) {
        uint32 count = cfg.count;
        if (count == 0) return 0;
        // Trailing window: an execution at t counts iff t > asOf - window.
        uint48 window = cfg.window;
        uint48 windowStart = asOf > window ? asOf - window : 0;
        mapping(uint256 => uint48) storage ring = $ring[id][multiplexer][account];
        for (uint256 i = 0; i < count; i++) {
            uint48 t = ring[i];
            if (t > windowStart) used += 1;
        }
    }
}
