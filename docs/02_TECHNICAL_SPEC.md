# Corral — Technical Specification (v2, Rust + self-hosted)

**Version:** 2.0 — supersedes v1.0 (TypeScript + serverless)
**Companion to:** `00_FEASIBILITY_AND_TIMELINE.md` v2, `01_PRD.md`
**Target:** Base Sepolia → Base mainnet
**Languages:** Rust 1.8x (backend + shared core), TypeScript (frontend), Solidity 0.8.28
**Date:** 30 July 2026

---

## 1. Trust boundaries

```
┌──────────────────────────── TRUSTED ────────────────────────────┐
│  Owner key / passkey       root authority, can do anything      │
│  Base consensus + sequencer                                     │
│  Audited modules           SmartSessions + policy modules       │
│  CorralJournal             our contract, audited                │
│  KMS/HSM                   holds signing keys, never exports    │
└─────────────────────────────────────────────────────────────────┘
┌──────────────────────── UNTRUSTED ──────────────────────────────┐
│  Every service we operate: API, job runner, planner, signer     │
│  service, relayer, indexer, database, frontend, nodes.          │
│  Full compromise of ALL of these ⇒ loss bounded by policy.      │
└─────────────────────────────────────────────────────────────────┘
```

Self-hosting **does not move anything from untrusted to trusted.** Our own servers are as untrusted as a vendor's. The KMS boundary is the only addition: it holds key material we cannot extract, which means a compromised signer service can request signatures (bounded by policy) but cannot steal keys (unbounded, forever).

**The governing test for every change:** if an attacker owns the entire untrusted zone, is the maximum loss still "the active session's remaining per-asset budget, to policy-permitted destinations only"? If not, the change is wrong.

---

## 2. Repository layout

Cargo workspace + a pnpm frontend + Foundry contracts.

```
corral/
├─ Cargo.toml                      # workspace
├─ crates/
│  ├─ corral-core/                 # ⚠️ NO I/O, NO chain client, NO db. Pure logic.
│  │  ├─ src/policy.rs             # Policy, ValidatedPolicy, constraints
│  │  ├─ src/action.rs             # Action DSL, Plan
│  │  ├─ src/amount.rs             # TokenAmount newtype
│  │  ├─ src/events.rs             # CorralEvent
│  │  ├─ src/errors.rs             # error taxonomy + retry classes
│  │  ├─ src/strategy.rs           # strategy config + state machine
│  │  ├─ src/encode/               # Policy → SmartSessions config  ⚠️ security-critical
│  │  └─ src/wasm.rs               # #[cfg(feature = "wasm")] bindings
│  ├─ corral-chain/                # alloy: reads, preflight, calldata compilation
│  ├─ corral-adapters/             # IProtocolAdapter trait + uniswap_v3
│  ├─ corral-signer/               # KMS-backed signing service
│  ├─ corral-relayer/              # EntryPoint.handleOps submission + nonce allocator
│  ├─ corral-jobs/                 # Postgres queue + workers
│  ├─ corral-indexer/              # log poller → Postgres
│  ├─ corral-api/                  # axum HTTP API
│  └─ corral-db/                   # sqlx queries + migrations
├─ apps/web/                       # EXISTING frontend, Next.js + TS
│  └─ packages/core-wasm/          # generated: wasm-pack output + .d.ts
├─ contracts/                      # Foundry
│  ├─ src/CorralJournal.sol
│  └─ test/Violations.t.sol
├─ harness/encoder-diff/           # Node harness: reference TS SDK vs Rust encoder
├─ infra/                          # Terraform + Ansible, runbooks
└─ .github/workflows/
```

### Hard architectural rules (CI-enforced)

| Rule | Check |
|---|---|
| `corral-core` has no I/O, no `tokio`, no `sqlx`, no network | `cargo-deny` + dependency allowlist per crate |
| `corral-core` compiles to `wasm32-unknown-unknown` | CI build target |
| Frontend never hand-writes a shared type | `.d.ts` generated only; CI fails if `core-wasm/` is dirty after regeneration |
| No policy-widening path outside session install | `cargo-deny` ban + grep for `enableSessions` outside `corral-core::encode` and the install handler |
| No unbounded approvals | unit test on the encoder; grep for `U256::MAX` in approval construction |
| No raw key material | `gitleaks`; `corral-signer` is the only crate allowed to depend on the KMS SDK |
| Amounts are `TokenAmount`, never `u64`/`f64` | newtype makes it structural; clippy lint bans `as` casts on amounts |
| `unsafe` forbidden | `#![forbid(unsafe_code)]` in every crate |

