# Corral Protocol — Feasibility Analysis & Timeline (v2)

**Version:** 2.0 — respecified for a fully self-hosted stack with a Rust backend
**Supersedes:** v1.0 (30 July 2026, serverless + TypeScript)
**Date:** 30 July 2026

---

## 0. What changed from v1 and why

| Decision | v1 | v2 | Driver |
|---|---|---|---|
| Infrastructure | Managed serverless (Vercel + Inngest + Neon + hosted indexer + vendor bundler/custody) | **Fully self-hosted**, including own Base nodes | Stakeholder decision: full control from the outset |
| Backend language | TypeScript | **Rust** | Stakeholder decision |
| Shared types | `packages/core` in TypeScript, consumed by both sides | **`corral-core` Rust crate**, compiled natively for the backend and to WASM for the frontend | Single source of truth for the security-critical `Policy` type |
| Transaction submission | Third-party ERC-4337 bundler | **Own relayer calling `EntryPoint.handleOps`** | Removes an external mempool from the revocation path |
| Key custody | Vendor (Turnkey/Privy/CDP) | **Own signer service on KMS/HSM** | Removes a third party from the trust boundary |
| Timeline to guarded mainnet | 18 weeks | **27–28 weeks serial, or ~20 weeks with a parallel infra track** | Scope increase |
| Team | 2.6 FTE | **3.6 FTE — adds a dedicated infra/SRE role** | Self-hosting needs an owner |

**Unchanged, deliberately:** the contracts, the policy model, the enforcement design, the violation matrix, the audit scope, and every functional requirement in the PRD. That is not a coincidence — the architecture already assumes the entire off-chain stack is hostile, so changing who operates it does not touch the security core. It's a good sign for the design that this respec is an infrastructure document, not a rewrite.

---

## 1. Verdict on the chosen stack

**Coherent, defensible, and roughly 50% more calendar time. One component of it (own Base nodes) has a materially weaker payoff than the rest, for a reason worth understanding before committing.**

### 1.1 What Tier 3 + self-bundling genuinely buys you

This is the part that's better than I think you may realise, and it's tied directly to the product's central promise.

In v1, the weakest link in the guarantee was revocation. A userOp handed to a third-party bundler is a signed, valid instruction sitting in someone else's mempool, and you have **no visibility into when or whether it will be included**. That's why v1 §6 had to downgrade "immediate revocability" from a guarantee to a bounded SLO with an unbounded worst case.

When you run the relayer yourself:

- No signed userOp exists anywhere you don't control.
- You know exactly which operations you have broadcast and when.
- Off-chain signer disable (<1s) means no *new* operations can be created, and the relayer refusing to submit means none are pending.

The residual window shrinks from **"unbounded and invisible"** to **"bounded by your own submission latency and fully observable."** In practice that's usually zero pending operations at revoke time, with a known and measurable worst case. That's a defensible product claim, and it's the strongest single argument for your Tier 3 choice.

Additionally: no RPC provider sees your users' transactions before inclusion, which removes a (modest but real) frontrunning surface on DCA swaps.

### 1.2 The caveat on owning Base nodes

Running your own Base nodes does **not** give you censorship resistance, and it's important nobody on the team believes it does.

Base is an OP Stack L2 with a **centralised sequencer**. Transactions reach the chain by being submitted to that sequencer. Your own node forwards to it exactly like a commercial RPC would. The only sequencer-independent inclusion path is L1 force-inclusion, which is a slow (many-hour) escape hatch, not an operational route.

So you can own every server in your pipeline and still be one company's sequencer policy away from censorship. What own nodes actually buy you:

| Benefit | Real? |
|---|---|
| No third-party rate limits or provider outages | ✅ Yes, meaningful |
| No provider sees your transactions/reads | ✅ Yes |
| Indexer reads at head with no query cost | ✅ Yes, and it simplifies the indexer |
| Reliable `eth_call` for preflight under load | ✅ Yes |
| Censorship resistance | ❌ **No** — sequencer dependency remains |
| Better security guarantee | ❌ No — threat model already assumes hostile infra |

Plus an inherited dependency people forget: **`op-node` needs an Ethereum L1 endpoint** (execution + consensus) for derivation. "Own Base nodes" is therefore either "own Base nodes plus a commercial L1 endpoint" — which reintroduces a vendor — or "own Base nodes plus own L1 node," which is a second, larger node operation.

