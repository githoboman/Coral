# Corral — Progress Log

**Purpose:** the single running record of what has been done, what is in flight, and what is next — kept in tandem with `03_BACKLOG.md` (tickets), `CLAUDE.md` §5 (bootstrap order) and §12 (epic status).

**The rule:** every commit that changes code or docs also updates this file, in the same commit. A commit that doesn't update this file is incomplete. Newest session entries go on top of §4.

---

## 1. Where we are

| | |
|---|---|
| **Current phase** | **Bootstrap complete (8/8).** Next epic: violation matrix |
| **Active ticket** | Violation matrix V1–V25 (`contracts/test/Violations.t.sol`, old C-309) — the highest-value security artifact; write before the pipeline. V11 (24h cap) is now enforceable on-chain via `CorralRateLimitPolicy` (D26) |
| **Next up** | Uniswap adapter + deterministic planner + execution pipeline in `server/` |
| **Deployed** | `CorralJournal` @ `0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F` on Base Sepolia — see `contracts/deployments/base-sepolia.json` |
| **Blocked / waiting** | — |

## 2. Ticket board

Status: `☐` not started · `◐` in progress · `☑` done · `✖` blocked. Only tickets touched or imminent are listed; the full backlog stays in `03_BACKLOG.md` (v3 delta map at its top).

### v3 bootstrap (CLAUDE.md §5 — strict order)

| # | Ticket | Status | Evidence when done |
|---|---|---|---|
| 1 | T-001 Coral snapshot import (npm per-package) | ☑ | Imported at Coral `4e07c85`; server: tsc ✓ + **104/104 vitest** ✓; app: `tsc -b && vite build` ✓ (2026-08-08). Divergences: `app/package.json` gains `overrides: {"@mysten/sui": "1.45.2"}` and `app/package-lock.json` regenerated — **upstream's lockfile was desynced from its own package.json** (their final commit bumped the dep without regenerating; `npm ci` impossible as shipped). First candidate patch to offer upstream |
| 2 | T-002 `@corral/core` + `TokenAmount` port | ☑ | Branded-bigint `TokenAmount`, checked add/sub, strict decimal-string zod schema; 8/8 vitest+fast-check, each test named for the Rust test it ports (2026-08-08) |
| 3 | T-003 `parsePolicy` — six invariants | ☑ | zod `.strict()` everywhere; every invariant has failing-case tests incl. symbol-spoof, U256_MAX-cap, nested-unknown-field and checksum-case edge cases; result deep-frozen; `policyToWire` round-trip law tested. 14/14 (2026-08-08) |
| 4 | T-004 Action DSL + `Plan` + errors + `retryClass` | ☑ | Closed DSL (no calldata/delegatecall variant); strict `Plan`; `Record<ErrorCode,…>` tables give compile-time exhaustiveness; policy rejections all `["NEVER",0]`. 14 new tests, 36/36 package-wide (2026-08-08) |
| 5 | T-005 CI re-point to TS; delete `crates/` | ☑ | Parity audit passed (4/4 modules, TS suites ≥ Rust suites); `crates/`, `Cargo.*`, `rust-toolchain.toml`, `deny.toml` removed; CI = core/server/app npm jobs + grep boundary checks + Foundry + gitleaks; justfile all-TS (2026-08-08). **Follow-up T-005b: ☑ done 2026-08-22** — eslint (strictTypeChecked + money-path bans) + dependency-cruiser purity contract wired into `npm run lint`, CI, and `just check-all`; lint found and fixed 3 real nits in core |
| 6 | T-006 `CorralJournal.sol` + Sepolia deploy | ☑ | Contract + 5 tests at 100% coverage (2026-08-08); **deployed 2026-08-22 via CREATE2 to `0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F`** (tx `0xcc394ab6…3600`, block 45834924, 101,288 gas), bytecode confirmed via RPC, **Basescan-verified**. Manifest: `contracts/deployments/base-sepolia.json` |
| 7 | T-007 EVM account layer (viem) | ☑ | D25 Safe 1.4.1 + Safe7579. `addresses.ts`: 14 contracts hand-pinned with keccak codehashes + `assertPinnedCodehashes` boot gate; `account.ts` via permissionless `toSafeSmartAccount` (EntryPoint v0.7, registry-attested modules only). Tests: 6 SDK-builders-vs-pins (offline), 1 codehash integration, 3 counterfactual-address integration — all green. **Account deployed on Sepolia at the exact predicted address** `0xf2A97cd5…c7343` (tx `0x0db2e9d9…c983`), FR-1.1 proven (2026-08-22) |
| 8 | T-008 Session install (pinned SDK) + read-back verify | ☑ | `compose.ts` (policy → Session + expectation model; multi-valued IN_SET and zero ValueLimit handled explicitly), `verify.ts` (validator, userOp/action policy sets, every stored policy config; reverting getter = mismatch), own relayer `handleOps.ts` (op-level success/revert decoded), `install.ts` (owner-signed first userOp: deploy + setupSafe + installModule + journal). 32 offline tests. **Live on Base Sepolia 2026-08-23: account `0xB497…4ef0`, permissionId `0x32ab6293…7e57`, verification 0 mismatches → ACTIVE** (tx `0x6b8e41ed…6e32`) |

