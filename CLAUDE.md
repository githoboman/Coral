# CLAUDE.md

Corral Protocol. This file is the entry point for Claude Code and the authority on how work happens in this repo. Read it fully at the start of every session.

**There is one plan, not several.** The four documents in `docs/` are one bundle describing one stack. They do not compete. If anything anywhere contradicts this file, this file wins; report the contradiction rather than resolving it silently.

| File | Read it when |
|---|---|
| `CLAUDE.md` (this file) | Every session. Rules, stack, bootstrap, working agreement |
| `docs/03_BACKLOG.md` | Choosing what to work on. ~90 tickets, two tracks, dependencies |
| `docs/01_PRD.md` | Before implementing any ticket — it holds the `FR-`/`SEC-` requirements and acceptance criteria |
| `docs/02_TECHNICAL_SPEC.md` | Contracts, crate layout, encoder, services, data model, tests, infra |
| `docs/00_FEASIBILITY_AND_TIMELINE.md` | Why a decision was made (ADRs D1–D18), risks, schedule |
| `docs/04_PROGRESS.md` | Every session. The running progress log — updated in the same commit as the work it records |

---

## 1. What we are building

Corral is a **policy-bound execution account**. A user delegates a narrow capability to an automated agent — "swap up to 500 USDC into WETH on Uniswap, weekly, for 30 days" — and the limits are enforced on-chain by the account's own validation logic, not by the agent's code being well-behaved.

The entire product is one security property:

> If every off-chain component — API, job runner, planner, signer service, relayer, indexer, database, frontend, and every server we own — is fully controlled by an attacker, the maximum loss is the active session's remaining per-asset budget, and funds can only move to policy-permitted destinations.

**Apply that test to every change.** If a change weakens it, do not make it — raise it instead.

We host our own infrastructure. That does **not** make it trusted. Our servers sit in the untrusted zone alongside any vendor's. Only the owner's key, Base consensus, the audited modules, our audited journal contract, and the KMS boundary are trusted.

---

## 2. Non-negotiables

Do not violate these. Do not ask for permission to violate them. If a ticket appears to require it, the ticket is wrong — stop and report it.

1. **No raw private keys, anywhere.** No key generation, no mnemonics, no in-process signing keys, no keys in env vars, logs or the database. `corral-signer` is the only crate permitted to depend on the KMS SDK, and keys never leave the KMS.
2. **Never weaken or disable the encoder differential test.** If `harness/encoder-diff` fails, the Rust encoder is wrong — not the harness, not the reference SDK. Disabling it to unblock a build is an incident, not a workaround.
3. **No code path may widen a policy.** Session installation is owner-initiated only. Nothing in the planner, adapters, jobs, relayer or API may install, modify or enable a session or module.
4. **Never retry a policy rejection.** `PolicyBudgetExceeded`, `PolicyTargetNotAllowed`, `PolicyExpired`, `SessionRevoked` and `PlanUnsafeBounds` are terminal. A retry around a policy error converts a safe system into an unsafe one.
5. **Never emit an unbounded ERC-20 approval.** Exact amounts capped at the per-execution ceiling, or Permit2 with ≤10 minute expiry.
6. **Never remove or weaken a `recipient == account` rule** on a swap action. Budget caps bound theft; the recipient pin is what prevents it.
7. **No LLM produces calldata, addresses, or execution decisions.** Models propose configuration at authoring time for human review. Autonomous execution uses `DeterministicPlanner` only.
8. **`corral-core` never acquires I/O.** No `tokio`, no `sqlx`, no `reqwest`, no chain client. It must keep compiling to `wasm32-unknown-unknown`.
9. **The frontend never hand-writes a shared type.** TypeScript definitions are generated from `corral-core` via `tsify`. If the frontend needs a type, add it to the crate.
10. **Token amounts are `TokenAmount` and nothing else.** No `u64`, no `f64`, no `as` casts, no unchecked arithmetic.
11. **Never skip the preflight/simulation gate** before signing.
12. **Never surface a raw revert string or hex selector to a user.** Map through `corral_core::errors`.
13. **Never edit the violation matrix to make a test pass.** A failing case in `contracts/test/Violations.t.sol` means the policy encoding is wrong. Fix the encoding or escalate.
14. **`#![forbid(unsafe_code)]` stays in every crate.**

