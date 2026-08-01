# Corral — Progress Log

**Purpose:** the single running record of what has been done, what is in flight, and what is next — kept in tandem with `03_BACKLOG.md` (tickets), `CLAUDE.md` §5 (bootstrap order) and §12 (epic status).

**The rule:** every commit that changes code or docs also updates this file, in the same commit. A commit that doesn't update this file is incomplete. Newest session entries go on top of §4.

---

## 1. Where we are

| | |
|---|---|
| **Current phase** | Bootstrap (CLAUDE.md §5) — task 7 of 8 |
| **Active ticket** | C-107/C-108 — WASM bindings + FE wiring |
| **Next up** | C-201/C-202 — `CorralJournal.sol` + Sepolia deploy |
| **Blocked / waiting** | `apps/web` frontend import (stakeholder says FE is ready; not yet in repo — needed by C-108/C-801, not before). Local `cargo test` link step waits on VS Build Tools install (in progress); check/clippy/wasm unaffected |

## 2. Ticket board

Status: `☐` not started · `◐` in progress · `☑` done · `✖` blocked. Only tickets touched or imminent are listed; the full backlog stays in `03_BACKLOG.md`.

### Bootstrap (CLAUDE.md §5 — strict order)

| # | Ticket | Status | Evidence when done |
|---|---|---|---|
| 1 | C-003 workspace + Foundry + pnpm + just | ☑ | `cargo check --workspace` ✓, clippy `-D warnings` ✓, `forge build` ✓, wasm32 build ✓, `cargo deny check` ✓ (2026-08-01) |
| 2 | C-004 + C-007 CI guardrails + wasm32 | ☑ | Workflow: clippy `-D warnings`, tests, cargo-deny, wasm32 build, core-isolation dep-tree check, `enableSessions`/`U256::MAX` boundary greps, Foundry, gitleaks. All constituent checks proven locally 2026-08-01. **Caveat:** enforcement on PRs starts when a GitHub remote exists — the "reqwest fails CI" acceptance test runs then |
| 3 | C-101 `TokenAmount` | ☑ | proptest: checked add/sub can't silently wrap; strict decimal-string serde (hex/negative/float/number rejected); no `Add` impl. 7/7 tests green (2026-08-01) |
| 4 | C-102 `RawPolicy` → `ValidatedPolicy` | ☑ | All six invariants have failing-case tests (+ U256::MAX-cap and symbol-spoof edge cases); `ValidatedPolicy` has no `Deserialize`; `deny_unknown_fields` on every policy type. 11/11 tests green (2026-08-01) |
| 5 | C-103 Action DSL + `Plan` | ☑ | Closed DSL (no raw-calldata/delegatecall variant possible); extra field on `Plan` or any `Action` fails deserialisation; unknown action tags rejected. 6/6 tests green (2026-08-01) |
| 6 | C-105 error taxonomy + `retry_class` | ☑ | 19 codes; `retry_class` + `user_message` exhaustive with no wildcard arm (unclassified variant = compile error); policy rejections all `(Never, 0)`. 7/7 tests green (2026-08-01) |
| 7 | C-107 + C-108 WASM bindings + FE wiring | ☐ | FE renders summary from crate; CI stale-check |
| 8 | C-201 + C-202 `CorralJournal` + deploy | ☐ | verified on Base Sepolia, address committed |

### Pre-bootstrap housekeeping (not in backlog)

| Item | Status |
|---|---|
| Reconcile docs (see §5, entry 2026-07-31) | ☑ |
| `git init` + docs baseline commit | ☑ `98f1d05` |
| Toolchain install (Rust 1.97.1, Foundry 1.5.1, pnpm 11.18, just 1.57, cargo-deny 0.20.2) | ☑ |
| VS Build Tools (MSVC linker, for local `cargo test` + native deps) | ☑ |

## 3. Gates