### v2 bootstrap (historical — semantics carry into T-002…T-004, then `crates/` retires)

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
| G0 | ADRs signed, threat model, audit slot | ◐ — D19–D24 decided by stakeholder 2026-08-01; threat model + audit outreach open |
| G1′ | **(v3, D22)** Session install verified by on-chain read-back; V1–V25 revert; SDK pinned | ☐ |
| G2 | Zero double-executions across 50 induced failures | ☐ |
| G3 | Zero known highs; runbooks; restore tested | ☐ |
| G4 | Audit criticals/highs closed | ☐ |
| G5 | Launch checklist green | ☐ |

## 4. Session log (newest first)

### 2026-08-23 — Session 9: D26 — `CorralRateLimitPolicy` (FR-2.7 on-chain)

- Stakeholder chose **both layers** for the rolling 24h cap: on-chain custom policy + off-chain scheduler pacing (ADR D26; CLAUDE.md §3 custom-Solidity line, PRD FR-2.7 and spec §4.3 amended — the latter also fixes the multi-valued `IN_SET` example).
- `contracts/src/CorralRateLimitPolicy.sol`: SmartSessions `IUserOpPolicy`; exact trailing window via a ring buffer of the last `limit` accepted timestamps (≤ MAX_LIMIT=64 SLOADs per check); storage keyed `[configId][multiplexer][account]` like Rhinestone's policies; local interface mirror `ISmartSessionPolicy.sol` with **interface id pinned to the value SmartSessions probes (0x7129edce)**. 8 Foundry tests incl. a 1,000-run fuzz against a reference model; **100% lines/statements/branches/functions.**
- **Caveat recorded (D26):** `block.timestamp` in the validation phase violates public-bundler rules (ERC-7562) — acceptable only because D13 (own relayer) is permanent.
- Deployed via CREATE2 to **`0x4ABa00153c4c05244F505563Fe2d37ad47990Ca1`** (tx `0x40540bc6…7461`), Basescan-verified, codehash-pinned. Composer emits `RATE_LIMIT` (cap 0 = none; >64 = `ComposeError`); verifier reads `getRateLimitConfig` and compares limit + window. **Live: account `0x6E2A…f360`, permissionId `0x4a8532a8…f539`, verification 0 mismatches → ACTIVE** (tx `0x39ef0b0d…c492`, 2.26M gas).
- Enforcement proof (a session-signed op rejected on-chain as the 3rd in 24h) lands with the violation matrix (V11) and the execution pipeline (session-key signing).
- Off-chain half: the scheduler's pacing check is part of the execution-pipeline epic (same `max_executions_per_24h` field).

### 2026-08-23 — Session 8: T-008 — session install + post-install verification (bootstrap complete)