**My recommendation, if you want it:** keep Tier 3, but **sequence the node work last** and run on commercial RPC with multi-provider failover until then. It's the one Tier 3 component with no security payoff, no revocation payoff, and the largest ops burden. Deferring it takes ~3 weeks off the critical path and changes nothing about the architecture, because the node sits behind the same `ChainClient` interface either way. If sovereignty positioning matters for fundraising or a specific customer, do it — just do it in week 20 rather than week 6.

### 1.3 On Rust

Your combination resolves my earlier objections better than either choice alone would have:

| My v1 objection to Rust | Status under v2 |
|---|---|
| No Inngest SDK; you'd hand-roll durable jobs | **Void.** You're hand-rolling the job runner regardless under Tier 3. No double cost. |
| `Policy` type duplicated across two languages | **Void, and inverted into an advantage.** The WASM-compiled `corral-core` crate means the type and its validation logic exist exactly once, and the frontend cannot drift from the backend. This is strictly better than the v1 TypeScript design. |
| ERC-4337/7579 tooling is TypeScript-first | **Still stands. This is the real cost: ~+2 weeks.** No Rust SDK encodes SmartSessions permissions. You will hand-write that encoding against the Solidity source. Mitigation in §4. |

Two Rust wins specific to this system that I'll now argue for properly:

1. **Amount handling becomes a compiler guarantee.** My v1 rule "never represent token amounts as `number`" was a lint rule policing a bug class. `TokenAmount(U256)` as a newtype deletes the bug class. In a system whose entire purpose is enforcing spending limits, a silent precision error in an amount is close to a worst-case bug.
2. **Parse, don't validate.** A `ValidatedPolicy` that can only be constructed through `TryFrom<RawPolicy>` means "unvalidated policy" is unrepresentable past the boundary. zod's `.strict()` approximates this; Rust's type system enforces it.

And a pleasing alignment: **`op-reth` is Rust and is Base's preferred client.** <cite index="43-1">Base documentation states Reth is currently the most performant client for running Base nodes and that future optimisations will focus on Reth.</cite> Your infra and your application share a language.

---

## 2. Target stack

| Layer | Choice | Notes |
|---|---|---|
| Chain | Base (Sepolia → mainnet) | Unchanged |
| Account | ERC-7579 modular smart account | Unchanged |
| Enforcement | SmartSessions + UniversalAction / SpendingLimits / TimeFrame / ValueLimit / UsageLimit | Unchanged |
| Custom Solidity | `CorralJournal.sol` (~40 LOC) | Unchanged |
| Contracts tooling | Foundry | Unchanged |
| **Shared core** | **`corral-core` Rust crate** → native + WASM (`wasm-bindgen`, `tsify` for TS types) | Policy, Action, Plan, events, errors, encoder |
| **Backend** | **Rust**: axum + tokio, sqlx or SeaORM, alloy for chain I/O | |
| **Job runner** | **Own Postgres queue** (`SELECT … FOR UPDATE SKIP LOCKED`) | See §3 — deliberately not Temporal |
| **Database** | Self-hosted PostgreSQL 16+, streaming replica, PITR via WAL archiving | |
| **Signer** | Own service, KMS/HSM-backed secp256k1, one key per user session signer | |
| **Relayer/bundler** | Own: `EntryPoint.handleOps` via alloy, dedicated relayer EOA | Not a bundler framework |
| **Gas sponsorship** | Prefunded EntryPoint deposits or an own verifying paymaster | |
| **Indexer** | Own Rust log poller → Postgres | Trivial at this volume |
| **Nodes** | 2× `op-reth` + `op-node` (Base full nodes) + L1 endpoint | **Sequence last — see §1.2** |
| **Frontend** | Next.js + TypeScript, consuming `@corral/core` (WASM) | Unchanged framework |
| **Infra** | Dedicated hardware or bare-metal cloud; Terraform + Ansible (or Nix); Vault or SOPS+age for secrets | |
| **Observability** | Prometheus + Grafana + Loki + Alertmanager, self-hosted | |

---

## 3. Why an own Postgres queue rather than Temporal

Under Tier 3 the instinct is to reach for a serious workflow engine. I'd argue against it, on scale grounds.

