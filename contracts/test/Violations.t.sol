// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PackedUserOperation} from "../src/interfaces/ISmartSessionPolicy.sol";
import {
    ActionData,
    ICorralJournal,
    IEntryPoint,
    IERC20,
    IERC7579Execution,
    ISmartSession,
    ISwapRouter02,
    Session
} from "./interfaces/IMatrix.sol";

/// @title The violation matrix (spec §10.1, FR-3.2, CLAUDE.md §2.13)
/// @notice One test per bypass attempt, each asserting the chain rejects it.
///         Runs on a Base Sepolia fork against the live, pinned module set
///         and the EXACT session our TypeScript composer produces (fixture
///         emitted by server/src/scripts/evmMatrixFixture.ts). The session is
///         enabled directly on the live dev account via vm.prank — this file
///         tests ENFORCEMENT; installation is proven by T-008.
///
///         "Rejected" means EntryPoint.handleOps reverts during validation:
///         no execution happens, nothing moves. Cases that a session cannot
///         reject on-chain by design are stated as such, not hidden.
///
///         Never edit a case to make it pass (CLAUDE.md §2.13). A case that
///         cannot be made to revert is a design conversation.
contract ViolationMatrix is Test {
    // ── Pinned Base Sepolia addresses (must match server addresses.ts) ──────
    IEntryPoint internal constant EP = IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
    ISmartSession internal constant SS = ISmartSession(0x00000000008bDABA73cD9815d79069c247Eb4bDA);
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    address internal constant JOURNAL = 0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F;
    /// Another live Safe7579 account with SmartSessions but NOT this permission (dev-owner-salt4).
    address internal constant OTHER_ACCOUNT = 0xB49797eeaf684fB4Fbbc65CCf04cFA78BB094ef0;

    uint256 internal constant AGENT_PK = 0xA11CE;
    bytes32 internal constant MODE_SINGLE = bytes32(0); // callType single, execType default (revert)
    bytes32 internal constant MODE_BATCH = bytes32(uint256(0x01) << 248);
    uint24 internal constant FEE = 3000;
    uint256 internal constant PER_EXEC = 125_000_000; // 125 USDC
    uint256 internal constant BUDGET = 500_000_000; // 500 USDC
    uint256 internal constant FLOOR = 1_000_000_000_000_000; // amountOutMinimum floor in fixture

    address internal account;
    address internal agent;
    address internal relayer;
    address internal attacker;
    bytes32 internal permissionId;
    uint256 internal validAfter;
    uint256 internal validUntil;

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    // ── Setup: fork + enable the composer's session on the live account ─────

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true); // fork tests need an RPC; CI supplies FORK_RPC_URL
            return;
        }
        vm.createSelectFork(rpc);

        string memory json = vm.readFile("test/fixtures/matrix-session.json");
        account = vm.parseJsonAddress(json, ".account");
        agent = vm.parseJsonAddress(json, ".agent");
        permissionId = vm.parseJsonBytes32(json, ".permissionId");
        validAfter = vm.parseJsonUint(json, ".validAfter");
        validUntil = vm.parseJsonUint(json, ".validUntil");
        Session memory session = abi.decode(vm.parseJsonBytes(json, ".sessionAbi"), (Session));

        assertEq(vm.addr(AGENT_PK), agent, "fixture agent must be vm.addr(AGENT_PK)");

        Session[] memory sessions = new Session[](1);
        sessions[0] = session;
        vm.prank(account);
        bytes32[] memory ids = SS.enableSessions(sessions);
        assertEq(ids[0], permissionId, "permissionId must match the composer's");
        assertTrue(SS.isPermissionEnabled(permissionId, account));

        relayer = makeAddr("relayer");
        attacker = makeAddr("attacker");
        vm.deal(relayer, 10 ether);
        vm.deal(account, 1 ether); // prefunds EntryPoint gas
        vm.deal(OTHER_ACCOUNT, 1 ether);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _nonce(address sender) internal view returns (uint256) {
        uint192 key = uint192(uint160(address(SS))) << 32; // validator in nonce[255:96]
        return EP.getNonce(sender, key);
    }

    function _op(address sender, bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.nonce = _nonce(sender);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(2_000_000) << 128) | 2_000_000);
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32((uint256(1 gwei) << 128) | 1 gwei);
    }

    function _sign(PackedUserOperation memory op) internal view returns (PackedUserOperation memory) {
        return _signHash(op, EP.getUserOpHash(op));
    }

    function _signHash(PackedUserOperation memory op, bytes32 hash) internal pure returns (PackedUserOperation memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PK, hash);
        op.signature = abi.encodePacked(bytes1(0x00), permissionIdOf(op), abi.encodePacked(r, s, v));
        return op;
    }

    function permissionIdOf(PackedUserOperation memory) internal pure returns (bytes32) {
        return bytes32(0); // overwritten below via _withPid; keeps _signHash pure for V17/V18
    }

    function _withPid(PackedUserOperation memory op, bytes32 pid) internal pure returns (PackedUserOperation memory) {
        // replace the zero permissionId placeholder (bytes 1..33) with the real one
        bytes memory sig = op.signature;
        for (uint256 i = 0; i < 32; i++) {
            sig[1 + i] = pid[i];
        }
        op.signature = sig;
        return op;
    }

    function _ready(PackedUserOperation memory op) internal view returns (PackedUserOperation memory) {
        return _withPid(_sign(op), permissionId);
    }

    function _submit(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(relayer);
        EP.handleOps(ops, payable(relayer));
    }

    /// Rejection = handleOps reverts (validation phase). Execution never runs.
    function _expectRejected(PackedUserOperation memory op, string memory why) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(relayer);
        try EP.handleOps(ops, payable(relayer)) {
            fail(string.concat("NOT REJECTED: ", why));
        } catch {}
    }

    function _single(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (MODE_SINGLE, abi.encodePacked(target, value, data)));
    }

    function _batch(Execution[] memory execs) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (MODE_BATCH, abi.encode(execs)));
    }

    function _approve(address spender, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC20.approve, (spender, amount));
    }

    function _swap(address tokenIn, address tokenOut, address recipient, uint256 amountIn, uint256 minOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(
            ISwapRouter02.exactInputSingle,
            (ISwapRouter02.ExactInputSingleParams(tokenIn, tokenOut, FEE, recipient, amountIn, minOut, 0))
        );
    }

    function _journal() internal view returns (bytes memory) {
        return abi.encodeCall(ICorralJournal.log, (permissionId, keccak256("intent"), bytes32(0), 1));
    }

    /// A policy-conformant approve (spender = SwapRouter02): passes validation and executes.
    function _okApprove(uint256 amount) internal {
        _submit(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, amount)))));
    }

    // ── V0: the harness proves a conformant op is accepted AND executed ─────

    function test_V0_conformant_approve_is_accepted_and_executed() public {
        _okApprove(100_000_000);
        assertEq(IERC20(USDC).allowance(account, ROUTER), 100_000_000, "execution must have happened");
    }

    // ── V1–V7: scope, budget, ceilings, recipient pin, slippage floor ───────

    function test_V1_asset_outside_scope_reverts() public {
        // swap tokenIn = WETH: not in the IN_SET rule for param 0
        _expectRejected(
            _ready(_op(account, _single(ROUTER, 0, _swap(WETH, USDC, account, 1 ether, FLOOR)))), "V1 asset out of scope"
        );
    }

    function test_V2_cumulative_budget_exceeded_by_one_wei_reverts() public {
        // 4 x 125 USDC = exactly the 500 USDC budget (warp past the 2/day rate limit)
        for (uint256 i = 0; i < 4; i++) {
            if (i == 2) vm.warp(block.timestamp + 1 days + 1);
            _okApprove(PER_EXEC);
        }
        vm.warp(block.timestamp + 1 days + 1);
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V2 budget + 1 wei");
    }

    function test_V3_per_execution_ceiling_exceeded_reverts() public {
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, PER_EXEC + 1)))), "V3 ceiling + 1");
    }

    function test_V4_non_whitelisted_contract_reverts() public {
        _expectRejected(_ready(_op(account, _single(WETH, 0, _approve(ROUTER, 1)))), "V4 WETH not a target");
    }

    function test_V5_whitelisted_contract_non_whitelisted_selector_reverts() public {
        _expectRejected(
            _ready(_op(account, _single(USDC, 0, abi.encodeCall(IERC20.transfer, (attacker, 1))))), "V5 transfer selector"
        );
    }

    function test_V6_swap_recipient_not_account_reverts() public {
        _expectRejected(
            _ready(_op(account, _single(ROUTER, 0, _swap(USDC, WETH, attacker, PER_EXEC, FLOOR)))),
            "V6 recipient != account (the anti-exfiltration pin)"
        );
    }

    function test_V7_amountOutMinimum_below_floor_reverts() public {
        _expectRejected(
            _ready(_op(account, _single(ROUTER, 0, _swap(USDC, WETH, account, PER_EXEC, FLOOR - 1)))),
            "V7 amountOutMinimum below floor"
        );
    }

    // ── V8–V11: time window and usage limits ────────────────────────────────

    function test_V8_execute_after_validUntil_reverts() public {
        vm.warp(validUntil + 1);
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V8 after validUntil");
    }

    function test_V9_execute_before_validAfter_reverts() public {
        vm.warp(validAfter - 1);
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V9 before validAfter");
    }

    function test_V10_exceed_maxExecutions_reverts() public {
        // 8 executions over 4 days (2/day), staying under budget (8 x 50 = 400 USDC)
        for (uint256 i = 0; i < 8; i++) {
            if (i > 0 && i % 2 == 0) vm.warp(block.timestamp + 1 days + 1);
            _okApprove(50_000_000);
        }
        vm.warp(block.timestamp + 1 days + 1);
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V10 9th execution");
    }

    function test_V11_exceed_maxExecutionsPer24h_reverts() public {
        _okApprove(1);
        vm.warp(block.timestamp + 1 hours);
        _okApprove(1);
        vm.warp(block.timestamp + 1 hours);
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V11 3rd within 24h");
        // and it frees up once the first falls out of the window
        vm.warp(block.timestamp + 1 days);
        _okApprove(1);
    }

    // ── V12–V15: native value, approvals, revocation ────────────────────────

    function test_V12_native_value_with_zero_cap_reverts() public {
        _expectRejected(_ready(_op(account, _single(USDC, 1 wei, _approve(ROUTER, 1)))), "V12 1 wei native value");
    }

    function test_V13_unbounded_approval_reverts() public {
        _expectRejected(
            _ready(_op(account, _single(USDC, 0, _approve(ROUTER, type(uint256).max)))), "V13 approve max"
        );
    }

    function test_V14_approve_to_non_allowlisted_spender_reverts() public {
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(attacker, 1)))), "V14 spender not allowed");
    }

    function test_V15_execute_after_removeSession_reverts() public {
        vm.prank(account);
        SS.removeSession(permissionId);
        assertFalse(SS.isPermissionEnabled(permissionId, account));
        _expectRejected(_ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1)))), "V15 revoked session");
    }

    // ── V16–V18: replay protection ──────────────────────────────────────────

    function test_V16_replay_used_userOp_reverts() public {
        PackedUserOperation memory op = _ready(_op(account, _single(USDC, 0, _approve(ROUTER, 1))));
        _submit(op);
        _expectRejected(op, "V16 identical op replayed (nonce)");
    }

    function test_V17_userOp_signed_for_another_chain_reverts() public {
        PackedUserOperation memory op = _op(account, _single(USDC, 0, _approve(ROUTER, 1)));
        vm.chainId(8453); // sign the hash Base mainnet would produce
        bytes32 foreignHash = EP.getUserOpHash(op);
        vm.chainId(84532);
        op = _withPid(_signHash(op, foreignHash), permissionId);
        _expectRejected(op, "V17 signature bound to another chain");
    }

    function test_V18_userOp_signed_for_another_account_reverts() public {
        // Same agent signature envelope, different sender: that account has no such permission.
        PackedUserOperation memory op = _op(OTHER_ACCOUNT, _single(USDC, 0, _approve(ROUTER, 1)));
        _expectRejected(_withPid(_sign(op), permissionId), "V18 session not enabled on that account");
    }

    // ── V19–V20: alternative entry points into the account ──────────────────

    function test_V19_direct_execute_and_executor_paths_reject_the_agent() public {
        bytes memory exec = abi.encodePacked(USDC, uint256(0), _approve(ROUTER, 1));
        vm.startPrank(agent);
        vm.expectRevert();
        IERC7579Execution(account).execute(MODE_SINGLE, exec);
        vm.expectRevert();
        IERC7579Execution(account).executeFromExecutor(MODE_SINGLE, exec);
        vm.stopPrank();
    }

    function test_V20_fallback_handler_does_not_execute() public {
        vm.prank(agent);
        (bool ok,) = account.call(abi.encodeWithSelector(bytes4(0xdeadbeef), ROUTER, uint256(1)));
        assertFalse(ok, "unknown selector must not be routed anywhere useful");
        assertEq(IERC20(USDC).allowance(account, ROUTER), 0);
    }

    // ── V21–V25: batches, journal, paymaster, validators, nesting ───────────

    function test_V21_batch_with_one_forbidden_call_rejects_whole_batch() public {
        Execution[] memory execs = new Execution[](2);
        execs[0] = Execution(USDC, 0, _approve(ROUTER, 1)); // permitted
        execs[1] = Execution(USDC, 0, abi.encodeCall(IERC20.transfer, (attacker, 1))); // forbidden
        _expectRejected(_ready(_op(account, _batch(execs))), "V21 batch with forbidden call");
        assertEq(IERC20(USDC).allowance(account, ROUTER), 0, "nothing from the batch may execute");
    }

    /// V22 — spec: "revert OR preflight reject". The session deliberately does
    /// not require a journal call (a journal-only policy would be another
    /// contract). Omission is rejected by the off-chain preflight (pipeline
    /// epic); on-chain the batch is a normal permitted execution. Stated, not hidden.
    function test_V22_journal_omission_is_a_preflight_rule_not_onchain() public {
        Execution[] memory execs = new Execution[](2);
        execs[0] = Execution(USDC, 0, _approve(ROUTER, 1));
        execs[1] = Execution(JOURNAL, 0, _journal());
        _submit(_ready(_op(account, _batch(execs)))); // the product shape: action + journal
        assertEq(IERC20(USDC).allowance(account, ROUTER), 1);
    }

    function test_V23_sponsored_op_cannot_bypass_policy() public {
        // permitERC4337Paymaster=false in the session, and the op violates policy anyway.
        PackedUserOperation memory op = _op(account, _single(USDC, 0, _approve(attacker, 1)));
        op.paymasterAndData = abi.encodePacked(attacker, uint128(200_000), uint128(200_000));
        _expectRejected(_withPid(_sign(op), permissionId), "V23 paymaster-sponsored violation");
    }

    /// V24 — a rogue validator installed by the OWNER is not a session bypass:
    /// only the owner can install modules (asserted), and the session policy
    /// is unaffected by other validators. Detection + auto-pause of an
    /// unexpected module set is the module monitor (FR-1.5, pipeline epic).
    function test_V24_agent_cannot_install_a_validator() public {
        vm.prank(agent);
        vm.expectRevert();
        IERC7579Execution(account).installModule(1, attacker, "");
        // and via a session userOp: installModule on self is not an allowed action
        _expectRejected(
            _ready(_op(account, _single(account, 0, abi.encodeCall(IERC7579Execution.installModule, (1, attacker, ""))))),
            "V24 installModule through the session"
        );
    }

    function test_V25_reduced_amountIn_with_redirect_via_nested_call_reverts() public {
        Execution[] memory execs = new Execution[](2);
        execs[0] = Execution(ROUTER, 0, _swap(USDC, WETH, account, 1, FLOOR)); // tiny, conformant
        execs[1] = Execution(WETH, 0, abi.encodeCall(IERC20.transfer, (attacker, 1))); // redirect output
        _expectRejected(_ready(_op(account, _batch(execs))), "V25 output redirected by a nested call");
    }
}