---

## 3. The shared core

### 3.1 Amounts as a type, not a convention

```rust
// crates/corral-core/src/amount.rs
use alloy_primitives::U256;
use serde::{Deserialize, Serialize};

/// A token amount in base units. Deliberately NOT convertible to/from
/// floats or primitive integers without an explicit, checked call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TokenAmount(U256);

impl TokenAmount {
    pub const ZERO: Self = Self(U256::ZERO);

    pub fn from_base_units(v: U256) -> Self { Self(v) }
    pub fn get(self) -> U256 { self.0 }

    /// Checked arithmetic only. There is no `Add` impl on purpose:
    /// a silent overflow in a spending limit is the worst bug this system can have.
    pub fn checked_add(self, o: Self) -> Option<Self> { self.0.checked_add(o.0).map(Self) }
    pub fn checked_sub(self, o: Self) -> Option<Self> { self.0.checked_sub(o.0).map(Self) }
}

// Serialises as a decimal string over the wire and into Postgres numeric(78,0).
```

This deletes the entire bug class that v1 addressed with a lint rule.

### 3.2 Parse, don't validate

```rust
// crates/corral-core/src/policy.rs
use alloy_primitives::{Address, B256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawPolicy {           // what arrives from the wire — untrusted
    pub version: u8,
    pub chain_id: u64,
    pub asset_scope: Vec<AssetRef>,
    pub budgets: Vec<BudgetConstraint>,
    pub max_native_value: TokenAmount,
    pub target_scope: Vec<TargetConstraint>,
    pub action_scope: Vec<ActionKind>,
    pub valid_after: u64,
    pub valid_until: u64,
    pub max_executions: u32,
    pub max_executions_per_24h: u32,
    pub min_output_bps: u16,
}

/// A policy that has passed every invariant check. Cannot be constructed
/// any other way. Everything downstream takes this type, never RawPolicy.
#[derive(Debug, Clone, Serialize)]
pub struct ValidatedPolicy(RawPolicy);

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PolicyError {
    #[error("validUntil must be after validAfter")]
    BadTimeWindow,
    #[error("24h execution cap exceeds total cap")]
    UsageCapsInconsistent,
    #[error("asset {0} is in scope but has no budget")]
    AssetWithoutBudget(String),
    #[error("swap target {0} lacks a recipient==account rule")]
    MissingRecipientPin(Address),
    #[error("approval to {0} is unbounded")]
    UnboundedApproval(Address),
    #[error("minOutputBps {0} outside 5000..=10000")]
    SlippageOutOfRange(u16),
}

impl TryFrom<RawPolicy> for ValidatedPolicy {
    type Error = PolicyError;

    fn try_from(p: RawPolicy) -> Result<Self, Self::Error> {
        if p.valid_until <= p.valid_after { return Err(PolicyError::BadTimeWindow); }
        if p.max_executions_per_24h > p.max_executions { return Err(PolicyError::UsageCapsInconsistent); }
        if !(5000..=10000).contains(&p.min_output_bps) {
            return Err(PolicyError::SlippageOutOfRange(p.min_output_bps));
        }

        // Every in-scope asset must carry a budget. An asset in scope without a
        // budget is an unbounded spend — the exact bug this product exists to prevent.
        for a in &p.asset_scope {
            if !p.budgets.iter().any(|b| b.asset.same_as(a)) {
                return Err(PolicyError::AssetWithoutBudget(a.symbol.clone()));
            }
        }

        // Every swap target must pin the recipient to the account, or the agent
        // can swap the user's funds and send the output anywhere. Budget caps
        // bound theft; they do not prevent it. See §5.3.
        for t in &p.target_scope {
            if t.is_swap_target() && !t.has_recipient_pin() {
                return Err(PolicyError::MissingRecipientPin(t.address));
            }
            if let Some(spender) = t.unbounded_approval_spender() {
                return Err(PolicyError::UnboundedApproval(spender));
            }
        }
        Ok(ValidatedPolicy(p))
    }
}
```

`ValidatedPolicy` is the only type the encoder, the compiler and the API accept. "Unvalidated policy past the boundary" is unrepresentable.