Your job volume at 1,000 active sessions with weekly DCA is on the order of **a few thousand jobs per week**. Your concurrency requirement is a single rule: one execution at a time per session. Your durability requirement is already satisfied by the idempotency ledger, which exists because the *chain* is the real source of truth — a lost job is recoverable by reading on-chain state, unlike in a typical distributed system.

Temporal would add a cluster to operate, its own database, its own failure modes, and its own on-call burden, to solve a problem you don't have. A Postgres-backed queue using `FOR UPDATE SKIP LOCKED` with a visibility timeout, exponential backoff and a per-session advisory lock is roughly 400 lines of Rust, uses the database you already run, and its failure modes are ones your team already understands.

Revisit if you reach genuinely long-running multi-day workflows (v2 multi-step strategies with rollback would be the trigger).

---

## 4. The hard part: hand-writing the ERC-7579 encoding

This is the single largest new technical risk in v2, and it lands on the critical path in weeks 5–8.

**The problem.** SmartSessions permission encoding — `permissionId` derivation, `enableSessions` calldata, per-policy init data, action-policy parameter rule encoding — exists as a well-tested TypeScript SDK and as Solidity. It does not exist in Rust. You will reimplement it by reading the contracts.

An encoding bug here is not a crash. It is a **silently wrong policy**: a session that installs successfully and looks correct in the UI but enforces something other than what the user agreed to. That is the worst failure mode this product has.

**The mitigation, and it's a strong one — differential testing.**

Build a test-only Node harness that generates session configuration using the reference TypeScript SDK, and assert **byte-for-byte equality** with the Rust encoder's output across thousands of generated policies:

```
corral-core (Rust)  ──encode──▶  bytes_rust  ─┐
                                              ├──▶ assert_eq!  (10k generated policies)
reference TS SDK    ──encode──▶  bytes_ts    ─┘
```

This turns "we reimplemented a security-critical encoder" into "we reimplemented it and proved it agrees with the reference on ten thousand inputs, in CI, on every commit." It is the difference between this being an acceptable risk and an unacceptable one. Treat the harness as a release blocker, not a nice-to-have — it's tickets C-306/C-307 and it's not optional.

Use `alloy::sol!` against the actual contract sources for ABI types so struct encoding is generated rather than hand-written; restrict hand-written logic to the composition layer.

---

## 5. Invariants, revisited

The scoring improves in one place, which is worth noting because it came directly from your Tier 3 decision.

| Invariant | v1 | v2 | Change |
|---|---|---|---|
| 1. Constraint Supremacy | ✅ | ✅ | — |
| 2. On-Chain Enforcement | ✅ | ✅ | — |
| 3. No Implicit Trust in Agent | ✅ | ✅ | Strengthened: no vendor in the signing path |
| 4. Deterministic Validation | ⚠️ Reframe | ⚠️ Reframe | Unchanged. Still "deterministic given (input, chain state)". Rust's determinism doesn't change an on-chain property. |
| 5. Immediate Revocability | ⚠️ Unbounded worst case | ✅ **Bounded and observable** | **Upgraded.** Own relayer ⇒ no external mempool holds signed ops. Worst case is your own submission latency and is measurable. Still cannot reverse an included transaction — say so plainly. |
| 6. Full Traceability | ✅ with journal | ✅ | Own indexer simplifies this |

---

## 6. Decision log v2

Supersedes v1 §8. D1–D4, D6, D7, D9, D10 carry over unchanged.

| ID | Decision | Chosen | Rationale |
|---|---|---|---|
| D5′ | Budget unit (v1) | Per-asset caps, no oracle | Unchanged and now more important: a Rust reimplementation plus an oracle policy in the same release is too much new surface at once |
| D8′ | Runtime | Self-hosted Rust services on owned infrastructure | Stakeholder decision |
| D11 | Shared core | `corral-core` Rust crate → native + WASM; TS types generated, never hand-written | Single source of truth for `Policy` |
| D12 | Job orchestration | Own Postgres queue (`FOR UPDATE SKIP LOCKED`) | §3 |
| D13 | Transaction submission | Own relayer calling `handleOps`; no bundler framework, no shared mempool | §1.1 — this is the revocation guarantee |
| D14 | Key custody | Own signer service, KMS/HSM-backed, one key per session signer | Removes vendor from trust boundary; see D18 for the scaling limit |
| D15 | Gas sponsorship | Prefunded EntryPoint deposits in v1; own verifying paymaster in v1.1 | Simplest thing that works with an own relayer |
| D16 | Chain access | Commercial RPC with multi-provider failover **until week 20**, then own `op-reth`+`op-node` | §1.2 — sequencing, not a downgrade |
| D17 | Encoder verification | Differential test against the reference TS SDK, in CI, release-blocking | §4 |
| D18 | Signer scaling | One KMS key per session signer at v1 scale; migrate to enclave-held derived keys above ~5,000 sessions | Per-key cost and API limits become the binding constraint; plan the migration, don't build it yet |