---

## 3. Stack

| Layer | Choice |
|---|---|
| Chain | Base — Sepolia for dev, mainnet at launch |
| Account | ERC-7579 modular smart account behind `AccountAdapter` |
| Enforcement | SmartSessions + UniversalAction / SpendingLimits / TimeFrame / ValueLimit / UsageLimit modules |
| Custom Solidity | `CorralJournal.sol` only, ~40 LOC. **A second contract is an architecture decision — raise it, don't write it.** |
| Contracts | Foundry, Solidity 0.8.28 |
| Shared core | `corral-core` Rust crate → native for services, WASM for the frontend |
| Services | Rust: axum, tokio, sqlx, alloy |
| Jobs | Own Postgres queue (`FOR UPDATE SKIP LOCKED`). Not Temporal — see `docs/00` §3 |
| Database | Self-hosted PostgreSQL + replica + PITR. **Mirror only; never authoritative about money** |
| Signing | `corral-signer`, KMS/HSM-backed |
| Submission | `corral-relayer` calling `EntryPoint.handleOps`. **No third-party bundler** |
| Chain access | Commercial RPC with failover now; own `op-reth` + `op-node` in weeks 18–20 (D16) |
| Frontend | Existing Next.js + TypeScript app, consuming `@corral/core` (WASM) |
| Tests | Foundry, `proptest`, Playwright, Node differential harness |

---

## 4. Repository layout

Create this shape. Do not reorganise it without raising it first.

```
corral/
├─ CLAUDE.md
├─ docs/                           # the four reference documents
├─ Cargo.toml                      # workspace
├─ crates/
│  ├─ corral-core/                 # ⚠️ pure logic. No I/O. Compiles to WASM.
│  │  └─ src/{policy,action,amount,events,errors,strategy,wasm}.rs
│  │     └─ encode/                # ⚠️ security-critical: Policy → SmartSessions config
│  ├─ corral-chain/                # alloy: reads, preflight, calldata compilation
│  ├─ corral-adapters/             # ProtocolAdapter trait + uniswap_v3
│  ├─ corral-signer/               # KMS-backed signing (only crate with KMS creds)
│  ├─ corral-relayer/              # handleOps submission + nonce allocator
│  ├─ corral-jobs/                 # Postgres queue + workers
│  ├─ corral-indexer/              # log poller → Postgres
│  ├─ corral-api/                  # axum HTTP API
│  └─ corral-db/                   # sqlx queries + migrations
├─ apps/web/                       # EXISTING frontend
│  └─ packages/core-wasm/          # generated — never edited by hand
├─ contracts/
│  ├─ src/CorralJournal.sol
│  └─ test/Violations.t.sol        # the 25-case matrix
├─ harness/encoder-diff/           # Node: reference TS SDK vs Rust encoder (CI + local only)
└─ infra/                          # Terraform + Ansible + runbooks
```

### CI must enforce, from day one

| Rule | Mechanism |
|---|---|
| `corral-core` has no I/O | `cargo-deny` per-crate dependency allowlist |
| `corral-core` compiles to WASM | build target in CI |
| Generated TS types are never stale | regenerate in CI; fail if the checked-in output differs |
| No policy-widening outside session install | grep for `enableSessions` outside `corral-core::encode` and the install handler |
| No unbounded approvals | encoder unit test |
| No key material | `gitleaks` |
| No `unsafe` | `#![forbid(unsafe_code)]` |

---

## 5. Bootstrap — the first eight tasks, in order

Work these before touching anything else. Each maps to a backlog ticket. **Do not skip ahead to feature work**; the guardrails must exist before there is anything to guard.