| Gate | Criteria (short) | Status |
|---|---|---|
| G0 | ADRs signed, threat model, audit slot, infra owner | ☐ — needs stakeholder (C-001/C-002/C-005/C-006) |
| G1′ | 10k-policy differential harness green; V1–V25 revert | ☐ |
| G2 | Zero double-executions across 50 induced failures | ☐ |
| G3 | Zero known highs; runbooks; restore tested | ☐ |
| G4 | Audit criticals/highs closed | ☐ |
| G5 | Launch checklist green | ☐ |

## 4. Session log (newest first)

### 2026-08-01 — Session 2 (cont.): C-105 error taxonomy

- **C-105 done, test-first:** `ErrorCode` (19 codes from reconciled PRD §9), `RetryClass`, `const fn retry_class` and `const fn user_message` — both exhaustive matches with **no wildcard arm**, so adding a code without classifying it fails to compile (the ticket's done-criterion, enforced by the compiler).
- Tests: every policy rejection and safety pause is `(Never, 0)`; infra errors backoff ×5; requote ×3 for slippage/simulation; wire names match PRD §9 exactly; every code has a user message except deliberately-silent `NONCE_CONFLICT`; no hex in any message (FR-11.8).
- PRD §9 `PLAN_INVALID_SCHEMA` aligned to spec `Never` (see §5 reconciliation entry).

### 2026-08-01 — Session 2 (cont.): C-103 Action DSL + Plan

- **C-103 done, test-first:** `Action` (SWAP/TRANSFER/APPROVE/WRAP/UNWRAP, internally-tagged serde with `deny_unknown_fields`, no variant can carry raw calldata or an arbitrary target) and `Plan { chain_id, session_id, strategy_id, seq, actions }`. `Action::kind()` maps totally onto `ActionKind`.
- Tests: round-trip; extra field on Plan rejected; extra field inside an Action rejected; unknown tag (`DELEGATECALL`) rejected; wire tags match `ActionKind` names.

### 2026-08-01 — Session 2 (cont.): C-102 policy validation

- **C-102 done, test-first:** `RawPolicy`, `ValidatedPolicy` (constructible only via `TryFrom`, `Serialize` but deliberately no `Deserialize`), `PolicyError`, and the supporting types `AssetRef`, `BudgetConstraint`, `ActionKind`, `TargetConstraint`, `ParamRule` (EQ_ACCOUNT / IN_SET / LTE / GTE, mirroring the on-chain comparator names for C-304), `RuleValue`.
- All six PRD §8 invariants tested with failing cases, plus hardening beyond the table: an approval "capped" at `U256::MAX` counts as unbounded, and asset identity is by address never symbol (symbol-spoof test).
- Design decisions for the encoder's benefit: `TargetConstraint.action: ActionKind` is how `is_swap_target()` is derived; per-execution ceilings live as LTE param rules on targets (per spec §4.3 worked example), while `BudgetConstraint` carries only the cumulative cap.
- Test fixture is the spec §4.3 worked session config (Base Sepolia USDC→WETH DCA), so the types are proven against the exact shape the encoder must produce.
- Verified: clippy `-D warnings`, 18/18 corral-core tests, wasm32 build, fmt, deny — all green.

### 2026-08-01 — Session 2 (cont.): C-101 `TokenAmount`

- **C-101 done, test-first:** property tests (add/sub either exact or `None` — no third outcome), strict wire-format tests, boundary cases; then the implementation: `TokenAmount(U256)`, `checked_add`/`checked_sub` with `#[must_use]`, no `Add`/`Sub`/`Mul` impls, `Display` + serde as decimal string.
- **Spec divergence resolved in CLAUDE.md's favour:** spec §3.1's sketch shows `#[serde(transparent)]` (would inherit U256's hex serde); CLAUDE.md §5 task 3 requires decimal-string serde. Implemented decimal-string with strict digit-only parsing (rejects `0x…`, sign, exponent, separators, bare JSON numbers — U256's own `FromStr` would accept hex, too permissive for money).
- Dependencies added: `alloy-primitives` + `serde` (corral-core), `proptest` + `serde_json` (dev). RUSTSEC-2024-0436 (`paste` unmaintained, transitive via ruint, compile-time only) triaged with documented ignore in `deny.toml`.
- Verified: clippy `-D warnings`, 7/7 tests, wasm32 build, `cargo fmt --check`, `cargo deny check` — all green. VS Build Tools completed; local linking now works.

### 2026-08-01 — Session 2: toolchain + C-003 scaffold

- Toolchain installed from scratch (machine had only git + Node): Rust 1.97.1 stable + wasm32 target, Foundry 1.5.1 (Windows binaries), pnpm 11.18, just 1.57 (winget), cargo-deny 0.20.2. VS Build Tools (MSVC linker) still installing — local `cargo test` can't link until it lands; CI runs on Linux and is unaffected.
- **C-003 done:** 9-crate Cargo workspace (`forbid(unsafe_code)` + clippy cast bans as workspace lints), Foundry config (`solc 0.8.28`), pnpm workspace wiring (`apps/web` + `harness/encoder-diff` slots), `justfile` mirroring CLAUDE.md §6, `rust-toolchain.toml` pinning stable + wasm32.
- Verified: `cargo check --workspace`, `cargo clippy -D warnings`, `cargo build --target wasm32-unknown-unknown -p corral-core --features wasm`, `forge build`, `cargo deny check`, `cargo fmt --check` — all green.
- C-004/C-007 CI workflow + `deny.toml` authored (committed next; needs a GitHub remote before it can actually run).

### 2026-07-31 — Session 1: reconciliation, tracking, bootstrap start

- **Docs reconciled** (details in §5).
- **PRD Q2 resolved by stakeholder:** the frontend is ready and is expected to drop into `apps/web` without issues. FR-11.9 verification (no hand-written shared types) deferred to import time.
- Created this progress log; added it to the CLAUDE.md doc table.
- `git init`, docs baseline committed.
- Toolchain installed from scratch (machine had only git + Node): Rust stable + wasm32 target, Foundry, pnpm, just.
- Started C-003.

## 5. Decisions & deviations record

Architecture decisions still go to `00_FEASIBILITY_AND_TIMELINE.md` §6 (ADR log). This section records smaller reconciliations and process decisions.

**2026-07-31 — Doc reconciliation** (backlog authoritative for ticket IDs, feasibility §8.2 for schedule):

| Doc | Fix |
|---|---|
| `00` §4 | Differential-harness ticket ref `C-205` → `C-306/C-307` (C-205 is pinned module addresses) |
| `01` FR-1.2 | v1 leftover `packages/chain-evm` → `corral-chain`; `IAccountAdapter` → `AccountAdapter` |
| `01` FR-2.10 | v1 leftover "TypeScript policy object" → `corral-core` policy object |
| `01` SEC-1 | v1 leftover "delegated custody provider" → KMS-backed `corral-signer` (SEC-13) |
| `01` §9 | `BUNDLER_TIMEOUT` → `RELAYER_TIMEOUT` (no bundler in v2); added `NODE_UNAVAILABLE` to match spec §7.1 |
| `02` §7.1 | Added `GasSponsorUnavailable` to the backoff arm (was in PRD §9 but missing from the match) |
| `01` §14 | Release-plan weeks aligned to feasibility §8.2: alpha wk 8/G1′, beta wk 17–18, guarded mainnet wk 20 |
| `01` §15 Q2 | Marked resolved (FE ready per stakeholder) |

**2026-08-01 — Doc reconciliation (found during C-105):**

| Doc | Fix |
|---|---|
| `01` §9 | `PLAN_INVALID_SCHEMA` retry "Once, then abort" → "Never", matching spec §7.1. Rationale: v2 autonomous execution uses only the `DeterministicPlanner` — identical input reproduces identical output, so a schema-failure retry can never succeed. The "Once" rule was a v1 leftover from when an LLM planner could be in the loop. |

**2026-07-31 — Process:** solo/agent execution means the two-track (product ∥ infra) plan collapses to one track; infra tickets (I-xxx) will be pulled in at the point the product track needs them (first: I-201 Postgres before C-502). Calendar-week targets in the docs describe the 3.6-FTE plan and are kept as reference, not as this track's schedule.