---

## 7. New risks introduced by v2

Carried forward from v1 §10, plus:

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R15 | **Encoder divergence** — Rust encoding differs from the reference, producing a silently wrong policy | M | **Critical** | D17 differential harness; decode-and-verify on-chain state after every session install before marking it ACTIVE |
| R16 | **Relayer key compromise** — the relayer EOA is a hot key holding gas | M | High | KMS-held; funds capped at a rolling ceiling; the relayer cannot widen policy, so blast radius is gas theft, not user funds; monitor balance |
| R17 | Relayer nonce mismanagement stalls all executions | M | High | Single-writer nonce allocator, persisted; stuck-tx detection with replacement-by-fee; a second standby relayer |
| R18 | Self-hosted Postgres data loss | L | Critical | Streaming replica + WAL archiving + tested restore; remember the DB is a *mirror* — chain state is authoritative, which caps the damage |
| R19 | No vendor to page at 3am | H | Med | Runbooks, real on-call rota, staged alerting. This is a standing organisational cost, not a one-off |
| R20 | Node ops burden (sync failures, disk growth, upgrade coordination) | H | Med | Deferred to week 20 (D16); 2 nodes minimum; break-glass commercial RPC retained permanently |
| R21 | Rust hiring / bus factor | M | High | Fewer available Rust+EVM engineers than TS+EVM. Document heavily; avoid clever async; keep one engineer cross-trained |
| R22 | WASM bundle bloats the frontend | L | Low | Measure against NFR-12; `wasm-opt`; the policy core is small logic |
| R23 | Sequencer dependency mistaken for censorship resistance | M | Med | §1.2 written into onboarding docs; never claim it in marketing |
| R24 | KMS regional outage halts all signing | L | High | Multi-region key replication; degraded mode = executions queue and retry, never bypass |

---

## 8. Timeline

### 8.1 The structural choice that determines the date

Tier 3 work (nodes, relayer, signer service, job runner, IaC, monitoring) is **almost entirely independent** of product work (contracts, policy encoding, adapters, strategies, frontend). Whether this project lands in November or February depends on whether you run those tracks in parallel.

| Approach | Team | Guarded mainnet |
|---|---|---|
| **Serial** — one backend engineer does infra then product | 2.6 FTE | ~27–28 weeks → **late Feb 2027** (after holiday freeze) |
| **Parallel** — dedicated infra/SRE alongside product engineers | 3.6 FTE | **~20 weeks → mid-to-late Dec 2026**, realistically **mid-Jan 2027** with the freeze |

**Recommendation: hire or assign the infra engineer.** The marginal cost is one person for roughly five months; the marginal benefit is about eight weeks of calendar time and an owner for infrastructure that will need one permanently anyway. Doing Tier 3 without a dedicated owner is the most likely way this schedule slips.

The plan below assumes **parallel**.

### 8.2 Track B-v2 — parallel, 20 weeks, kickoff Mon 3 Aug 2026

**Product track** (Solidity + Rust product engineer + frontend)

