# Corral — Engineering Backlog (v2, Rust + self-hosted)

**Version:** 2.0 — supersedes v1.0
Two parallel tracks: **PRODUCT** (Solidity + Rust product engineer + frontend) and **INFRA** (infra/SRE). Estimates in ideal engineer-days for a senior engineer. The 20-week calendar in `00_FEASIBILITY_AND_TIMELINE.md` §8.2 already includes review, integration and slack.

**Roles:** `SOL` Solidity/AA · `RS` Rust product · `INF` infra/SRE · `FE` frontend · `PM` product · `SEC` external

**Definition of Done:** code + tests + no new lint/`cargo-deny`/boundary violations + docs updated + demoable on Base Sepolia. For anything touching `corral-core::encode`, add: **differential harness green.**

---

# TRACK 1 — PRODUCT

## EPIC 0 — Foundations (week 1) · 8d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-001 | ADRs D1–D18; circulate; sign off | 1.5d | PM+SOL+RS | — |
| C-002 | Threat model: assets, actors, trust boundaries, attack tree, residuals | 1.5d | SOL+RS | C-001 |
| C-003 | Cargo workspace + Foundry + pnpm frontend wiring | 1d | RS | C-001 |
| C-004 | CI: `cargo clippy -D warnings`, `cargo-deny` per-crate dependency allowlist, `forbid(unsafe_code)`, gitleaks, Foundry | 1.5d | RS | C-003 |
| C-005 | Contact 3 audit firms; quotes + availability; **hold a week-16 slot** | 0.5d | PM | C-001 |
| C-006 | Engage counsel on custody/advice classification (SEC-11) | 0.5d | PM | — |
| C-007 | `wasm32-unknown-unknown` build target in CI from day one | 0.5d | RS | C-003 |
| C-008 | Decide and document the Rust job-runner design (own Postgres queue) | 1d | RS+INF | C-001 |

**Gate G0:** ADRs signed, threat model reviewed, audit slot held, infra engineer onboarded.

## EPIC 1 — `corral-core` + WASM (weeks 2–3) · 13d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-101 | `TokenAmount` newtype: checked arithmetic only, serde as decimal string, no `Add` impl | 1d | RS | C-003 |
| C-102 | `RawPolicy` → `ValidatedPolicy` via `TryFrom`, all invariants incl. recipient-pin and unbounded-approval checks | 2.5d | RS | C-101 |
| C-103 | Action DSL + `Plan` with `deny_unknown_fields` | 1.5d | RS | C-101 |
| C-104 | `CorralEvent` schema | 1d | RS | C-101 |
| C-105 | Error taxonomy + exhaustive `retry_class` match | 1d | RS | C-003 |
| C-106 | Strategy config + state machine with enforced transitions | 1.5d | RS | C-103 |
| C-107 | WASM bindings: `validate_policy`, `policy_summary`, `policy_hash` | 2d | RS | C-102 |
| C-108 | `wasm-pack` build → `apps/web/packages/core-wasm`; `tsify` type generation; **CI fails on stale generated output** | 1.5d | RS+FE | C-107 |
| C-109 | Property tests on policy validation (`proptest`) | 1d | RS | C-102 |

**Gate:** the frontend compiles against the WASM core and contains zero hand-written shared types.

## EPIC 2 — Account & contracts (week 4) · 8d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-201 | `CorralJournal.sol` + 100% unit coverage + NatSpec | 1.5d | SOL | C-003 |
| C-202 | CREATE2 deploy script; deploy to Base Sepolia | 0.5d | SOL | C-201 |
| C-203 | `ChainClient` trait + alloy implementation (reads, `eth_call`, receipts) | 2d | RS | C-003 |
| C-204 | Account deploy + counterfactual address prediction | 1.5d | SOL | C-203 |
| C-205 | Pinned module addresses + CI codehash assertion | 1d | SOL | C-203 |
| C-206 | Single-signature deploy + install + fund bundle (FR-1.3) | 1.5d | SOL | C-204 |

## EPIC 3 — Policy encoder ⚠️ (weeks 5–8) · 26d