- **Result:** owner-signed first userOp deploys the Safe7579 account, installs SmartSessions with the composed session, journals the install; submitted via our own `handleOps` relayer; read-back verification compares validator, userOp-policy set, action set, per-action policy sets and **every stored policy config** (UAP rules, spending limit, time frame, usage limit) against the signed policy → **0 mismatches → ACTIVE.**
- Findings along the way (each fixed and tested):
  1. **Registry attestation gap on Base Sepolia:** neither Rhinestone's attester nor its mock attester has attested SmartSessions or the V2 policies (registry records empty), while the Safe7579 launchpad requires a non-empty trusted-attester set (`InvalidTrustedAttesterInput` on empty). Resolution: the dev key attests the pinned SmartSessions address (`scripts/evmAttestModules.ts`, Rhinestone's schema, types 1+7) and is Base Sepolia's sole trusted attester — the same mechanism mainnet uses with Rhinestone's attester. `registryGating` is per-chain config; **mainnet gate: verify Rhinestone attestations and switch.** SmartSessions itself hard-codes `useRegistry:false` for policy enables, so only the validator install is gated.
  2. **ValueLimitPolicy V2 rejects limit 0** (`PolicyNotInitialized` at init). A zero native cap is now enforced by every action's UAP `valueLimitPerUse = 0` (exact); non-zero caps install ValueLimitPolicy.
  3. **Direct factory deploy leaves a dead launchpad-staged proxy** (permissionless checks `getCode` and skips `setupSafe`). Product path = first-userOp deploy (FR-1.3). Dev accounts salts 0–3 are dead; salt 4 is the live one.
  4. **Relayer must read op-level success** (`UserOperationEvent.success`, `UserOperationRevertReason`), not tx status — a userOp can revert inside a successful `handleOps`. Fixed.
  5. **Verifier: a reverting getter is a mismatch, never an exception.** Fixed + tested.
  6. **Ops:** a viem error dump printed the Alchemy URL (API key) into the session transcript — stakeholder advised to rotate; all further tool output masks RPC URLs. Alchemy free tier limits `eth_getLogs` to 10-block ranges (indexer design note).
- **Spec gaps raised (stakeholder decisions, not blocking):** (a) FR-2.7 rolling-24h execution cap has no on-chain policy in the V2 set — enforced off-chain only until a custom policy (a second contract → architecture decision) is approved; (b) multi-valued `IN_SET` (e.g. fee tiers {500,3000}) is not expressible in UniversalActionPolicy — composition rejects it (FR-5.3), policies must pick one value per parameter.

### 2026-08-22/23 — Session 7: T-007 — EVM account layer