| # | Task | Ticket | Done when |
|---|---|---|---|
| 1 | Cargo workspace, Foundry, pnpm frontend wiring, `just` runner | C-003 | `cargo check --workspace` and `forge build` both pass |
| 2 | CI: clippy `-D warnings`, `cargo-deny` allowlist, `forbid(unsafe_code)`, gitleaks, Foundry, **wasm32 target** | C-004, C-007 | A PR that adds `reqwest` to `corral-core` fails CI |
| 3 | `TokenAmount` newtype — checked arithmetic only, serde as decimal string, no `Add` impl | C-101 | Property test: no arithmetic path can silently overflow |
| 4 | `RawPolicy` → `ValidatedPolicy` via `TryFrom`, all six parse-time invariants | C-102 | Each invariant has a failing-case unit test; see `docs/01` §8 for the table |
| 5 | Action DSL + `Plan` with `deny_unknown_fields` | C-103 | An extra JSON field fails deserialisation |
| 6 | Error taxonomy + **exhaustive** `retry_class` match | C-105 | Adding an error variant without classifying it fails to compile |
| 7 | WASM bindings (`validate_policy`, `policy_summary`, `policy_hash`) + `wasm-pack` output wired into `apps/web` | C-107, C-108 | Frontend renders a policy summary from the crate; CI fails on stale generated output |
| 8 | `CorralJournal.sol` + 100% branch coverage + CREATE2 deploy to Base Sepolia | C-201, C-202 | Deployed, verified, address committed |

After task 8, move to **EPIC 2** (account and contracts), then **EPIC 3** (the encoder). Infrastructure tickets (`I-xxx`) run on a separate track and are not yours unless assigned.

---

## 6. Commands

```bash
# Rust
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
cargo build --target wasm32-unknown-unknown -p corral-core --features wasm

# WASM → frontend (CI fails if the checked-in output goes stale)
wasm-pack build crates/corral-core --features wasm --target bundler \
  --out-dir ../../apps/web/packages/core-wasm

# Contracts
forge test -vvv
forge test --match-path test/Violations.t.sol            # security-critical
forge test --match-test invariant_ --fuzz-runs 50000

# Encoder differential harness — release-blocking
pnpm --dir harness/encoder-diff test
cargo test -p corral-core --test encoder_diff -- --ignored --nocapture

# Frontend
pnpm --dir apps/web dev
pnpm --dir apps/web test

# Everything CI runs
just check-all
```

---

## 7. Working agreement

**Picking work.** Take the lowest-numbered unblocked ticket in the current epic from `docs/03_BACKLOG.md`. Dependencies listed there are real. `⚠️ BLOCKS` marks a cross-track blocker — if it isn't done, pick something else rather than stubbing it.

**Before writing code.** Read the `FR-`/`SEC-` requirements the ticket references in `docs/01_PRD.md`. The acceptance criteria are written to become tests; use them as the tests.

**Test-first is mandatory** for `corral-core::encode`, the violation matrix, and anything touching budgets, approvals or revocation. In those areas the test *is* the specification. Elsewhere, use judgement.

**Before committing.** `just check-all` and `forge test` green. For encoder changes, the differential harness too. No exceptions, no "I'll fix it in the next commit."

**Commit format.** `feat(encode): action policy param rules (FR-2.5, C-304)`. Requirement and ticket IDs are stable — always include them.

**Scope.** Keep the diff to the ticket. If you find an adjacent problem, note it and raise it; don't fold it in.

### Stop and ask when

- A ticket seems to require violating §2.
- A requirement in the PRD contradicts the spec, or either contradicts this file.
- The encoder differential test fails and the cause isn't obvious.
- A violation-matrix case cannot be made to revert. **This is a design conversation, not a failing test** — it means the policy composition doesn't cover that attack path.
- You'd need to add a second Solidity contract, a new external dependency with meaningful trust, or an oracle.
- A change would make the security property in §1 harder to state or defend.

Raise these with the requirement/ticket IDs and a short description of the conflict. Do not pick a resolution unilaterally.

---

## 8. Where this project will go wrong

Three places. Everything else has float.