**The critical path. Protect these weeks from everything else.**

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-301 | `alloy::sol!` bindings generated from SmartSessions + policy module sources | 1.5d | SOL | C-205 |
| C-302 | `permissionId` derivation + `enableSessions` calldata composition | 3d | SOL | C-301 |
| C-303 | Per-policy init data encoders (action, spending-limits, time-frame, value, usage) | 4d | SOL | C-302 |
| C-304 | Parameter-rule encoding (`EQ_ACCOUNT`, `IN_SET`, `LTE`, `GTE`) | 3d | SOL | C-303 |
| C-305 | Decoder + `proptest` round-trip | 2d | SOL | C-304 |
| C-306 | **Node differential harness: reference TS SDK vs Rust encoder** | 3d | RS+SOL | C-304 |
| C-307 | **10k-policy byte-equality differential test wired into CI as release-blocking** | 2d | RS | C-306 |
| C-308 | Post-install verification: read back, decode, compare, page on divergence (spec §5.3) | 1.5d | RS | C-305 |
| C-309 | **Violation matrix V1–V25** on a Base fork | 5d | SOL | C-304 |
| C-310 | Invariant fuzz harness (cumulative spend, revoked, expired) | 2d | SOL | C-309 |
| C-311 | Revoke flow: `removeSession` + nonce-key bump + signer/relayer disable ordering | 2d | SOL+RS | C-304 |
| C-312 | `preflight()`: remaining budget + candidate-action acceptance | 1.5d | SOL | C-304 |

**Gate G1′ (week 8):** differential harness green over 10k policies; all 25 violation cases revert; revoke SLO measured. **Do not proceed without this.**

## EPIC 4 — Adapters & compiler (weeks 9–10) · 14d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-401 | `ProtocolAdapter` trait + policy-requirements declaration | 1.5d | RS | C-103 |
| C-402 | Uniswap v3 adapter: quote, build_actions, decode_result, describe_for_user | 4d | RS | C-401 |
| C-403 | Permit2 approval flow, exact amounts, ≤10 min expiry | 2.5d | SOL+RS | C-402 |
| C-404 | Deterministic `Plan` → calldata compiler | 3d | RS | C-402, C-304 |
| C-405 | Compiler property tests (10k valid pass preflight / 10k invalid rejected) | 2d | RS | C-404 |
| C-406 | Preflight + simulation gate with typed failure mapping | 1.5d | RS | C-404 |

## EPIC 5 — Execution pipeline (weeks 11–12) · 15d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-501 | Pipeline wiring, steps 1–13 (spec §7) | 3d | RS | C-406, I-401 |
| C-502 | Idempotency ledger + unique constraint + insert-or-fail commit point | 2d | RS | I-201 |
| C-503 | Retry engine driven by `retry_class`; policy rejections terminal | 2d | RS | C-105 |
| C-504 | `execution.recover` for rows stuck in SUBMITTED | 1.5d | RS | C-501 |
| C-505 | `budget.reconcile` + `MIRROR_DRIFT` auto-pause | 2d | RS | C-312 |
| C-506 | `module.monitor` + `MODULE_SET_CHANGED` auto-pause | 1.5d | RS | I-501 |
| C-507 | Chaos harness: kill at 10 lifecycle points × 5 | 3d | RS | C-501 |

**Gate G2 (week 12):** zero double-executions across 50 induced failures.

## EPIC 6 — Strategies (week 13) · 8d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-601 | `DeterministicPlanner` | 2.5d | RS | C-106 |
| C-602 | `DCA_FIXED` | 1.5d | RS | C-601 |
| C-603 | `DCA_PERCENT` | 1.5d | RS | C-601 |
| C-604 | `CONDITIONAL_PRICE` (off-chain trigger, on-chain `amountOutMinimum`) | 2d | RS | C-601 |
| C-605 | Strategy-vs-policy compatibility check at creation, specific reasons | 1d | RS | C-312 |

## EPIC 7 — Feed & notifications (week 14) · 8d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-701 | `CorralEvent` projection: decode logs, compute slippage, join to executions | 2.5d | RS | I-501 |
| C-702 | `/executions` + `/verify/:address` endpoints | 1.5d | RS | C-701 |
| C-703 | Notification dispatcher: email + Telegram, digest batching | 2d | RS | C-105 |
| C-704 | Product dashboards + alert thresholds | 2d | RS+INF | I-601 |