| Wk | Dates | Phase | Exit gate |
|---|---|---|---|
| 1 | Aug 3–7 | Decisions, threat model, repo, counsel, **audit outreach** | ADRs signed |
| 2–3 | Aug 10–21 | `corral-core` crate: Policy/Action/Plan/errors, WASM build, generated TS types wired into the FE | FE compiles against WASM core; zero hand-written shared types |
| 4 | Aug 24–28 | Account adapter, session install/revoke, `CorralJournal` deployed to Sepolia | Owner installs and revokes a session |
| 5–8 | Aug 31–Sep 25 | **Policy encoder in Rust + differential harness** (§4). Violation matrix V1–V25. Invariant fuzzing. **Audit slot booked (wk 5).** | **G1:** 10k-policy byte-equality vs reference SDK; all 25 violation cases revert |
| 9–10 | Sep 28–Oct 9 | Uniswap v3 adapter, Permit2 flow, Plan→calldata compiler, preflight/simulation gate | Agent swap lands on testnet inside policy |
| 11–12 | Oct 12–23 | Execution pipeline on the own job runner; retry engine; reconciliation; chaos tests | **G2:** zero double-executions across 50 induced failures |
| 13 | Oct 26–30 | Strategy layer: DCA fixed/percent, price-conditional | Strategies are pure compositions of primitives |
| 14 | Nov 2–6 | Own indexer wired to activity feed; notifications | Every execution reconciles to an intent hash |
| 15 | Nov 9–13 | Frontend hardening: policy review, budget meters, kill switch, standalone revoke page, all states | Usability test n=5 passes FR-11.1 |
| 16 | Nov 16–20 | Internal security review, **code freeze → audit starts** | **G3:** zero known highs |
| 17–18 | Nov 23–Dec 4 | Audit in flight ∥ testnet beta with 20–50 users; runbook rehearsals | ≥100 successful executions, ≥5 clean revocations |
| 19 | Dec 7–11 | Audit remediation + re-review | **G4:** all critical/high closed |
| 20 | Dec 14–18 | Guarded mainnet: allowlist, caps ($500/account, $25k global), on-call live | **G5:** launch checklist green |

**Infra track** (infra/SRE, from week 1)

| Wk | Deliverable |
|---|---|
| 1–2 | Hardware/provider procurement; IaC skeleton; secrets management; CI runners |
| 3–4 | PostgreSQL: primary + replica, WAL archiving, **tested restore**, backup rota |
| 5–6 | Signer service on KMS: secp256k1 signing, DER/low-s/recovery-id handling, IAM, audit logging, rotation runbook |
| 7–9 | Relayer: `handleOps` submission, nonce allocator, gas management, EntryPoint deposits, stuck-tx replacement, standby relayer |
| 10–11 | Own job runner (`FOR UPDATE SKIP LOCKED`), visibility timeouts, backoff, per-session locking, metrics |
| 12–13 | Own indexer: log poller, reorg handling, backfill, health checks |
| 14–15 | Observability stack; alert thresholds; 7 runbooks |
| 16–17 | Runbook rehearsals; failure injection; on-call rota established |
| 18–20 | **Base nodes**: 2× `op-reth` + `op-node`, snapshot sync, L1 endpoint, failover, cutover from commercial RPC with break-glass retained |

Note the node work sits at the end, per D16, where it can slip without touching the launch date.

### 8.3 Slip factors specific to v2

| Factor | Cost |
|---|---|
| No dedicated infra engineer | +8 weeks (reverts to serial) |
| Encoder differential harness deferred or skipped | Unquantifiable — this is the one place a shortcut can produce a silently wrong policy |
| Own L1 node added to scope | +3 weeks and a much larger storage footprint |
| Archive rather than full Base nodes | +2 weeks and materially more storage |
| Temporal adopted instead of the Postgres queue | +2 weeks build, plus permanent ops burden |
| Rust engineer ramping on alloy/EVM | +2–3 weeks |

---

## 9. Infrastructure sizing and cost

### 9.1 Base nodes (week 18+)

Sizing from Reth's published Base profile: roughly **2 TB for a full node, ~4.1 TB for archive**. <cite index="41-1">Reth notes that for Base, 5+ CPU cores are needed because the state-root task parallelises across threads.</cite> <cite index="43-1">Base publishes snapshots that substantially reduce initial sync time.</cite>

**You want full nodes, not archive.** Your indexer starts at your own deployment block, so there is no deep history to backfill, and preflight `eth_call`s happen at head. Archive doubles storage and sync time for capability you don't use. Verify current snapshot sizes at procurement time — they grow.

Per node: 8+ cores (high clock), 64 GB RAM, 4 TB NVMe (headroom for growth), 1 Gbps. Run two, in different failure domains. Budget for disk growth every few months.

