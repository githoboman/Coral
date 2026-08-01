# Corral — Progress Log

**Purpose:** the single running record of what has been done, what is in flight, and what is next — kept in tandem with `03_BACKLOG.md` (tickets), `CLAUDE.md` §5 (bootstrap order) and §12 (epic status).

**The rule:** every commit that changes code or docs also updates this file, in the same commit. A commit that doesn't update this file is incomplete. Newest session entries go on top of §4.

---

## 1. Where we are

| | |
|---|---|
| **Current phase** | Bootstrap (CLAUDE.md §5) — task 3 of 8 |
| **Active ticket** | C-101 — `TokenAmount` newtype |
| **Next up** | C-102 — `RawPolicy` → `ValidatedPolicy` |
| **Blocked / waiting** | `apps/web` frontend import (stakeholder says FE is ready; not yet in repo — needed by C-108/C-801, not before). Local `cargo test` link step waits on VS Build Tools install (in progress); check/clippy/wasm unaffected |

## 2. Ticket board

Status: `☐` not started · `◐` in progress · `☑` done · `✖` blocked. Only tickets touched or imminent are listed; the full backlog stays in `03_BACKLOG.md`.

### Bootstrap (CLAUDE.md §5 — strict order)

| # | Ticket | Status | Evidence when done |
|---|---|---|---|
| 1 | C-003 workspace + Foundry + pnpm + just | ☑ | `cargo check --workspace` ✓, clippy `-D warnings` ✓, `forge build` ✓, wasm32 build ✓, `cargo deny check` ✓ (2026-08-01) |
| 2 | C-004 + C-007 CI guardrails + wasm32 | ☑ | Workflow: clippy `-D warnings`, tests, cargo-deny, wasm32 build, core-isolation dep-tree check, `enableSessions`/`U256::MAX` boundary greps, Foundry, gitleaks. All constituent checks proven locally 2026-08-01. **Caveat:** enforcement on PRs starts when a GitHub remote exists — the "reqwest fails CI" acceptance test runs then |
| 3 | C-101 `TokenAmount` | ☐ | proptest: no silent-overflow path |
| 4 | C-102 `RawPolicy` → `ValidatedPolicy` | ☐ | failing-case test per invariant (PRD §8) |
| 5 | C-103 Action DSL + `Plan` | ☐ | extra JSON field fails deserialisation |
| 6 | C-105 error taxonomy + `retry_class` | ☐ | unclassified variant fails to compile |
| 7 | C-107 + C-108 WASM bindings + FE wiring | ☐ | FE renders summary from crate; CI stale-check |
| 8 | C-201 + C-202 `CorralJournal` + deploy | ☐ | verified on Base Sepolia, address committed |

### Pre-bootstrap housekeeping (not in backlog)

| Item | Status |
|---|---|
| Reconcile docs (see §5, entry 2026-07-31) | ☑ |
| `git init` + docs baseline commit | ☑ `98f1d05` |
| Toolchain install (Rust 1.97.1, Foundry 1.5.1, pnpm 11.18, just 1.57, cargo-deny 0.20.2) | ☑ |
| VS Build Tools (MSVC linker, for local `cargo test` + native deps) | ◐ installing |

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

**2026-07-31 — Process:** solo/agent execution means the two-track (product ∥ infra) plan collapses to one track; infra tickets (I-xxx) will be pulled in at the point the product track needs them (first: I-201 Postgres before C-502). Calendar-week targets in the docs describe the 3.6-FTE plan and are kept as reference, not as this track's schedule.