## EPIC 8 — Frontend (weeks 3–15, interleaved) · 24d

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-801 | Integrate `@corral/core` WASM; delete any duplicated local types; measure bundle impact (NFR-12) | 2d | FE | C-108 |
| C-802 | Agent creation wizard, 3 templates (J1) | 4d | FE | C-206 |
| C-803 | **Policy review screen** rendered from `policy_summary()` (FR-11.1) | 3d | FE+PM | C-107 |
| C-804 | Budget meters with on-chain freshness indicator | 2d | FE | C-312 |
| C-805 | Activity feed; failures/aborts/rejections visually distinct | 3d | FE | C-702 |
| C-806 | Kill switch, ≤1 tap from anywhere | 1.5d | FE | C-311 |
| C-807 | **Standalone static revoke page**, zero dependency on our API, nodes or WASM pipeline | 2d | FE | C-311 |
| C-808 | Plan preview: next 3 executions | 2d | FE | C-601 |
| C-809 | All empty/loading/stale/error/expired/revoked/paused states | 3d | FE | C-802 |
| C-810 | Error-code → human message mapping; never show raw reverts | 1d | FE | C-105 |
| C-811 | Usability test n=5 on FR-11.1 comprehension; iterate | 1d | PM+FE | C-803 |

## EPIC 9 — Security, audit, launch (weeks 16–20) · 20d + external

| ID | Ticket | Est | Role | Deps |
|---|---|---|---|---|
| C-901 | Prompt-injection corpus (100+) in CI | 2d | RS | C-601 |
| C-902 | Anomaly detection: frequency, size, rejection-rate | 2d | RS | C-501 |
| C-903 | Internal security review vs pre-audit checklist | 3d | SOL+RS | all |
| C-904 | Audit brief + code freeze + handoff | 1d | SOL | C-903 |
| C-905 | External audit | — | SEC | C-904 |
| C-906 | Testnet beta, 20–50 users; feedback triage | 3d | all | C-811 |
| C-907 | Bug bounty live | 1d | PM | C-905 |
| C-908 | Audit remediation + re-review | 4d | SOL | C-905 |
| C-909 | Mainnet deploy, caps, allowlist, $10-policy smoke test | 1d | SOL+RS | C-908 |
| C-910 | Production kill-switch drill with real funds | 0.5d | all | C-909 |

---

# TRACK 2 — INFRASTRUCTURE

Runs from week 1 in parallel. Blocking dependencies for the product track are marked **⚠️ BLOCKS**.

## EPIC I1 — Provisioning (weeks 1–2) · 9d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-101 | Hardware/provider selection and procurement (app tier first, nodes later per D16) | 2d | — |
| I-102 | Terraform skeleton; network segmentation; firewall policy | 2.5d | I-101 |
| I-103 | Ansible/Nix base configuration; hardened images; SSH policy | 2d | I-102 |
| I-104 | Secrets management (Vault or SOPS+age); rotation policy documented | 1.5d | I-102 |
| I-105 | Self-hosted CI runners for Rust + Foundry + WASM | 1d | I-103 |

## EPIC I2 — Database (weeks 3–4) · 8d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-201 | PostgreSQL 16 primary; schema migrations via sqlx **⚠️ BLOCKS C-502** | 2d | I-103 |
| I-202 | Streaming replica + failover procedure | 2d | I-201 |
| I-203 | WAL archiving to object storage; PITR configured | 1.5d | I-201 |
| I-204 | **Restore drill: full PITR restore verified end-to-end** | 1.5d | I-203 |
| I-205 | Connection pooling (PgBouncer), tuning, metrics | 1d | I-201 |

## EPIC I3 — Signer service (weeks 5–6) · 11d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-301 | KMS setup: key policy, IAM, per-session key provisioning, multi-region replication | 2d | I-104 |
| I-302 | `corral-signer`: KMS secp256k1 signing, DER parse, **low-s normalisation**, recovery-id derivation | 3d | I-301 |
| I-303 | Independent revoked/expired refusal check (defence in depth) | 1.5d | I-302 |
| I-304 | Append-only signer audit log, shipped off-box | 1d | I-302 |
| I-305 | Key rotation + break-glass runbook | 1.5d | I-302 |
| I-306 | Signer test suite incl. malformed-signature and KMS-outage paths | 2d | I-302 |

## EPIC I4 — Relayer (weeks 7–9) · 16d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-401 | `corral-relayer`: `EntryPoint.handleOps` submission via alloy **⚠️ BLOCKS C-501** | 3d | I-302, C-203 |
| I-402 | Nonce allocator: single writer, persisted, advisory-locked | 3d | I-401, I-201 |
| I-403 | Gas strategy: EIP-1559 bump schedule, replace-by-fee for stuck txs | 2.5d | I-401 |
| I-404 | EntryPoint deposit management + prefunding for sponsorship | 2d | I-401 |
| I-405 | Standby relayer: second key, cold, config-promotable | 1.5d | I-401 |
| I-406 | Revoked-session submission refusal | 1d | I-401 |
| I-407 | Relayer integration tests: nonce conflicts, stuck txs, failover | 3d | I-402 |