**Do not forget the L1 endpoint** required by `op-node`. Either a commercial L1 provider (pragmatic; keep it) or your own Ethereum node, which is a separate ~1.2 TB+ operation with its own consensus client.

### 9.2 Monthly running cost

| Item | Low | High |
|---|---|---|
| 2× Base full nodes (dedicated/bare metal) | $300 | $700 |
| L1 endpoint (commercial) | $50 | $250 |
| App servers, DB primary + replica | $150 | $400 |
| Observability + log storage | $40 | $120 |
| KMS (keys + API calls, v1 scale) | $30 | $150 |
| Backups / object storage | $20 | $80 |
| Relayer gas float (Base) | $50 | $400 |
| Break-glass commercial RPC | $0 | $100 |
| **Total** | **~$640/mo** | **~$2,200/mo** |

Higher than v1's ~$300/mo, and the real cost is the engineer, not the servers.

### 9.3 One-off costs to launch

| Item | Low | High |
|---|---|---|
| External audit (scope unchanged: ~40 LOC custom Solidity + policy composition) | $15,000 | $45,000 |
| Re-audit / remediation review | $3,000 | $10,000 |
| Bug bounty pool | $10,000 | $25,000 |
| Legal | $5,000 | $25,000 |
| Hardware deposits / setup | $0 | $4,000 |
| Infrastructure during build (20 wks) | $3,000 | $10,000 |
| Testnet + mainnet gas | $1,000 | $5,000 |
| **Total (excl. salaries)** | **~$37,000** | **~$124,000** |

Audit cost is essentially unchanged, because the on-chain surface is unchanged — self-hosting adds no auditable contract code. Worth noting when justifying the infra spend.

---

## 10. Team v2

| Role | Alloc | Weeks | Notes |
|---|---|---|---|
| Senior Solidity / AA engineer | 1.0 | 1–16, 19 | Owns encoder correctness and the violation matrix |
| Senior Rust engineer (product) | 1.0 | 1–20 | Owns `corral-core`, execution pipeline, adapters |
| **Infra / SRE engineer** | **1.0** | **1–20** | **New in v2.** Owns everything in the infra track and the on-call rota |
| Frontend engineer (existing) | 0.6 | 2–20 | WASM integration + policy authoring UX |
| Product / PM | 0.3 | throughout | Owns guarantee copy, incl. the §1.2 sequencer honesty |
| Design | 0.3 | 8–15 | |
| External auditor | — | 16–19 | Book week 5 |
| Counsel | — | 1–2, 18 | |

**The critical hire is the infra engineer**, and they're needed from week 1, not week 10. Without them the timeline reverts to serial and the launch moves to late February.

---

## 11. Go/no-go gates v2

| Gate | When | Criteria |
|---|---|---|
| G0 | Wk 1 | ADRs signed; threat model reviewed; counsel engaged; infra engineer in place |
| **G1′** | **Wk 8** | **Encoder differential harness green over 10k policies** + all 25 violation cases revert + revoke SLO measured |
| G2 | Wk 12 | Chaos test: zero double-executions in 50 induced failures; relayer survives forced nonce conflicts |
| G3 | Wk 16 | Zero known highs; runbooks exist; **restore-from-backup tested successfully** |
| G4 | Wk 19 | All critical/high audit findings closed and re-reviewed |
| G5 | Wk 20 | Kill switch drilled in production; caps live; on-call staffed |

G1′ is new and is the most important gate in v2. **Do not proceed past week 8 without byte-equality against the reference encoder.** Everything downstream assumes the policy on-chain is the policy the user agreed to.

---

## 12. What I'd still push back on

Stated once, plainly, then it's your call and the docs reflect your decision:

1. **Own Base nodes have the weakest ROI of anything in Tier 3** (§1.2). Sequenced last, they cost nothing on the critical path — which is how the plan above treats them. If you find yourself pulling them forward, that's the moment to re-read §1.2.
2. **Tier 3 without a dedicated infra owner is the top schedule risk.** Not the Rust, not the encoder — the fact that self-hosting is a permanent job, not a project.
3. **Do not add the oracle-backed USD budget to this release.** A Rust reimplementation of the encoder and a new oracle-dependent policy in the same audit is more new surface than this team should absorb at once. It remains v1.1.
