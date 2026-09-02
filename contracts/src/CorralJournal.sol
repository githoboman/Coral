// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CorralJournal
/// @notice Append-only commitment linking an on-chain execution to the off-chain
///         intent that caused it (FR-3.4). No storage, no funds, no roles, no
///         upgradeability — the event log IS the contract.
/// @dev Deployed via CREATE2 with a fixed salt so the address is identical
///      across chains. The account calls `log` as the final call of every
///      execution batch; a batch whose journal call reverts must revert as a
///      whole (FR-3.5), which is enforced by batch construction, not here.
contract CorralJournal {
    event Logged(
        address indexed account,
        bytes32 indexed sessionId,
        bytes32 indexed intentHash,
        bytes32 strategyId,
        uint32 seq,
        uint64 timestamp
    );

    /// @notice Commit an execution to the journal.
    /// @dev Called by the account itself, so `msg.sender` is the account. No
    ///      access control: a third party emitting noise cannot affect any
    ///      account's verified history, because consumers filter on `account`.
    /// @param sessionId  The SmartSessions permission id the execution ran under.
    /// @param intentHash Hash of the off-chain intent that produced the Plan.
    /// @param strategyId The strategy that scheduled it (zero for one-offs).
    /// @param seq        Monotonic per-session sequence number (idempotency key part).
    function log(bytes32 sessionId, bytes32 intentHash, bytes32 strategyId, uint32 seq) external {
        emit Logged(msg.sender, sessionId, intentHash, strategyId, seq, uint64(block.timestamp));
    }
}