- Stakeholder chose **Safe + Safe7579** (ADR D25). Installed viem 2.55.19, permissionless 0.4.0, @rhinestone/module-sdk 0.4.0 (exact-pinned per D22).
- **Security finding while pinning:** module-sdk 0.4.0 carries **two** SmartSessions policy address sets — legacy V1 in per-policy folders, current V2 in `GLOBAL_CONSTANTS` (Rhinestone's migration guide confirms a redeploy). The builders use V2. We hand-pin V2 hex, and a unit test asserts each builder's output address equals our pin, so a future SDK bump that moves addresses fails CI instead of silently encoding against different contracts. Exactly the risk class D22 / CLAUDE.md §8.1 warned about.
- All 14 pinned addresses (EntryPoint v0.7, Safe 1.4.1 singleton/factory, Safe7579 adapter/launchpad, registry, attester, SmartSessions, five policies, CorralJournal) verified to hold bytecode on Base Sepolia; keccak codehashes captured, asserted at boot (`assertPinnedCodehashes`) and in an integration test.
- **Account deployed at the counterfactual address** — the factory's `ProxyCreation` event names exactly the predicted proxy (FR-1.1 proven). Launchpad flow is two-phase: the proxy points at the launchpad until the first userOp completes `initSafe7579`; that first userOp will be the T-008 session install.
- **Ops finding:** the load-balanced RPC served a stale `getCode` immediately after `waitForTransactionReceipt` (the script briefly reported FR-1.1 violated; a re-read was fine). Post-write reads — including T-008's post-install verification — must retry with backoff or read at a confirmed block. Script patched accordingly.
- Server: tsc clean; inherited 104 + 10 new tests = 114/114.

### 2026-08-22 — Session 6 (cont.): T-006 deployed and verified

- Stakeholder funded the deployer (0.052 ETH). `forge script --broadcast` deployed `CorralJournal` via CREATE2 to the precomputed address; inline `--verify` raced Basescan's indexer ("Unable to locate ContractCode") — a standalone `forge verify-contract --watch` a moment later returned **Pass – Verified**. Bytecode (218 bytes) independently confirmed with `cast code`. Broadcast record committed under `contracts/broadcast/` (dry-runs stay ignored); canonical manifest at `contracts/deployments/base-sepolia.json`.
- Bootstrap: **6 of 8 done.** T-007 next — its on-chain half (account deploy) can use the same funded deployer.

### 2026-08-22 — Session 6: env verified, deployer wallet, T-005b

- Stakeholder supplied Alchemy + Basescan keys. Verified end-to-end: Alchemy RPC answers chain id 84532; Basescan key well-formed; deploy **simulation against live Base Sepolia succeeds**. CREATE2 gives the journal's permanent address ahead of time: **`0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F`** (same on every chain, forever, for salt `corral.journal.v1`).
- The value initially pasted as `DEPLOYER_PRIVATE_KEY` was actually the Basescan API key; a real deployer wallet was generated with `cast wallet new` and written straight into the gitignored `contracts/.env` **without the key ever entering the transcript**. Deployer address: `0x91ac808850c33E15dc028a12Bfcaad70F1F8e6f9`. **T-006 close-out waits only on faucet ETH to that address.** `origin` repo still not created (probed 2026-08-22).
- **T-005b:** grep-based CI boundary checks upgraded to real tooling — `@corral/core` gains eslint (typescript-eslint strictTypeChecked + money-path bans: no `parseFloat`/`parseInt`/`Number()`/`Math.*`, no `any`, no ts-suppressions, no non-null assertions) and dependency-cruiser (imports limited to zod + own files, no Node builtins). CI core job runs `npm run lint`; the freed boundaries step now greps app/server for hand-written shared-type declarations (§2.9).

### 2026-08-08 — Session 5 (cont.): first push to the Coral repo

- Stakeholder-directed (D24 satisfied): full history pushed to `Tovira-xyz/Coral` as branch **`corral-v3`** (their `main` untouched). Standing plan: our own repo `github.com/olaDmenace/corral` becomes primary `origin` once the stakeholder creates it; `coral/corral-v3` is the visibility branch for the upstream team.
- Remote `origin` pre-wired to `https://github.com/olaDmenace/corral.git` (repo not yet created).

### 2026-08-08 — Session 5: toolchain cleanup + T-006 code

- Dev-box cleanup per stakeholder: Rust toolchain/cargo/rustup and VS Build Tools fully removed (winget's uninstall was a silent no-op; the VS installer's own `setup.exe` did it), orphaned VS package cache cleared. 9.3 → 20.5 GB free. Foundry/Node/just retained.
- **T-006 code complete:** `CorralJournal.sol` (event-only, no storage/roles/funds), `CorralJournal.t.sol` — msg.sender binding, permissionless-by-design, timestamp source, exact-field fuzz, rejects ether; **100% lines/statements/branches/functions**. `DeployJournal.s.sol` CREATE2 with fixed salt; `contracts/.env.example` documents the testnet-only key contract (SEC-13 note included). forge-std v1.16.2 submodule.
- Deploy blocked on stakeholder: fresh `cast wallet new` key in `contracts/.env`, funded via Base Sepolia faucet (Coinbase CDP or Alchemy), then `forge script` + Basescan verify + address commit.

### 2026-08-08 — Session 4 (cont.): T-005 — Rust retired, CI re-pointed

- Parity audit: every Rust module and test file has a TS counterpart (amount 8≥7, policy 14≥11, action 7≥6, errors 7≥7 tests); the other eight crates were empty stubs. Removed `crates/`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `deny.toml` — the Rust implementation remains reachable in git history (`ed1d85c^` and earlier) as the reference spec.
- CI rewritten: `core` (npm ci + strict tsc + vitest), `server` (npm ci --legacy-peer-deps + tsc + vitest), `app` (npm ci --legacy-peer-deps + build), `boundaries` (grep: core-purity/enableSessions/unbounded-approvals), `contracts` (Foundry), `gitleaks`. **T-005b follow-up:** eslint + dependency-cruiser to replace the greps per CLAUDE.md §4.
- justfile now all-TS; `check-all` = core/server/app builds + tests + forge. VS Build Tools and the Rust toolchain on the dev box are now removable if disk pressure returns (stakeholder's call).

### 2026-08-08 — Session 4 (cont.): T-004 — Action DSL, `Plan`, error taxonomy

- `action.ts`: closed discriminated union (SWAP/TRANSFER/APPROVE/WRAP/UNWRAP — tags equal `ActionKind` wire names, so `actionKind` is total by construction); strict `Plan` with nullable-but-required `strategy_id` (wire parity with Rust `Option`); `planToWire` round-trip law tested.
- `errors.ts`: 19 codes; `retryClass`/`userMessage` as `Record<ErrorCode,…>` — TS's compile-time substitute for Rust's exhaustive match (missing or extra key fails `tsc`). Policy rejections and safety pauses all terminal.
- 36/36 tests. All four Rust modules (`amount`, `policy`, `action`, `errors`) now have TS parity ports — `crates/` is eligible for retirement at T-005.

### 2026-08-08 — Session 4 (cont.): T-003 — `parsePolicy` (six invariants)

- Ported `policy.rs` → `packages/core/src/policy.ts` keeping the **wire format byte-compatible with the Rust serde output** (snake_case fields, tagged `rule`/`kind` objects, decimal-string amounts) so any existing consumer of the format is unaffected.
- `parsePolicy()` is the only constructor of `ValidatedPolicy` (branded + deep-frozen — runtime immutability for FR-2.9); addresses/selectors lowercase at the boundary so checksum casing can't split identity; asset identity by address, never symbol.
- `policyToWire()` added as the serialization inverse (bigints → decimal strings; round-trip law `parsePolicy(policyToWire(vp)) ≡ vp` tested). 14/14 policy tests, 22/22 package-wide.

### 2026-08-08 — Session 4 (cont.): T-002 — `@corral/core` scaffold + `TokenAmount`

- `packages/core`: strict-TS package (`NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod runtime dep, vitest + fast-check dev deps.
- `TokenAmount` ported from `crates/corral-core/src/amount.rs`: branded `bigint` in `[0, 2^256−1]`, `checkedAdd`/`checkedSub` returning `null` on overflow/underflow (no operator path), `TokenAmountSchema` accepting only pure-decimal strings (regex-validated *before* `BigInt()` — `BigInt(" 1")`/`BigInt("")` would silently accept), rejecting bare numbers and bigints.
- 8/8 tests green; property tests mirror the Rust suite one-for-one (test names cite their Rust counterparts for the parity audit at T-005).

### 2026-08-08 — Session 4: T-001 — Coral snapshot imported and verified

- Imported `app/` + `server/` from `Tovira-xyz/Coral` @ `4e07c85d0e252765127ec346d7a6f80f45e3b49c` (183 + 184 files). Kept per-package **npm** layout and lockfiles (pnpm wiring removed; CLAUDE.md §5/§6 amended accordingly) — lockfile pins are provenance and keep upstream pushes low-friction (D24).
- **Server:** lockfile imported byte-identical; `tsc` build ✓; inherited test suite **104/104** ✓.
- **App:** upstream bug found — `package-lock.json` desynced from `package.json` (last upstream commit bumped `@mysten/sui` to 1.45.2 without regenerating the lock; `npm ci` fails as shipped, and plain `npm install` produced a duplicated `@mysten/sui` tree that broke `tsc`). Fixed by adding `overrides: {"@mysten/sui": "1.45.2"}` and regenerating the lockfile. Build ✓. Noted for upstream.
- Flaky-network battle: repeated `ERR_SOCKET_TIMEOUT` (50–90 s/tarball) caused two silently-truncated package extractions (`@types/node/stream.d.ts` cut mid-comment; `react-icons` missing every `index.d.ts`) — repaired by targeted delete + re-extract. Lesson recorded: on this connection, treat "file exists" as unproven — verify builds.
- Known inherited debt (not fixed, per scope rule): app main chunk is 2.2 MB minified (Vite warns); server carries non-Corral consumer features (points/referrals/Telegram) — boundary rules in CLAUDE.md §8.4 apply.

### 2026-08-01 — Session 3: **v3 respec** — the stakeholder decisions and the doc update

Stakeholder decisions (recorded as ADRs D19–D24 in `docs/00` §6):
1. **Backend stays Express + TS + Supabase** (the Coral lineage, 104 tests) — supersedes the Rust services plan.
2. **Chain stays Base/EVM**; Sui Coral is demo-only heritage. The BE gains a viem chain layer.
3. **Shared core rewritten in TypeScript** (`@corral/core`: zod `.strict()`, branded-bigint `TokenAmount`, fast-check) — Rust crates retire at T-005 once ported with test parity.
4. **This repo stays primary**; `Tovira-xyz/Coral` wired as git remote `coral` for optional future upstreaming (nothing pushed without instruction). Directory names will mirror Coral's.
5. **KMS custody before mainnet** (secp256k1, non-exportable); testnet may keep encrypted-at-rest keys.
6. Consequence of TS + Base: session encoding now uses the **reference TS SmartSessions SDK, pinned** (D22) — the v2 hand-written-encoder risk and its differential harness are obsolete; post-install read-back verification and the violation matrix carry unchanged as the security gates.

Docs updated in this commit: CLAUDE.md fully rewritten (v3 stack, non-negotiables reworked for TS, new bootstrap T-001…T-008); `docs/00` v3 banner + ADRs; `docs/01` §8 schema in TS, SEC-13/15 amended, NFR-9/12/13/14 retargeted, Q1/Q6/Q8 closed; `docs/02` §0 addendum with per-section validity map; `docs/03` v3 delta map.

Ops note: the drive hit **326 MB free** mid-edit (two writes failed with ENOSPC and were re-applied); deleted the 843 MB Rust `target/` dir to recover. Stakeholder should free more space before T-001.

### 2026-08-01 — Session 2 (cont.): reviewed upstream `Tovira-xyz/Coral`

- Cloned and reviewed the repo the stakeholder was invited to (private; read via stored git credential; local clone in session scratchpad only, not added to this repo).
- **Finding: Coral is the Sui hackathon predecessor, not the v2 frontend.** Sui Overflow 2026 entry: Move `AgentPolicy`/`AgentCapability` contracts (17 Move tests), Express+TS backend with server-held encrypted agent keys and Gemini NL intent parsing (104 tests), Vite+React frontend embedded in a larger consumer app (Supabase auth, points/streaks/referrals, Telegram mini-app, Solana+EVM wallet deps). Same core thesis (on-chain-bounded agent autonomy, owner revoke), different chain, custody model, and stack.
- **Doc impact:** the "existing Next.js frontend" premise in CLAUDE.md §3 / spec §2 / PRD Q2 does not match reality — the candidate FE is Vite+React inside a multi-purpose app, targets Sui, and hand-writes its types. Import strategy for `apps/web` is an open decision for the stakeholder (see report in session transcript); no doc edits made pending that decision.
- No code or dependency from Coral was pulled into this repo.

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