### 3.3 WASM bindings for the frontend

```rust
// crates/corral-core/src/wasm.rs
#![cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;
use tsify::Tsify;

/// Validate a policy in the browser using EXACTLY the backend's logic.
/// The UI's "worst case" panel (FR-11.1) is rendered from this output,
/// so what the user is shown cannot drift from what is enforced.
#[wasm_bindgen]
pub fn validate_policy(json: &str) -> Result<JsValue, JsValue> {
    let raw: RawPolicy = serde_json::from_str(json).map_err(err)?;
    let validated = ValidatedPolicy::try_from(raw).map_err(err)?;
    Ok(serde_wasm_bindgen::to_value(&validated.summary())?)
}

/// Human-readable worst-case summary, generated once, shown identically
/// in the app, the standalone revoke page, and any future client.
#[wasm_bindgen]
pub fn policy_summary(json: &str) -> Result<JsValue, JsValue> { /* … */ }

#[wasm_bindgen]
pub fn policy_hash(json: &str) -> Result<String, JsValue> { /* keccak of canonical form */ }
```

Build: `wasm-pack build crates/corral-core --features wasm --target bundler --out-dir apps/web/packages/core-wasm`. TypeScript definitions are generated by `tsify`. **CI regenerates and fails if the checked-in output differs** — that's what makes drift impossible rather than merely discouraged.

Frontend consumption:

```ts
import init, { validate_policy, policy_summary } from "@corral/core";

await init();
const summary = policy_summary(JSON.stringify(draft));
// summary.maxTotalSpend, summary.permittedDestinations, summary.expiresAt …
```

---

## 4. On-chain design

Unchanged from v1. Restated here so this document stands alone.

### 4.1 Module manifest (the approved install set)

| Module | Type | Source | Purpose |
|---|---|---|---|
| `SmartSessions` | validator | audited, third-party | Session validation + policy dispatch |
| `UniversalActionPolicy` | action policy | audited | Target + selector + parameter constraints |
| `SpendingLimitsPolicy` | policy | audited | Per-ERC-20 cumulative budget |
| `ValueLimitPolicy` | policy | audited | Native value cap |
| `TimeFramePolicy` | policy | audited | validAfter / validUntil |
| `UsageLimitPolicy` | policy | audited | Execution count cap |
| `CorralJournal` | contract | **ours** | Intent-hash commitment |

Addresses are pinned per chain in `corral-chain::addresses`, with a CI test asserting the on-chain codehash matches the pinned hash. **Never resolve module addresses from a registry at runtime.**

### 4.2 The only custom contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CorralJournal
/// @notice Append-only commitment linking an on-chain execution to the off-chain
///         intent that caused it. No storage, no funds, no roles, no upgradeability.
contract CorralJournal {
    event Logged(
        address indexed account,
        bytes32 indexed sessionId,
        bytes32 indexed intentHash,
        bytes32 strategyId,
        uint32  seq,
        uint64  timestamp
    );

    /// @dev Called by the account itself as the final call of every batch.
    ///      No access control: a third party emitting noise cannot affect any
    ///      account's verified history, because consumers filter on `account`.
    function log(bytes32 sessionId, bytes32 intentHash, bytes32 strategyId, uint32 seq) external {
        emit Logged(msg.sender, sessionId, intentHash, strategyId, seq, uint64(block.timestamp));
    }
}
```

Deployed via CREATE2 with a fixed salt so the address is identical across chains.

### 4.3 Worked session configuration

Weekly DCA: up to 500 USDC → WETH, 30 days, Uniswap v3 only, output returns to the account.

```
SmartSessions session:
  sessionValidator = ECDSA validator, signer = <per-user session signer>
  permissionId     = keccak256(account, signer, salt)

  userOpPolicies:
    ValueLimitPolicy  : maxNativeValue = 0
    UsageLimitPolicy  : maxUses = 8

  actions:
    A1  USDC.approve(address,uint256)
          arg0 spender   IN_SET { Permit2 }
          arg1 amount    LTE    125_000_000      # per-execution, NOT total budget
    A2  SwapRouter02.exactInputSingle((...))
          tokenIn        IN_SET { USDC }
          tokenOut       IN_SET { WETH }
          fee            IN_SET { 500, 3000 }
          recipient      EQ_ACCOUNT              # prevents exfiltration
          amountIn       LTE    125_000_000
          amountOutMin   GTE    <computed floor>
    A3  CorralJournal.log(bytes32,bytes32,bytes32,uint32)
          value must be 0

  actionPolicies:
    SpendingLimitsPolicy : { USDC: 500_000_000 }  # cumulative
    TimeFramePolicy      : validAfter = now, validUntil = now + 30d