**The policy encoder (EPIC 3, weeks 5–8).** No Rust implementation of ERC-7579 SmartSessions encoding exists upstream; we are writing it against the Solidity. An encoding bug does not crash — it produces a session that installs cleanly, displays correctly in the UI, and **enforces something other than what the user agreed to.** That is the worst failure this product has.

Two mitigations, both mandatory:
- **C-307 differential test**: 10,000 generated policies, byte-equality against the reference TypeScript SDK, in CI, release-blocking.
- **C-308 post-install verification**: after the owner's install transaction confirms, read the session config back from chain, decode it, compare against the signed policy, and only then mark the session ACTIVE. A mismatch pauses and pages.

Use `alloy::sol!` bindings generated from the actual contract sources. Restrict hand-written logic to composition.

**The violation matrix (C-309).** 25 attack paths, each asserting an on-chain revert. Expect it to grow — every case you cannot make revert is something real. This is the first artifact the auditor reads; write it before the encoder is finished, not after.

**The relayer nonce allocator (I-402, infra track).** A nonce gap stalls every user's executions simultaneously and only surfaces under production concurrency.

---

## 9. Things that look like bugs but are intentional

- Policies are immutable. Editing means revoke + create new (FR-2.9).
- `TokenAmount` has no `Add` impl. Checked arithmetic only — deliberately inconvenient.
- The budget mirror can disagree with the chain. When it does, the session pauses rather than proceeding (FR-6.3).
- The standalone `/revoke` page duplicates logic, hardcodes addresses and does not use the WASM core. It must work when every Corral service, including the build pipeline, is down (FR-8.3). **Do not DRY it up.**
- Journal calls look like wasted gas. They are the traceability guarantee (FR-3.4). Do not optimise them away.
- The deterministic planner is less capable than an LLM planner. Deliberate — it keeps prompt injection out of the unattended execution path.
- A commercial RPC stays configured even after we own nodes. Permanent break-glass (D16).
- Base nodes are scheduled last despite being a headline decision. They carry no security or revocation benefit, so they sit off the critical path (D16).

---

## 10. Two claims we never overstate

1. **Revocation prevents everything after it; it cannot reverse an already-included transaction.** Own-relayer submission means no signed operation sits in a mempool we don't control, so the residual window is our own submission latency — small, measurable, not zero.
2. **Running our own Base nodes is not censorship resistance.** Base uses a centralised sequencer; our node forwards to it like any RPC would.

These go in user-facing copy as written. Overstating either is both a trust problem and a legal one.

---

## 11. Session prompts

Useful openers when starting Claude Code on this repo:

```
Read CLAUDE.md and docs/03_BACKLOG.md. Tell me the next unblocked ticket
and what you plan to do, before writing any code.
```

```
Implement C-102 (RawPolicy → ValidatedPolicy). Read docs/01_PRD.md §8 first.
Write the failing tests for all six parse-time invariants, then the implementation.
```

```
Before this commit: run just check-all and forge test, and confirm the diff
touches only files relevant to the ticket.
```

```
Review this diff against CLAUDE.md §2. Flag anything that weakens the
security property in §1, however small.
```

---

## 12. Status

**Product track**
- [ ] EPIC 0 Foundations
- [ ] EPIC 1 `corral-core` + WASM
- [ ] EPIC 2 Account & contracts
- [ ] EPIC 3 Policy encoder ⚠️ critical path
- [ ] EPIC 4 Adapters & compiler
- [ ] EPIC 5 Execution pipeline
- [ ] EPIC 6 Strategies
- [ ] EPIC 7 Feed & notifications
- [ ] EPIC 8 Frontend
- [ ] EPIC 9 Security & launch

**Infra track**
- [ ] I1 Provisioning · [ ] I2 Database · [ ] I3 Signer · [ ] I4 Relayer · [ ] I5 Jobs & indexer · [ ] I6 Observability · [ ] I7 Base nodes

Tick these as epics complete. Record any decision change in `docs/00_FEASIBILITY_AND_TIMELINE.md` §6 (the ADR log), not only in a commit message.
