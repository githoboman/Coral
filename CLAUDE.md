# CLAUDE.md

Corral Protocol. This file is the entry point for Claude Code and the authority on how work happens in this repo. Read it fully at the start of every session.

**There is one plan, not several.** The documents in `docs/` are one bundle describing one stack — as of the **v3 respec (1 Aug 2026, ADRs D19–D24)**: the Coral-lineage TypeScript backend, a shared TypeScript core, and Base/EVM enforcement. Where an older section of `docs/00`–`03` still describes the v2 Rust/self-hosted stack, the v3 banners in those files and this file win; report any *other* contradiction rather than resolving it silently.

| File | Read it when |
|---|---|
| `CLAUDE.md` (this file) | Every session. Rules, stack, bootstrap, working agreement |
| `docs/03_BACKLOG.md` | Choosing what to work on (see its v3 delta map first) |
| `docs/01_PRD.md` | Before implementing any ticket — `FR-`/`SEC-` requirements and acceptance criteria (stack-independent, all still binding) |
| `docs/02_TECHNICAL_SPEC.md` | Contracts, on-chain design, pipeline, data model, tests (see its v3 addendum for what's superseded) |
| `docs/00_FEASIBILITY_AND_TIMELINE.md` | Why a decision was made (ADRs D1–D24), risks |
| `docs/04_PROGRESS.md` | Every session. The running progress log — updated in the same commit as the work it records |

**Lineage:** `Tovira-xyz/Coral` (git remote `coral`) is the Sui Overflow 2026 predecessor — same thesis, proven on Sui testnet. We keep its Express+TS+Supabase backend and Vite+React frontend as the product base and rebuild the chain layer for Base/EVM. Its Move contract and DeepBook code are demo-only heritage: never ported, never deleted from their repo. Push nothing to the `coral` remote without explicit stakeholder instruction.

---

## 1. What we are building

Corral is a **policy-bound execution account**. A user delegates a narrow capability to an automated agent — "swap up to 500 USDC into WETH on Uniswap, weekly, for 30 days" — and the limits are enforced on-chain by the account's own validation logic, not by the agent's code being well-behaved.

The entire product is one security property:

> If every off-chain component — API, job runner, planner, signer, relayer, indexer, database, frontend, and every server or managed service we use — is fully controlled by an attacker, the maximum loss is the active session's remaining per-asset budget, and funds can only move to policy-permitted destinations.

**Apply that test to every change.** If a change weakens it, do not make it — raise it instead.

Supabase, Render, Vercel and every service we write sit in the **untrusted zone**. Only the owner's key, Base consensus, the audited modules, our audited journal contract, and the KMS boundary are trusted.

---

## 2. Non-negotiables

Do not violate these. Do not ask for permission to violate them. If a ticket appears to require it, the ticket is wrong — stop and report it.

1. **No raw private keys, anywhere.** No key generation outside the signer module, no keys in env vars, logs, or the database beyond the *testnet-only* encrypted-at-rest allowance (D23). The signer module is the only component permitted to hold KMS credentials, and mainnet keys never leave the KMS. The `AGENT_IMPORT_KEY` pattern from the Coral demo does not survive into mainnet code paths.
2. **Never skip or weaken post-install verification.** After a session install confirms, read the config back from chain, decode it, compare against the policy the user signed, and only then mark the session ACTIVE. A mismatch pauses and pages. Disabling this to unblock anything is an incident, not a workaround.
3. **No code path may widen a policy.** Session installation is owner-initiated only. Nothing in the planner, adapters, jobs, relayer or API may install, modify or enable a session or module.
4. **Never retry a policy rejection.** `POLICY_BUDGET_EXCEEDED`, `POLICY_TARGET_NOT_ALLOWED`, `POLICY_EXPIRED`, `SESSION_REVOKED` and `PLAN_UNSAFE_BOUNDS` are terminal. A retry around a policy error converts a safe system into an unsafe one.
5. **Never emit an unbounded ERC-20 approval.** Exact amounts capped at the per-execution ceiling, or Permit2 with ≤10 minute expiry.
6. **Never remove or weaken a `recipient == account` rule** on a swap action. Budget caps bound theft; the recipient pin is what prevents it.
7. **No LLM produces calldata, addresses, or execution decisions.** Models propose configuration at authoring time for human review (the Coral chat UX). Unattended execution uses the deterministic planner only. The mocked `autonomyService` "full control" path is built deterministic or not at all.
8. **`@corral/core` never acquires I/O.** No network, no database, no chain client, no environment reads. Enforced by dependency-cruiser in CI. It must stay portable to any JS runtime.
9. **Neither the frontend nor the backend hand-writes a shared type.** Policy, Action, Plan, ExecutionStatus, error codes: imported from `@corral/core` only. Zod schemas are the single source; TypeScript types derive from them (`z.infer`).
10. **Token amounts are `TokenAmount` (branded `bigint`) and nothing else.** No `number`, no float math, no implicit coercion. An ESLint boundary bans `number` on money paths; serde is decimal strings end-to-end.
11. **Never skip the preflight/simulation gate** before signing.
12. **Never surface a raw revert string or hex selector to a user.** Map through `@corral/core` error codes.
13. **Never edit the violation matrix to make a test pass.** A failing case in `contracts/test/Violations.t.sol` means the session configuration is wrong. Fix the configuration or escalate.
14. **`strict: true` TypeScript everywhere; no `any`, no `@ts-ignore`/`@ts-expect-error`, no non-null assertions on money or policy paths.** CI enforces.

---

## 3. Stack (v3 — D19–D24)

| Layer | Choice |
|---|---|
| Chain | Base — Sepolia for dev, mainnet at launch |
| Account | ERC-7579 modular smart account behind an `AccountAdapter` interface |
| Enforcement | SmartSessions + UniversalAction / SpendingLimits / TimeFrame / ValueLimit / UsageLimit modules |
| Session encoding | **Reference TypeScript SmartSessions SDK, pinned** (D22) — we do not hand-roll encoding |
| Custom Solidity | `CorralJournal.sol` only, ~40 LOC. **A second contract is an architecture decision — raise it, don't write it.** |
| Contracts | Foundry, Solidity 0.8.28 |
| Shared core | `@corral/core` — pure TS: zod `.strict()` schemas, branded `TokenAmount`, error taxonomy, fast-check tests |
| Backend | **Coral-lineage Express + TypeScript** (`server/`), Supabase Postgres |
| Chain access (BE) | viem; commercial RPC with multi-provider failover, permanently (D19) |
| Jobs | Postgres queue on Supabase (`FOR UPDATE SKIP LOCKED`), per-session concurrency 1 |
| Database | Supabase Postgres. **Mirror only; never authoritative about money** |
| Signing | Dedicated signer module; testnet: existing AES-256-GCM at-rest keys; **mainnet: KMS-held secp256k1, keys never exportable** (D23) |
| Submission | Own relayer service calling `EntryPoint.handleOps` via viem. **No third-party bundler** (D13 retained — the revocation guarantee depends on it) |
| Frontend | **Coral-lineage Vite + React** (`app/`), consuming `@corral/core` |
| Tests | Foundry (+ Violations matrix), vitest + fast-check, Playwright |

## 4. Repository layout (v3 target)

Directory names mirror the Coral repo where content is shared, to keep a future upstream push low-friction (D24).

```
corral/
├─ CLAUDE.md
├─ docs/                           # the five reference documents
├─ packages/
│  └─ core/                        # ⚠️ @corral/core — pure logic. No I/O. The only source of shared types.
│                                  #    consumed by app/ and server/ as a file: dependency (no workspace tool)
│     └─ src/{policy,action,amount,events,errors,strategy}.ts
├─ server/                         # Express + TS backend (imported from Coral, gains:)
│  └─ src/services/evm/            #   viem chain layer, session install/verify, signer, relayer, planner
├─ app/                            # Vite + React frontend (imported from Coral)
├─ contracts/                      # Foundry (EVM)
│  ├─ src/CorralJournal.sol
│  └─ test/Violations.t.sol        # the 25-case matrix
├─ crates/                         # v2 Rust workspace — RETIRING: removed once @corral/core reaches test parity
└─ .github/workflows/
```

### CI must enforce

| Rule | Mechanism |
|---|---|
| `@corral/core` has no I/O | dependency-cruiser: core may import nothing but zod |
| No hand-written shared types | ESLint boundary: `Policy`/`Action`/`Plan`/`ExecutionStatus` importable only from `@corral/core` |
| No `number` on money paths | ESLint rule + branded `TokenAmount`; grep for `parseFloat`/`Number(` in amount modules |
| No policy-widening outside session install | grep for `enableSessions` outside `server/src/services/evm/sessionInstall` |
| No unbounded approvals | unit test + grep for `maxUint256`/`MaxUint256` in approval construction |
| No key material | gitleaks; KMS SDK importable only in the signer module |
| Strict TS | `tsc --noEmit` with `strict: true`, per-package |
| Contracts | `forge build` + `forge test` incl. Violations matrix |

---

## 5. Bootstrap v3 — the first eight tasks, in order

Work these before touching anything else. T-numbers are the v3 re-baseline tickets (see `docs/03_BACKLOG.md` v3 delta).

| # | Task | Ticket | Done when |
|---|---|---|---|
| 1 | Import Coral `app/` + `server/` snapshot into this repo; keep their per-package **npm** layout and lockfiles intact (lockfile pins are provenance; D24 keeps upstream pushes low-friction) | T-001 | `npm run build` green in both `app/` and `server/`; inherited server vitest suite passes; provenance commit references the Coral SHA |
| 2 | `@corral/core` scaffold + port `TokenAmount` from Rust with test parity (fast-check) | T-002 | Property tests: no silent overflow; decimal-string wire form; rejects `number` |
| 3 | Port `RawPolicy → ValidatedPolicy` (zod `.strict()` + `parsePolicy()`), all six invariants | T-003 | Each invariant has a failing-case test (PRD §8 table) |
| 4 | Port Action DSL + `Plan` (closed enum, `.strict()`) and error taxonomy + exhaustive `retryClass` | T-004 | Extra JSON field fails parse; unclassified error code fails `tsc` (exhaustive switch + `never`) |
| 5 | CI re-point: tsc/eslint/dependency-cruiser/vitest/gitleaks + Foundry; **then delete `crates/` + Rust jobs** | T-005 | CI green with no Rust; core rules from §4 enforced |
| 6 | `CorralJournal.sol` + 100% branch coverage + CREATE2 deploy to Base Sepolia | T-006 (=C-201/202) | Deployed, verified, address committed |
| 7 | EVM account layer: ERC-7579 account deploy + counterfactual address via viem/permissionless, pinned module addresses + codehash assertions | T-007 | Owner deploys account on Sepolia; addresses pinned |
| 8 | Session install with the pinned SmartSessions TS SDK + **post-install read-back verification** | T-008 | Install → read back → decode → compare → ACTIVE; mismatch pauses |

After task 8: the violation matrix (highest-value security artifact), then the Uniswap adapter + deterministic planner + execution pipeline in `server/`, then FE re-pointing from Sui to Base. The BE's existing Sui code stays untouched until the stakeholder decides its fate.

---

## 6. Commands

Per-package npm (Coral lineage — `--legacy-peer-deps` is required, their lockfiles assume it). `@corral/core` is consumed via `file:../packages/core` dependencies, not a workspace.

```bash
npm --prefix packages/core test    # core: vitest + fast-check
npm --prefix packages/core run build
npm --prefix server run build      # tsc
npm --prefix server test           # vitest (104 inherited + new)
npm --prefix app run build         # tsc -b + vite build
npm --prefix app run lint

# Contracts
forge build --root contracts
forge test  --root contracts -vvv
forge test  --root contracts --match-path test/Violations.t.sol   # security-critical

just check-all                     # everything CI runs
```

---

## 7. Working agreement

**Picking work.** Take the lowest-numbered unblocked ticket in the current epic from `docs/03_BACKLOG.md` (v3 delta first). Dependencies listed there are real.

**Before writing code.** Read the `FR-`/`SEC-` requirements the ticket references in `docs/01_PRD.md`. The acceptance criteria are written to become tests; use them as the tests.

**Test-first is mandatory** for `@corral/core`, session install/verify, the violation matrix, and anything touching budgets, approvals or revocation. In those areas the test *is* the specification. Elsewhere, use judgement.

**Before committing.** `just check-all` and `forge test` green. Update `docs/04_PROGRESS.md` in the same commit. No exceptions, no "I'll fix it in the next commit."

**Commit format.** `feat(core): action policy param rules (FR-2.5, T-004)`. Requirement and ticket IDs are stable — always include them.

**Scope.** Keep the diff to the ticket. If you find an adjacent problem — including anything in the inherited Coral code — note it and raise it; don't fold it in.

### Stop and ask when

- A ticket seems to require violating §2.
- A requirement contradicts the spec, or either contradicts this file.
- A violation-matrix case cannot be made to revert. **This is a design conversation, not a failing test.**
- Post-install verification finds a mismatch and the cause isn't obvious.
- You'd need a second Solidity contract, a new external dependency with meaningful trust, or an oracle.
- Anything would be pushed to the `coral` remote.
- A change would make the security property in §1 harder to state or defend.

---

## 8. Where this project will go wrong (v3)

1. **Session configuration correctness.** We no longer hand-write encoding (D22), but composing the SDK's policies wrongly still produces a session that installs cleanly and enforces the wrong thing. The defenses are non-negotiables #2 (post-install verify) and #13 (violation matrix). Write the matrix before the pipeline, and pin the SDK exactly — an unreviewed SDK upgrade is a security event, not a routine bump.
2. **TypeScript money discipline.** Rust made `TokenAmount` misuse uncompilable; TS makes it merely lintable. The `number`-ban lint, branded types, and fast-check suites are the substitute — treat a lint suppression on a money path as a review-blocking defect.
3. **The relayer nonce allocator.** Unchanged from v2: a nonce gap stalls every user simultaneously and only surfaces under production concurrency. Over-test it.
4. **The inherited codebase.** `server/` ships with auth, points, referrals, Telegram — surface we didn't design. Boundary rule: Corral execution paths may not depend on gamification modules, and a compromise of those modules must not reach the signer. Raise anything that smells like it crosses.

## 9. Things that look like bugs but are intentional

- Policies are immutable. Editing means revoke + create new (FR-2.9).
- `TokenAmount` has no arithmetic operators — `checkedAdd`/`checkedSub` only, deliberately inconvenient.
- The budget mirror can disagree with the chain. When it does, the session pauses rather than proceeding (FR-6.3).
- The standalone `/revoke` page duplicates logic and hardcodes addresses. It must work when every Corral service is down (FR-8.3). **Do not DRY it up.**
- Journal calls look like wasted gas. They are the traceability guarantee (FR-3.4).
- The deterministic planner is less capable than the LLM chat path. Deliberate — prompt injection must not reach unattended execution.
- The Sui/Move/DeepBook code in the Coral lineage is dormant, not dead — demo heritage, left as-is (D21).

## 10. Two claims we never overstate

1. **Revocation prevents everything after it; it cannot reverse an already-included transaction.** Own-relayer submission means the residual window is our own submission latency — small, measurable, not zero.
2. **We do not claim censorship resistance.** Base uses a centralised sequencer.

---

## 11. Status (v3 re-baseline)

**Product track**
- [x] v2 bootstrap 1–6 (Rust core through error taxonomy — retiring; semantics port to TS in T-002…T-004)
- [ ] T-001…T-005 Foundations: Coral import, `@corral/core`, CI re-point
- [ ] T-006…T-008 Contracts + account + session install/verify ⚠️ critical path
- [ ] Violation matrix
- [ ] Adapter + planner + execution pipeline
- [ ] FE re-point (Sui → Base), policy review screen, kill switch, standalone revoke
- [ ] Security & launch (KMS custody, audit, guarded mainnet)

Tick these as epics complete. Record any decision change in `docs/00_FEASIBILITY_AND_TIMELINE.md` §6 (the ADR log), not only in a commit message.