```

Two details that are cheap to get wrong and expensive to have wrong:

1. **`recipient EQ_ACCOUNT` is what prevents theft.** Budget caps bound the loss; only the recipient pin prevents the agent swapping the user's USDC and sending the WETH elsewhere. Enforced structurally by `PolicyError::MissingRecipientPin` (§3.2).
2. **The approval ceiling equals the per-execution amount, not the total budget.** Otherwise a compromised runtime approves the full budget once and drains it via Permit2 outside the session.

### 4.4 Revocation

| Step | Where | Latency | Effect |
|---|---|---|---|
| 1 | Signer service: mark session signer disabled; KMS key policy denies further signing | <1s | No new signatures possible |
| 2 | Relayer: drain and refuse pending submissions for that session | <1s | Nothing new reaches the sequencer |
| 3 | On-chain: `SmartSessions.removeSession(permissionId)` | ~2s | All future validation fails |
| 4 | Same tx: bump the agent's nonce key | same tx | Any already-broadcast userOp fails validation |

Steps 1–2 are what your Tier 3 decision buys: with an own relayer, **no signed operation exists in a mempool you don't control**, so the race window is your own submission latency and it is observable. A transaction already included in a block still cannot be reversed — say so plainly in the UI.

The standalone revoke page (FR-8.3) is static HTML/JS using viem, the user's injected wallet, and a public RPC, with hardcoded addresses. It must not call our API, our nodes, or our WASM build pipeline. Test it with every Corral service powered off.

---

## 5. The policy encoder ⚠️

**The highest-risk component in v2.** `corral-core::encode` converts a `ValidatedPolicy` into SmartSessions configuration: `permissionId` derivation, `enableSessions` calldata, per-policy init data, and action-policy parameter rules. No Rust implementation of this exists upstream; we are writing it against the Solidity.

An encoding bug does not crash. It produces a session that installs cleanly, displays correctly, and **enforces something other than what the user agreed to.**

### 5.1 Use generated ABI types

```rust
use alloy::sol;

sol! {
    #[sol(rpc)]
    contract SmartSession {
        function enableSessions(Session[] calldata sessions) external returns (PermissionId[] memory);
        // …generated from the actual contract source, not hand-transcribed
    }
}
```

Hand-written logic is restricted to *composition* — which policies, in what order, with what init data. Struct encoding is generated.

### 5.2 Differential test harness (release-blocking)

```
corral-core::encode  ──▶ bytes_rust ─┐
                                      ├─▶ assert byte-equality, 10,000 generated policies