## EPIC I5 — Job runner & indexer (weeks 10–13) · 16d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-501 | `corral-indexer`: log poller, reorg handling, backfill, health metrics **⚠️ BLOCKS C-701** | 4d | I-201 |
| I-502 | `corral-jobs`: `FOR UPDATE SKIP LOCKED` claim, per-session concurrency 1 | 3d | I-201 |
| I-503 | Visibility timeout reaper; backoff with jitter; dead-letter table | 2d | I-502 |
| I-504 | Job scheduling (cron-style) + queue metrics | 1.5d | I-502 |
| I-505 | Concurrency test: 100 racing workers, one session, assert serialisation | 2d | I-502 |
| I-506 | Blue/green deploy pipeline; forward-compatible migration policy | 3.5d | I-105 |

## EPIC I6 — Observability & ops (weeks 14–17) · 14d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-601 | Prometheus + Grafana + Loki + Alertmanager, self-hosted | 3d | I-103 |
| I-602 | Alert thresholds per spec §11.4 | 2d | I-601 |
| I-603 | **10 runbooks** (spec §11.4) | 3d | I-602 |
| I-604 | Runbook rehearsals, one each | 2d | I-603 |
| I-605 | On-call rota, escalation policy, paging | 1d | I-603 |
| I-606 | Failure injection: kill DB primary, KMS, relayer, node — verify degraded behaviour | 3d | I-604 |

## EPIC I7 — Base nodes (weeks 18–20, deferred by D16) · 13d

| ID | Ticket | Est | Deps |
|---|---|---|---|
| I-701 | Node hardware procurement (8+ cores, 64 GB, 4 TB NVMe, ×2) | 1d | — |
| I-702 | `op-reth` + `op-node` deployment, snapshot sync, full (not archive) mode | 3d | I-701 |
| I-703 | L1 endpoint: commercial provider + failover; document as a retained dependency | 1d | I-702 |
| I-704 | Second node in a separate failure domain | 1.5d | I-702 |
| I-705 | `ChainClient` failover: own nodes → break-glass commercial RPC | 2d | I-704, C-203 |
| I-706 | Node monitoring: blocks behind head, disk growth, peer count | 1.5d | I-601 |
| I-707 | Cutover from commercial RPC to own nodes, with rollback plan | 2d | I-705 |
| I-708 | Node ops runbook: sync failure, disk pressure, client upgrade | 1d | I-707 |

---

## Effort summary

| Track | Epic | Days |
|---|---|---|
| Product | 0 Foundations | 8 |
| Product | 1 `corral-core` + WASM | 13 |
| Product | 2 Account & contracts | 8 |
| Product | **3 Policy encoder** | **26** |
| Product | 4 Adapters & compiler | 14 |
| Product | 5 Execution pipeline | 15 |
| Product | 6 Strategies | 8 |
| Product | 7 Feed & notifications | 8 |
| Product | 8 Frontend | 24 |
| Product | 9 Security & launch | 20 |
| **Product subtotal** | | **144** |
| Infra | I1 Provisioning | 9 |
| Infra | I2 Database | 8 |
| Infra | I3 Signer | 11 |
| Infra | I4 Relayer | 16 |
| Infra | I5 Jobs & indexer | 16 |
| Infra | I6 Observability | 14 |
| Infra | I7 Base nodes | 13 |
| **Infra subtotal** | | **87** |
| **Total** | | **231 ideal days** |

231 ideal days ≈ 46 ideal weeks, delivered in 20 calendar weeks by ~3.6 FTE. Compare v1: 137 days in 18 weeks at 2.6 FTE. The extra 94 days is the price of Tier 3 plus the Rust encoder work — and it is almost entirely parallelisable, which is exactly why the infra engineer is what keeps this a 20-week project rather than a 28-week one.

---

## The three tickets that decide the project

1. **C-307 — the encoder differential test.** Without it you are shipping a hand-written reimplementation of security-critical encoding on hope. This is the single most important ticket in the backlog.
2. **C-309 — the violation matrix.** Every case you can't make revert is a design conversation, not a failing test. Expect it to expand.
3. **I-402 — the relayer nonce allocator.** A nonce gap stalls every user's executions simultaneously, and it's the kind of bug that appears only under concurrency in production. Over-test it.

If the schedule slips, it will slip on these. Everything else has float.