reference TS SDK     ──▶ bytes_ts   ─┘
```

`harness/encoder-diff/` is a Node project used **only in CI and local testing**, never in production. `proptest` generates policies on the Rust side, serialises them to JSON, invokes the harness, and compares hex output.

This is what makes reimplementing a security-critical encoder acceptable. **Gate G1′ does not pass without it.** If the harness is ever disabled to unblock a build, that is an incident, not a workaround.

### 5.3 Post-install verification

Belt and braces, cheap, catches anything the harness misses:

```rust
// After the owner's install transaction confirms, read the session config back
// from chain, decode it, and assert it equals the policy the user signed.
// Only then mark the session ACTIVE. A mismatch pauses and pages.
let onchain = chain.read_session_config(permission_id).await?;
let decoded = corral_core::encode::decode(&onchain)?;
if decoded != validated_policy {
    return Err(Error::EncoderDivergence { permission_id });   // pages on-call
}
```

---

## 6. Services

### 6.1 Signer service (`corral-signer`)

The only crate permitted to depend on the KMS SDK.

- One KMS key per user session signer, plus one for the relayer EOA.
- `sign_user_op_hash(session_id, hash)` → checks the session is ACTIVE and not revoked, then requests a KMS signature.
- KMS returns DER-encoded ECDSA. The service parses `r`/`s` (via `k256`), normalises to **low-s**, and derives the recovery id by recovering against the known public key. Getting low-s normalisation wrong yields signatures that fail on-chain intermittently — test it explicitly.
- Every signing request is logged with session id, hash, requester and outcome. The log is append-only and shipped off-box.
- **Refuses to sign for a revoked or expired session**, independently of the caller. Defence in depth: this is the layer that replaces the vendor policy engine we gave up.

**Scaling note (D18):** one KMS key per session is fine at v1 scale. Past a few thousand sessions, per-key cost and API rate limits bind, and the migration is to enclave-held derived keys from a single master seed. Design the interface now so that migration is internal to this crate.

### 6.2 Relayer (`corral-relayer`)

Replaces the third-party bundler. Submits our own userOps via `EntryPoint.handleOps`.

- **Nonce allocator:** single writer, persisted in Postgres, guarded by a session-scoped advisory lock. Nonce gaps stall everything, so this is the component to over-test.
- **Gas:** EIP-1559 with a bump schedule; replacement-by-fee for stuck transactions; balance monitor with auto-refill alert.
- **Sponsorship (v1):** prefunded EntryPoint deposits per account. An own verifying paymaster is v1.1.
- **Standby relayer:** a second EOA and key, cold, promotable by config. R17.
- **Refuses submission** for sessions marked revoked, mirroring the signer's check.

The relayer never constructs a plan and never widens a policy. It receives signed userOps and submits them; that's the whole job.

### 6.3 Job runner (`corral-jobs`)

Own Postgres queue. Deliberately not Temporal — see feasibility §3.

```sql
-- Claim one job, skipping any row another worker holds.
UPDATE jobs
SET status = 'RUNNING', locked_at = now(), locked_by = $1, attempt = attempt + 1
WHERE id = (
  SELECT j.id FROM jobs j
  WHERE j.status = 'PENDING'
    AND j.run_at <= now()
    AND NOT EXISTS (                      -- per-session concurrency of 1
      SELECT 1 FROM jobs r
      WHERE r.session_id = j.session_id AND r.status = 'RUNNING'
    )
  ORDER BY j.run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Plus: visibility timeout reaper for crashed workers, exponential backoff with jitter, a dead-letter table, and Prometheus metrics on depth/latency/failure rate.

| Job | Schedule | Notes |
|---|---|---|
| `strategy.tick` | every minute | Finds due strategies, enqueues executions |
| `execution.run` | event | The pipeline in §7 |
| `budget.reconcile` | every 15 min | Drift ⇒ pause + alert |
| `session.expiry_watch` | hourly | 72h warning, expiry notice |
| `module.monitor` | per indexed block | Module-set change ⇒ pause + page |
| `execution.recover` | every 5 min | Resolves rows stuck in SUBMITTED |
| `anomaly.scan` | every 10 min | Frequency/size heuristics |
| `notify.dispatch` | event | Best-effort, never blocking |

Every job must be safe to run twice. State it in the doc comment and test it.

### 6.4 Indexer (`corral-indexer`)

Log poller against our node (or the failover RPC): follow head with a confirmation depth, decode `Logged` and module-management events, write to Postgres, handle reorgs by re-scanning from the last finalised block. Health metric: blocks behind head.

At this event volume a poller beats a framework. Reorg handling on Base is shallow, but implement it properly anyway.

### 6.5 API (`corral-api`)

axum, SIWE auth (the `siwe` crate) with cookie sessions.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/accounts/predict` | Counterfactual address |
| `POST` | `/sessions/prepare` | Returns encoded config + the exact tx for the **owner** to sign. Server never signs. |
| `POST` | `/sessions/confirm` | Verifies on-chain state, runs §5.3 post-install verification, then marks ACTIVE |
| `GET` | `/sessions/:id` | Policy + budgets + freshness |
| `POST` | `/sessions/:id/revoke/prepare` | Returns revoke calldata and **immediately disables the signer**, not conditional on the tx landing |
| `POST` | `/strategies` | Validates executability under the session policy |
| `PATCH` | `/strategies/:id` | Pause / resume / cancel |
| `POST` | `/plans/preview` | Dry-run next N executions |
| `GET` | `/executions` | Paginated `CorralEvent` feed |
| `GET` | `/verify/:address` | Public, unauthenticated, rate-limited |

**Rule:** no endpoint accepts calldata, an arbitrary address, or an amount and passes it toward the signer. The signer is reachable only from job code, only with a Plan that came from the planner and passed preflight.

---

## 7. Execution pipeline

```
strategy.tick
  │
  ▼
[1] Load due strategies
[2] Refresh on-chain policy state (remaining budget, usage, validity)
[3] DeterministicPlanner → Plan
[4] Validate Plan (serde + ValidatedPolicy checks)
[5] Local policy check against the mirror        ← fail fast, cheap
      │
      ▼
[6] Compile Plan → calldata (corral-chain)
[7] Preflight: on-chain policy read + eth_call simulation
[8] Persist execution row (status = SIMULATED) with idempotency key   ← COMMIT POINT
      │
      ▼
[9] corral-signer signs the userOp hash
[10] corral-relayer submits handleOps; persist tx hash (SUBMITTED)
[11] Await inclusion (bounded); persist receipt (SUCCEEDED | FAILED)
[12] Refresh budget mirror; reconcile
[13] Notify (best-effort, never blocking)
```

**Step 8 is the commit point.** The idempotency key is written before any signing. Death at any later step means recovery reads that row and resumes or reconciles — it never re-plans from scratch.

```rust
let idempotency_key = format!("{session_id}:{strategy_id}:{scheduled_for}:{seq}");
// UNIQUE constraint in Postgres. Insert-or-fail IS the concurrency control.
```

### 7.1 Retry classes

```rust
pub enum RetryClass { Never, Immediate, Backoff, NextWindow, Requote }

pub const fn retry_class(e: ErrorCode) -> (RetryClass, u8) {
    use ErrorCode::*;
    match e {
        PolicyBudgetExceeded | PolicyTargetNotAllowed | PolicyExpired
        | SessionRevoked | PlanUnsafeBounds                => (RetryClass::Never, 0),
        MirrorDrift | ModuleSetChanged                     => (RetryClass::Never, 0), // pause + page
        PolicyUsageLimit                                   => (RetryClass::NextWindow, 1),
        SlippageExceeded | SimulationRevert                => (RetryClass::Requote, 3),
        InsufficientBalance                                => (RetryClass::NextWindow, 1),
        RelayerTimeout | SignerUnavailable | NodeUnavailable
        | GasSponsorUnavailable                            => (RetryClass::Backoff, 5),
        NonceConflict                                      => (RetryClass::Immediate, 3),
        PlanInvalidSchema                                  => (RetryClass::Never, 0),
    }
}
```

`Never` on every policy rejection is a security property, not a UX choice. **Reject any PR that adds a retry around a policy error.** In v1 this was a convention; here the exhaustive `match` means adding an error code without classifying it fails to compile — use that.

---

## 8. Planner

Two implementations, one trait. The most important off-chain design decision, unchanged from v1.

```rust
#[async_trait]
pub trait Planner {
    async fn plan(&self, input: PlanInput) -> Result<Plan, ErrorCode>;
}
```

| Implementation | Used | Trust |
|---|---|---|
| `DeterministicPlanner` | **All autonomous execution.** Pure function of (strategy config, chain state, quote). | In the execution path, fully testable |
| `LlmAuthoringPlanner` | **Authoring only, human-in-the-loop.** Turns a sentence into a proposed policy + strategy the user reviews and signs. | Never in the execution path |

Consequence: prompt injection cannot cause an unattended execution, because nothing unattended consults a model. All v1 strategies are expressible deterministically, so this costs no capability.

LLM output handling, when used: deserialise into a `#[serde(deny_unknown_fields)]` struct, reject on any failure (never repair), and require every address to resolve against a curated token/venue registry. Unknown address = hard reject.

---

## 9. Data model

Unchanged in shape from v1; Postgres is self-hosted with a streaming replica and WAL archiving. Still a **mirror** — chain state is authoritative for anything about money, which is what caps the blast radius of R18.

Tables: `accounts`, `sessions`, `budget_mirror`, `strategies`, `executions`, `planner_traces` (90-day retention), `anomalies`, plus v2 additions:

```sql
CREATE TABLE jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  session_id    uuid REFERENCES sessions(id),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING',   -- PENDING|RUNNING|DONE|DEAD
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempt       integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON jobs (status, run_at) WHERE status = 'PENDING';
CREATE INDEX ON jobs (session_id) WHERE status = 'RUNNING';

CREATE TABLE relayer_nonces (
  relayer_address text PRIMARY KEY,
  next_nonce      bigint NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE signer_audit (
  id            bigserial PRIMARY KEY,
  session_id    uuid NOT NULL,
  op_hash       text NOT NULL,
  requester     text NOT NULL,
  outcome       text NOT NULL,          -- SIGNED|REFUSED_REVOKED|REFUSED_EXPIRED|KMS_ERROR
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

All token amounts are `numeric(78,0)`. Never `bigint`, never a scaled numeric, never a float.

---

## 10. Testing

### 10.1 Violation matrix (write before the code)

One test per bypass attempt, each asserting an on-chain revert. This file is the auditor's first read.

| # | Attempt | Expected |
|---|---|---|
| V1 | Spend an asset outside `asset_scope` | revert |
| V2 | Exceed cumulative per-asset budget by 1 wei | revert |
| V3 | Exceed per-execution ceiling | revert |
| V4 | Call a non-whitelisted contract | revert |
| V5 | Whitelisted contract, non-whitelisted selector | revert |
| V6 | Swap with `recipient` ≠ account | revert |
| V7 | `amountOutMinimum` below policy floor | revert |
| V8 | Execute at `validUntil + 1` | revert |
| V9 | Execute at `validAfter − 1` | revert |
| V10 | Exceed `maxExecutions` | revert |
| V11 | Exceed `maxExecutionsPer24h` | revert |
| V12 | Send native value when cap is 0 | revert |
| V13 | `approve(spender, type(uint256).max)` | revert |
| V14 | `approve` to a non-allowlisted spender | revert |
| V15 | Execute after `removeSession` | revert |
| V16 | Replay a used userOp | revert |
| V17 | Replay a userOp signed for another chain | revert |
| V18 | Replay a userOp signed for another account | revert |
| V19 | Execute via a directly-called executor module | revert |
| V20 | Execute via the fallback handler | revert |
| V21 | Batch a permitted action with a forbidden one | whole batch reverts |
| V22 | Omit the journal call | revert or preflight reject |
| V23 | Sponsored op that violates policy | revert |
| V24 | Install an extra validator, execute through it | detected + alert; original session policy still holds |
| V25 | Reduce `amountIn` but redirect output via a nested call | revert |

### 10.2 Layers

| Layer | Tool | Target |
|---|---|---|
| Solidity unit | Foundry | 100% lines/branches on `CorralJournal` |
| Violation matrix | Foundry, forked Base | All 25 passing |
| Invariant fuzz | Foundry `invariant_` | `sum(spent) ≤ maxTotalSpend`; revoked ⇒ no success; expired ⇒ no success |
| **Encoder differential** | **`proptest` + Node harness** | **10k policies byte-equal to reference SDK — release-blocking** |
| Encoder round-trip | `proptest` | `decode(encode(p)) == p` |
| Compiler property | `proptest` | 10k valid plans pass preflight; 10k invalid rejected pre-compile |
| Signer | unit + KMS test key | Low-s normalisation, recovery id, refusal on revoked session |
| Relayer | integration on Sepolia | Nonce conflicts, stuck-tx replacement, standby promotion |
| Job runner | integration | Concurrency 1 per session under 100 racing workers; visibility timeout recovery |
| Chaos | harness | Kill at 10 lifecycle points × 5 ⇒ zero double-executions, zero stuck jobs |
| Prompt injection | corpus in CI | 100+ adversarial intents ⇒ zero policy-violating proposals accepted |
| E2E | Playwright, Base Sepolia | Journeys J1–J5 |
| Degradation | scripted | API down ⇒ revoke works; nodes down ⇒ failover RPC; KMS down ⇒ queue and retry, never bypass |
| **Restore** | quarterly drill | Postgres PITR restore verified end-to-end |
| Load | k6 / `oha` | 1,000 sessions, 1 execution/min sustained |

### 10.3 Pre-audit checklist

- [ ] Violation matrix green on a mainnet fork
- [ ] Encoder differential green over 10k policies
- [ ] Invariant fuzz ≥50M runs, no counterexamples
- [ ] Slither + Aderyn clean or every finding triaged in writing
- [ ] Module addresses pinned with codehash assertions
- [ ] Audit brief: threat model, trust boundaries, invariants, the "entire runtime compromised" analysis, residual risks
- [ ] Deployment script deterministic; deployer key on hardware wallet or multisig
- [ ] No TODOs or dead code in `contracts/`

---

## 11. Infrastructure

### 11.1 Topology

```
                    ┌──────────── break-glass commercial RPC ──────────┐
                    │                                                  ▼
[op-reth + op-node] ×2  ──▶  corral-indexer ──▶ ┌──────────────┐   corral-chain
        │                                        │  PostgreSQL  │        ▲
        │                                        │ primary +    │        │
        ▼                                        │ replica      │        │
   corral-relayer ◀── corral-jobs ──────────────▶└──────────────┘        │
        │                    │                          ▲                │
        ▼                    ▼                          │                │
   Base sequencer      corral-signer ──▶ KMS       corral-api ◀──── apps/web
```

### 11.2 Base nodes (sequenced last — feasibility §1.2, D16)

- **`op-reth` + `op-node`**, 2 instances in separate failure domains. <cite index="43-1">Base documents Reth as the most performant client for Base nodes, with future optimisation focused on it.</cite>
- **Full nodes, not archive.** Reth's Base profile is roughly 2 TB full vs ~4.1 TB archive. Our indexer starts at our own deployment block and preflight reads happen at head, so archive buys nothing. Verify current snapshot sizes at procurement — they grow.
- Per node: 8+ cores at high clock (Reth's Base state-root task parallelises across threads and wants 5+), 64 GB RAM, 4 TB NVMe with growth headroom, 1 Gbps.
- <cite index="43-1">Sync from Base's published snapshots rather than from genesis.</cite>
- **`op-node` requires an Ethereum L1 endpoint** (execution + consensus) for derivation. v1 uses a commercial L1 provider; an own L1 node is a separate, larger project.
- **Retain a commercial RPC as permanent break-glass**, wired behind the same `ChainClient` trait with automatic failover. Never remove it.

### 11.3 Operations

- **IaC:** Terraform for provisioning, Ansible (or Nix) for configuration. No manual server changes, ever.
- **Secrets:** Vault or SOPS+age. No secret in CI logs, environment dumps, or the database.
- **Backups:** streaming replica + WAL archiving to object storage; PITR; **restore drilled quarterly** — an untested backup is not a backup.
- **Deploys:** blue/green for stateless services; migrations forward-compatible so a rollback never strands the schema.
- **Observability:** Prometheus + Grafana + Loki + Alertmanager, self-hosted.

### 11.4 Alerts

| Signal | Threshold | Action |
|---|---|---|
| `MODULE_SET_CHANGED` | any | Page, auto-pause session |
| `ENCODER_DIVERGENCE` (§5.3) | any | Page, block all installs |
| `MIRROR_DRIFT` | any | Page, auto-pause session |
| Relayer balance | <3 days of gas | Alert |
| Relayer stuck tx | >3 min | Alert, replace-by-fee |
| Nonce gap detected | any | Page |
| KMS error rate | >1% over 5 min | Page |
| Signer refusals for active sessions | any | Page — indicates state disagreement |
| Node blocks behind head | >20 | Alert, fail over to break-glass RPC |
| Node disk | >80% | Alert |
| Postgres replication lag | >30s | Alert |
| Job queue depth | >500 | Alert |
| Policy rejections per session | >3/hour | Alert — likely a planner bug |

**Runbooks required before launch:** global pause, single-session pause, stuck execution recovery, relayer failover, signer/KMS failure, suspected key compromise, node failover, database restore, bad quote source, module-change response. One page each, each rehearsed once, owned by the on-call rota.

---

## 12. Chain-agnosticism in this codebase

| Layer | Portable | Location |
|---|---|---|
| Policy, Action DSL, events, errors, strategies, state machines | **Fully** | `corral-core` — no I/O, no chain client, compiles to WASM |
| Adapter trait | Yes | `corral-adapters` |
| Jobs, DB, API, planner, notifications | Yes, behind `ChainClient` / `Signer` traits | |
| Policy encoding, account model, enforcement | **No** | `corral-chain` — an SVM sibling is a from-scratch implementation |

Testable success criterion for the source document's "chain-agnostic" goal: **adding a second EVM chain touches only `addresses.rs` and config.** Adding a non-EVM chain is a project, not a config change.

A v2 bonus from the Rust choice: if Solana ever happens, the Anchor program and `corral-core` can share the policy types directly, which is the mirror image of the WASM argument and a genuine reason the language choice pays off later.
