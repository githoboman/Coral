# Corral — Product Requirements Document
*Product release v1 · Document version 2.0*

**Version:** 2.1 — v3-amended, 1 Aug 2026 (ADRs D19–D24): backend is the Coral-lineage Express + TypeScript + Supabase service; the shared core is the TypeScript `@corral/core` package; session encoding uses the reference TS SmartSessions SDK. **Every FR is unchanged** — they were stack-independent by design. §8 and the SEC-13/15 wordings are amended below; NFR-9/12/13/14 retargeted for the managed posture.
*(v2.0 header follows for provenance)* — respecified for a Rust backend on self-hosted infrastructure
**Changes from v1.0:** §8 policy schema moved to the `corral-core` Rust crate (WASM-shared with the frontend); §10 event schema likewise; §11 NFRs updated for self-hosted infrastructure; SEC-13…SEC-18 added for own key custody, encoder verification and the sequencer honesty rule; §15 open questions revised. **All functional requirements (FR-x.y) are unchanged** — they were written to be stack-independent, and the respec proved that out.
**Date:** 30 July 2026
**Target release:** Guarded mainnet, week 20 (see `00_FEASIBILITY_AND_TIMELINE.md` v2 §8.2)
**Scope:** Base (EVM). Non-custodial. Retail. Rust backend, self-hosted infrastructure.

> **How to read this doc.** Requirements are numbered `FR-x.y` (functional), `NFR-x` (non-functional), `SEC-x` (security). Every FR has acceptance criteria written so they can be turned directly into tests. Requirements marked **[MUST]** are release blockers; **[SHOULD]** ship if the schedule holds; **[LATER]** are explicitly out of v1.

---

## 1. Problem

Users who want automated on-chain activity today choose between two bad options:

1. **Manual execution** — they approve every transaction. Automation is impossible; they miss timing; they don't do it.
2. **Full delegation** — they hand a key or an unlimited approval to a bot, exchange or "AI agent." If that system is compromised, buggy, or simply wrong, the user's entire balance is at risk. Nothing structurally prevents it.

There is no widely available middle option where a user can grant *bounded* autonomy and have the bound enforced by something other than the software's own good behaviour.

## 2. Product statement

Corral is a **policy-bound execution account**. A user delegates a specific, narrow capability to an agent — "swap up to 500 USDC into WETH on Uniswap over the next 30 days, weekly" — and the limits are enforced by the account's own on-chain validation logic, not by the agent's code. If the agent is compromised, hallucinates, or is instructed maliciously, the worst case is bounded by the policy the user signed. The user can end the delegation in a single transaction and can verify every action the agent took.

**One-line positioning:** *Autonomy you can bound, prove, and revoke.*

## 3. Goals & non-goals

### Goals (v1)

| ID | Goal | Metric |
|---|---|---|
| G1 | An agent executes real on-chain actions with zero per-action approvals | ≥95% of executions require no user interaction |
| G2 | Every policy violation fails at the protocol level, not in application code | 100% of injected violation attempts revert on-chain |
| G3 | Revocation is fast, provable, and available even if Corral's infrastructure is down | Off-chain signer disabled <1s; on-chain effective next block; static revoke page works with the app offline |
| G4 | Users can understand what they authorised | ≥80% of usability-test participants correctly answer "what is the most this agent could spend, and where can it send funds?" |
| G5 | Every action is verifiably traceable to the intent that caused it | 100% of on-chain executions carry a resolvable `intentHash` |

### Non-goals (v1) — say no to these out loud

- Not a wallet. Corral extends an account; it does not replace the user's primary wallet.
- Not a trading strategy provider. Corral executes user-defined strategies; it does not recommend them. (This is also a regulatory posture — see §12.)
- Not custodial. Corral never holds user funds or the owner key.
- Not chain-agnostic *yet*. One chain, done properly.
- Not multi-user / team accounts.
- Not a yield optimiser, not perps, not leverage.
- No insurance or loss guarantee.

---

## 4. Personas

| Persona | Description | Primary need | Failure mode to protect against |
|---|---|---|---|
| **P1 — Deliberate DCA-er** (primary) | Holds 4–20 assets, wants weekly buys, mildly technical, has been burned by an approval exploit | "Automate this without giving anything unlimited access" | Silent over-spend; not noticing the agent stopped working |
| **P2 — Active rebalancer** | Manages a small portfolio, wants drift-triggered rebalancing | Conditional execution with a hard budget | Slippage/MEV losses; too many small trades eating value |
| **P3 — Agent builder** (secondary) | Building their own agent, wants Corral as the safety substrate | A clean SDK and a policy primitive they can trust | Unclear enforcement guarantees; vendor lock |
| **P4 — Sceptical reviewer** | Diligence, security researcher, or a friend the user asks | Verify the claims independently | Marketing claims that don't survive inspection (see invariants §6 of the feasibility doc) |

---

## 5. Core concepts (use this vocabulary everywhere — code, UI, docs)

| Term | Definition |
|---|---|
| **Owner** | The user's root authority. Can do anything, including revoke. Never delegated. |
| **Agent Account** | The user's ERC-7579 modular smart account. Holds the funds. |
| **Session** | An installed, policy-constrained delegation to one agent signer. Has an expiry. |
| **Policy** | The immutable set of constraints attached to a session: assets, budgets, targets, actions, expiry, usage. |
| **Intent** | A user-authored objective in natural language or structured form. |
| **Plan** | A typed, validated sequence of Actions derived from an Intent. Never raw calldata. |
| **Action** | One primitive from the closed DSL: `SWAP`, `TRANSFER`, `APPROVE`, `WRAP`, `UNWRAP`. |
| **Strategy** | A recurring or conditional rule that produces Plans over time. |
| **Execution** | One submitted transaction bundle, with a status and an `intentHash`. |
| **Journal** | The on-chain record linking each Execution to its `intentHash`. |
| **Kill switch** | The owner-only revoke action. |

**Naming rule:** never use "permission," "allowance," or "approval" to mean Policy — those words already mean specific ERC-20/wallet things and the ambiguity will cause bugs and support tickets.

---

## 6. User journeys

### J1 — Create a policy-bound agent (first run)

1. User connects owner wallet → sees "no agent account yet."
2. Chooses a template: *Weekly DCA* / *Rebalance on drift* / *Custom*.
3. Configures: source asset + budget, target asset, venue (pre-selected), schedule, duration.
4. **Policy review screen** — plain-language summary of exactly what the agent can and cannot do, plus the worst case: *"Maximum this agent can ever spend: 500 USDC. It can only send funds to: your own account. It stops working on 30 Sep 2026."*
5. Signs **one** transaction: deploy account (if needed) + install session + fund. Gas sponsored.
6. Lands on the agent dashboard: next scheduled run, budget meter, activity feed (empty state explains what will appear).

**Acceptance:** a first-time user completes J1 in ≤3 minutes with exactly one signature and one funding transfer.

### J2 — Autonomous execution (the core loop)

1. Scheduler wakes for a due strategy.
2. Planner produces a Plan; Plan is validated against the local policy mirror; invalid → abort + notify, never attempt.
3. Compiler builds calldata; simulation gate runs; failing simulation → abort + notify, never submit.
4. Signer signs; userOp submitted; journal call appended.
5. Indexer picks up the event; activity feed updates; user gets a notification if it crosses a notify threshold.

**Acceptance:** no user interaction anywhere in this loop; every abort produces exactly one user-legible notification and one log entry.

### J3 — Revoke (the trust moment)

1. Kill switch is reachable from every screen, and from a **standalone static page** that works if the app's API is down.
2. One confirmation screen with an explicit statement of what revoke does and does not do (does not reverse already-executed transactions).
3. One transaction. Off-chain signer disabled immediately, without waiting for confirmation.
4. Confirmation state shows: session revoked at block N, on-chain proof link, remaining budget unspent, funds still in the user's account.

**Acceptance:** revoke succeeds with the Corral API fully offline. A subsequent agent execution attempt reverts on-chain and is logged as `REJECTED_SESSION_REVOKED`.

### J4 — Something went wrong

Every failure state must answer three questions in the UI: *what happened, did it cost me anything, what happens next.* No raw revert strings, no hex, no "something went wrong."

### J5 — Verify (persona P4)

A public verification page: given an account address, show every session ever installed, its policy, every execution with its `intentHash`, and a link to the on-chain journal entry. No login.

---

## 7. Functional requirements

### 7.1 Agent Account (doc §3.1)

| ID | Req | Priority |
|---|---|---|
| FR-1.1 | Deploy an ERC-7579 modular smart account per user, deterministic address derived from owner + salt, counterfactual before first tx | **[MUST]** |
| FR-1.2 | Account implementation accessed through an internal `AccountAdapter` interface; no implementation-specific types outside `corral-chain` | **[MUST]** |
| FR-1.3 | Deploy + session install + initial funding executable in a single user signature | **[MUST]** |
| FR-1.4 | Owner is always the sole root authority; Corral holds no owner key material and no admin role over user accounts | **[MUST]** |
| FR-1.5 | Module install allowlist: only the modules in the approved manifest may be installed; installation of anything else is detected and alerted within 1 block | **[MUST]** |
| FR-1.6 | Account supports receiving ERC-20 and native assets; fallback handler configured | **[MUST]** |

**AC FR-1.1:** the address shown in the UI before deployment equals the deployed address, verified in tests across 3 chains.
**AC FR-1.5:** a test installs a rogue validator and asserts an alert fires and the account is auto-paused.

### 7.2 Policy Engine (doc §3.2)

| ID | Req | Priority |
|---|---|---|
| FR-2.1 | Policy supports **asset scope**: an explicit allowlist of ERC-20/native assets the agent may spend | **[MUST]** |
| FR-2.2 | Policy supports **per-asset cumulative budget**: a hard maximum total spend per asset over the session's life, tracked on-chain | **[MUST]** |
| FR-2.3 | Policy supports **native value limit** | **[MUST]** |
| FR-2.4 | Policy supports **target scope**: allowlist of (contract address, function selector) pairs | **[MUST]** |
| FR-2.5 | Policy supports **parameter constraints** on whitelisted calls: e.g. `recipient == account`, `amountOutMinimum >= floor`, `spender ∈ allowlist`, `amount <= max` | **[MUST]** |
| FR-2.6 | Policy supports **time constraint**: `validAfter` / `validUntil`; expiry invalidates execution with no further action from the user | **[MUST]** |
| FR-2.7 | Policy supports **usage limit**: max executions per session (on-chain: UsageLimitPolicy), and max executions per rolling 24h (on-chain: `CorralRateLimitPolicy`, D26; also enforced off-chain by the scheduler as defense in depth) | **[MUST]** |
| FR-2.8 | Policy supports **action scope**: only actions in the closed DSL may be encoded | **[MUST]** |
| FR-2.9 | Policies are **immutable** for the life of a session. Changing a policy = revoke + create new | **[MUST]** |
| FR-2.10 | A policy encoder converts the `corral-core` policy object to on-chain module config, and a decoder reverses it; round-trip is property-tested | **[MUST]** |
| FR-2.11 | A **policy preflight** read function returns whether a given planned Action would be accepted, plus remaining budget per asset | **[MUST]** |
| FR-2.12 | Unbounded ERC-20 approvals are structurally impossible to encode: the encoder rejects them and a test asserts the rejection | **[MUST]** |
| FR-2.13 | USD-denominated budgets | **[LATER v1.1]** |
| FR-2.14 | Mutable / upgradeable policies | **[LATER v1.1]** |

**AC FR-2.2:** with a 500 USDC budget and 480 spent, an execution attempting 30 USDC **reverts on-chain**; the off-chain layer must not be the thing that stops it. Test asserts the revert reason.
**AC FR-2.5:** an execution with `recipient` set to any address other than the account reverts.
**AC FR-2.9:** there is no code path that mutates an installed session's policy. Verified by a Foundry test and a grep-based CI check.

### 7.3 Enforcement (doc §3.3)

| ID | Req | Priority |
|---|---|---|
| FR-3.1 | All policy checks execute on-chain during validation/execution; rejection is a revert | **[MUST]** |
| FR-3.2 | No alternative entry point permits execution outside policy: direct calls, executor modules, fallback, and delegatecall paths are covered by tests | **[MUST]** |
| FR-3.3 | Signature replay is impossible: session-scoped nonces, chain-id binding, per-execution nonce keys | **[MUST]** |
| FR-3.4 | `CorralJournal.log(intentHash, strategyId, sessionId, seq)` is appended to every execution batch and is itself a policy-whitelisted target | **[MUST]** |
| FR-3.5 | Journal call failure must not silently drop: a batch where the journal call reverts, reverts as a whole | **[MUST]** |
| FR-3.6 | Gas sponsorship (paymaster) cannot be used to bypass policy; sponsored ops undergo identical validation | **[MUST]** |
| FR-3.7 | Every approval issued by the agent is exact-amount and short-lived (Permit2 with ≤10 min expiry, or exact `approve` immediately consumed in the same batch) | **[MUST]** |

**AC FR-3.2:** a documented test matrix with one test per attack path, each asserting a revert. This matrix is the artifact the auditor will read first — write it before the code.

### 7.4 Execution Engine (doc §3.4)

| ID | Req | Priority |
|---|---|---|
| FR-4.1 | Interpret a natural-language intent into a typed `Plan`. LLM output is schema-validated; invalid output is rejected, never repaired by hand | **[MUST]** |
| FR-4.2 | LLM output **never** contains calldata, addresses not present in the policy, or raw amounts outside declared bounds | **[MUST]** |
| FR-4.3 | Deterministic compiler: `Plan → calldata`. Same plan + same chain state → identical bytes | **[MUST]** |
| FR-4.4 | Preflight gate: query on-chain policy state and simulate the bundle. Any failure aborts before signing | **[MUST]** |
| FR-4.5 | At-most-once execution: an idempotency key per (strategyId, scheduledFor) with a unique DB constraint, plus the on-chain usage-limit policy as backstop | **[MUST]** |
| FR-4.6 | Typed retry policy per error class (see §9); retries are bounded, jittered, and never retry a policy rejection | **[MUST]** |
| FR-4.7 | Plans exceeding sanity bounds (>25% of remaining budget in one action, or >N actions) require a preflight warning and are logged as anomalies | **[SHOULD]** |
| FR-4.8 | Full execution record persisted before submission and updated after: plan, calldata hash, intentHash, simulation result, tx hash, status | **[MUST]** |
| FR-4.9 | The engine can never widen policy; there is no code path from the engine to session installation | **[MUST]** |

**AC FR-4.3:** compiler property test — 10,000 randomly generated valid plans produce calldata that passes on-chain preflight; 10,000 invalid plans are rejected before compilation.
**AC FR-4.5:** chaos test — kill the process at 10 points in the execution lifecycle, 5 times each; assert zero duplicate on-chain executions and zero permanently stuck jobs.

### 7.5 Protocol Adapters (doc §3.5)

| ID | Req | Priority |
|---|---|---|
| FR-5.1 | `IProtocolAdapter` interface: `quote()`, `buildActions()`, `decodeResult()`, `describeForUser()` | **[MUST]** |
| FR-5.2 | Uniswap v3 adapter: `exactInputSingle` only, `recipient` pinned to account, `amountOutMinimum` derived from a quote with a policy-floored slippage tolerance | **[MUST]** |
| FR-5.3 | Adapters declare the policy constraints they require; a mismatch between adapter needs and session policy is a hard error at strategy-creation time, not at execution time | **[MUST]** |
| FR-5.4 | Adapters are pure: no signing, no network writes, no state | **[MUST]** |
| FR-5.5 | Aggregator adapter (0x/1inch) | **[LATER v1.1]** |
| FR-5.6 | Lending adapter | **[LATER v1.1]** |

### 7.6 Budget Accounting (doc §3.6)

| ID | Req | Priority |
|---|---|---|
| FR-6.1 | On-chain policy state is the single source of truth for remaining budget | **[MUST]** |
| FR-6.2 | Off-chain mirror is refreshed after every execution and by a reconciliation job every 15 minutes | **[MUST]** |
| FR-6.3 | Mirror drift beyond zero triggers an alert and pauses new plan creation for that session until reconciled | **[MUST]** |
| FR-6.4 | The UI always labels budget figures with their source and freshness ("on-chain, 12s ago") | **[SHOULD]** |
| FR-6.5 | Gas costs are accounted and displayed **separately** from the user's asset budget | **[MUST]** |

### 7.7 Event & Activity Log (doc §3.7)

| ID | Req | Priority |
|---|---|---|
| FR-7.1 | Canonical event schema (§10) shared by chain events, API and UI, defined once in `corral-core` | **[MUST]** |
| FR-7.2 | Every execution appears in the feed within 15s of inclusion | **[MUST]** |
| FR-7.3 | Feed entries include: action, assets, amounts in and out, effective price, slippage vs quote, venue, gas, status, tx link, intent that caused it | **[MUST]** |
| FR-7.4 | Failed and aborted attempts appear in the feed too, with plain-language cause | **[MUST]** |
| FR-7.5 | Export to CSV | **[SHOULD]** |
| FR-7.6 | Public verification view, no auth, by account address | **[SHOULD]** |

### 7.8 Owner Control (doc §3.8)

| ID | Req | Priority |
|---|---|---|
| FR-8.1 | Revoke: single owner transaction that disables the session and invalidates in-flight nonces | **[MUST]** |
| FR-8.2 | On revoke initiation, disable the off-chain signer immediately, before on-chain confirmation | **[MUST]** |
| FR-8.3 | Standalone revoke page: static, dependency-free, works with the Corral API and database entirely offline; documented in user docs | **[MUST]** |
| FR-8.4 | Revoke confirmation states exactly what revoke does not do: does not reverse executed transactions, does not move funds | **[MUST]** |
| FR-8.5 | Post-revoke, any agent execution attempt reverts on-chain and is recorded | **[MUST]** |
| FR-8.6 | Pause / resume | **[LATER v1.1]** |
| FR-8.7 | Policy update in place | **[LATER v1.1]** |

**AC FR-8.3:** tested by shutting down the API and database, then completing a revoke.

### 7.9 Strategy Layer (doc §3.9)

| ID | Req | Priority |
|---|---|---|
| FR-9.1 | Fixed-amount scheduled swap (DCA): amount, interval, source, target, end date | **[MUST]** |
| FR-9.2 | Percentage-of-balance swap | **[SHOULD]** |
| FR-9.3 | Price-conditional trigger, evaluated off-chain, enforced on-chain via `amountOutMinimum` | **[SHOULD]** |
| FR-9.4 | Strategies compile to Plans of primitive Actions; no strategy has a privileged execution path | **[MUST]** |
| FR-9.5 | Strategy lifecycle: `DRAFT → ACTIVE → (PAUSED) → COMPLETED / EXPIRED / REVOKED`, with legal transitions enforced in code | **[MUST]** |
| FR-9.6 | A strategy that cannot run under its session's policy is rejected at creation with a specific reason | **[MUST]** |
| FR-9.7 | Multi-step atomic strategies with rollback | **[LATER v2]** |
| FR-9.8 | Limit orders / partial fills | **[LATER v2]** |

### 7.10 Notifications (doc §3.10)

| ID | Req | Priority |
|---|---|---|
| FR-10.1 | Channels: email **[MUST]**, Telegram **[SHOULD]**, web push **[LATER]** | |
| FR-10.2 | Triggers: execution success (digest, not per-event), execution failure (immediate), budget 50/80/100% reached, session expiring in 72h, session expired, anomaly detected, revoke confirmed | **[MUST]** |
| FR-10.3 | Digest batching so a weekly DCA never generates more than one message per run | **[MUST]** |
| FR-10.4 | Every notification links to the specific execution and states whether action is needed | **[MUST]** |
| FR-10.5 | Notification delivery failure never blocks or delays execution | **[MUST]** |

### 7.11 Frontend requirements (the existing FE)

The FE is where the product's differentiation lives. Requirements are deliberately specific.

| ID | Req | Priority |
|---|---|---|
| FR-11.1 | **Policy review screen** shows a plain-language "worst case" block: maximum total spend per asset, permitted destinations, permitted venues, expiry date. Written at a 9th-grade reading level | **[MUST]** |
| FR-11.2 | **Policy diff view** when creating a new session that replaces an old one: what widened, what narrowed | **[SHOULD]** |
| FR-11.3 | **Budget meters** per asset: spent / remaining / committed-to-pending, with on-chain freshness indicator | **[MUST]** |
| FR-11.4 | **Kill switch** persistently reachable from every authenticated screen in ≤1 tap | **[MUST]** |
| FR-11.5 | **Plan preview**: before activating a strategy, show the first three executions it will attempt, with amounts | **[SHOULD]** |
| FR-11.6 | **Activity feed** per FR-7.3, with failures and aborts visually distinct from rejections | **[MUST]** |
| FR-11.7 | Empty, loading, stale, error, expired, revoked and paused states designed for every screen. No spinner-only states | **[MUST]** |
| FR-11.8 | Never display a raw revert string, hex selector, or unmapped error code to a user | **[MUST]** |
| FR-11.9 | Shared types imported from `@corral/core` (zod-derived); the FE must not hand-write or duplicate Policy, Action, or ExecutionStatus | **[MUST]** |
| FR-11.10 | Mobile-responsive down to 375px; kill switch and budget meters must work on mobile | **[SHOULD]** |
| FR-11.11 | Reads (feed, budgets) degrade gracefully to direct RPC if the Corral API is unavailable | **[SHOULD]** |

**AC FR-11.1:** usability test with 5 non-crypto-native participants; ≥4 correctly answer "what's the most this agent could spend?" and "could it send your money to a stranger?"

---

## 8. Policy schema (canonical — `@corral/core`, TypeScript)

> **v3 change (D20).** The canonical schema lives in the **`@corral/core` TypeScript package**, imported by the backend and the frontend from one source. Zod `.strict()` schemas are the single definition; TS types derive via `z.infer` and are never hand-written. The guarantee shown in the UI is rendered from the same `policySummary()` that validates what goes on-chain, so it cannot drift.

Chain-agnostic by construction: `@corral/core` has no I/O, no chain client, no environment access (CI-enforced by dependency-cruiser).

```ts
/// Base units only, as a branded bigint. No number, no float math, no
/// arithmetic operators — checkedAdd/checkedSub only: a silent overflow in a
/// spending limit is the worst bug this system can have.
type TokenAmount = bigint & { readonly __brand: "TokenAmount" };

/// Untrusted, straight off the wire (zod .strict() — unknown fields fail).
const RawPolicy = z.strictObject({
  version: z.number().int(),
  chainId: z.number().int(),
  assetScope: z.array(AssetRef),            // FR-2.1
  budgets: z.array(BudgetConstraint),       // FR-2.2 — cumulative, per asset
  maxNativeValue: TokenAmountSchema,        // FR-2.3
  targetScope: z.array(TargetConstraint),   // FR-2.4, FR-2.5
  actionScope: z.array(ActionKind),         // FR-2.8
  validAfter: z.number().int(),             // FR-2.6
  validUntil: z.number().int(),
  maxExecutions: z.number().int(),          // FR-2.7
  maxExecutionsPer24h: z.number().int(),
  minOutputBps: z.number().int(),
});

/// Constructible only via parsePolicy(raw) — schema parse + the six invariant
/// checks below. Everything downstream (session install, compiler, API, UI)
/// accepts ValidatedPolicy and never RawPolicy. TS's substitute for Rust's
/// TryFrom boundary: the constructor is not exported, only parsePolicy is.
declare function parsePolicy(raw: unknown): ValidatedPolicy; // throws PolicyError
```

**Invariants enforced at parse time**, each mapping to a requirement:

| Check | Requirement | Why it is structural rather than a runtime guard |
|---|---|---|
| Every in-scope asset has a budget | FR-2.1 + FR-2.2 | An asset in scope without a budget is an unbounded spend — the exact bug this product exists to prevent |
| Every swap target pins `recipient == account` | FR-2.5 | Budget caps bound theft; only the recipient pin prevents it |
| No unbounded approvals encodable | FR-2.12 | An infinite approval defeats both the budget and the expiry |
| `valid_until > valid_after` | FR-2.6 | |
| 24h cap ≤ total cap | FR-2.7 | |
| `min_output_bps` in 5000..=10000 | FR-9.3 | |

The `Action`/`Plan` DSL uses `z.strictObject` throughout: a model adding a helpful extra field fails parsing rather than passing something unmodelled into the compiler (FR-4.2).

### 8.1 Frontend consumption

```ts
import { parsePolicy, policySummary } from "@corral/core";

const summary = policySummary(parsePolicy(draft));
// summary.maxTotalSpend / permittedDestinations / expiresAt
```

FR-11.1's plain-language worst-case panel renders from `policySummary()`. That is a requirement, not an implementation preference: it is what guarantees the sentence shown to the user is derived from the same code that validates the on-chain configuration.

---

## 9. Error taxonomy

Required because "failure" in the source document is one word covering behaviours with opposite correct responses. Every failure maps to exactly one code; each code has a fixed retry rule and a fixed user-facing message.

| Code | Layer | Retry | User message |
|---|---|---|---|
| `POLICY_ASSET_NOT_IN_SCOPE` | Preflight | Never | "This agent isn't allowed to use that asset." |
| `POLICY_BUDGET_EXCEEDED` | Preflight/chain | Never | "Budget for {asset} is used up." |
| `POLICY_TARGET_NOT_ALLOWED` | Preflight/chain | Never | "This agent can only trade on {venue}." |
| `POLICY_PARAM_VIOLATION` | Chain | Never | "The planned action didn't meet your rules." |
| `POLICY_EXPIRED` | Preflight/chain | Never | "This agent's permission expired on {date}." |
| `POLICY_USAGE_LIMIT` | Chain | Backoff to next window | "Daily action limit reached." |
| `SESSION_REVOKED` | Chain | Never | "You revoked this agent." |
| `PLAN_INVALID_SCHEMA` | Planner | Never | "Couldn't build a valid plan; nothing was executed." |
| `PLAN_UNSAFE_BOUNDS` | Planner | Never | "Plan looked unusual and was blocked." |
| `SIMULATION_REVERT` | Preflight | 3× w/ fresh quote | "Trade would have failed; skipped this run." |
| `SLIPPAGE_EXCEEDED` | Chain | 3× w/ fresh quote | "Price moved too much; skipped this run." |
| `INSUFFICIENT_BALANCE` | Preflight | Next schedule | "Not enough {asset} in your account." |
| `GAS_SPONSOR_UNAVAILABLE` | Infra | 5× backoff | "Temporary network issue; will retry." |
| `RELAYER_TIMEOUT` | Infra | 5× backoff, idempotent | "Temporary network issue; will retry." |
| `NODE_UNAVAILABLE` | Infra | 5× backoff, RPC failover | "Temporary network issue; will retry." |
| `NONCE_CONFLICT` | Infra | Immediate w/ new nonce key | (silent) |
| `SIGNER_UNAVAILABLE` | Infra | 5× backoff, then page on-call | "Temporary issue; will retry." |
| `MIRROR_DRIFT` | Internal | Pause session, alert | "Paused for a safety check." |
| `MODULE_SET_CHANGED` | Security | Pause + page | "Paused: your account settings changed unexpectedly." |

**Rule:** policy rejections are *never* retried and are *never* worked around. A retry loop around a policy rejection is the failure mode that turns a safe system into an unsafe one.

---

## 10. Event schema (canonical)

Defined in `corral-core::events`, shared by the indexer, the API and the frontend via WASM.

```rust
pub enum ExecutionStatus {
    Planned, Simulated, Submitted, Included,
    Succeeded, Failed, Rejected, Aborted, Expired,
}

pub struct CorralEvent {
    pub id: Uuid,
    pub chain_id: u64,
    pub account: Address,
    pub session_id: B256,
    pub strategy_id: Option<B256>,
    pub intent_hash: B256,
    pub seq: u32,
    pub action_kind: ActionKind,
    pub assets_in:  Vec<(AssetRef, TokenAmount)>,
    pub assets_out: Vec<(AssetRef, TokenAmount)>,
    pub venue: Option<String>,
    pub quoted_out: Option<TokenAmount>,
    pub realised_out: Option<TokenAmount>,
    pub slippage_bps: Option<i32>,
    pub gas_paid: TokenAmount,
    pub gas_sponsored: bool,
    pub status: ExecutionStatus,
    pub error_code: Option<ErrorCode>,
    pub tx_hash: Option<B256>,
    pub block_number: Option<u64>,
    pub occurred_at: u64,
    pub budget_after: Vec<(AssetRef, TokenAmount)>,
}
```

This satisfies the source document's §3.7 and its §5 goal of a standardised cross-chain event schema. It must contain no EVM-specific types beyond the address, so an SVM implementation can populate it later — and because `corral-core` is Rust, a future Anchor program could share these types directly.

---

## 11. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Scheduled execution punctuality | 95% of runs submitted within 60s of schedule |
| NFR-2 | End-to-end execution latency (wake → included) | p50 <20s, p95 <90s on Base |
| NFR-3 | Revoke: off-chain signer disabled | <1s from user confirmation |
| NFR-4 | Revoke: on-chain effective | Next block after inclusion (~2s) |
| NFR-4a | **Revoke: pending submissions drained** | **<1s.** Own relayer ⇒ no signed op sits in a mempool we don't control (v2) |
| NFR-5 | Activity feed freshness | <15s after inclusion |
| NFR-6 | Scheduler availability | 99.5% monthly; a missed run is skipped-and-notified, never silently dropped |
| NFR-7 | Execution correctness | Zero double-executions against a single budget. Non-negotiable. |
| NFR-8 | Cost per execution (gas, sponsored) | <$0.05 on Base |
| NFR-9 | **Infrastructure cost** | **<$600/mo at up to 1,000 active sessions** (managed posture: Supabase + app hosting + commercial RPC + KMS; D19) |
| NFR-10 | Data retention | Executions indefinite; planner traces 90 days |
| NFR-11 | Accessibility | WCAG 2.1 AA on policy review, budget and kill-switch screens |
| NFR-12 | **Frontend bundle impact of `@corral/core`** | **<150KB gzipped added** (pure TS, no WASM payload; measure at FE integration) |
| NFR-13 | **Database durability** | Supabase PITR enabled and restore drilled quarterly. RPO <5 min, RTO <2h. The DB is a mirror — chain state is authoritative for money |
| NFR-14 | **RPC availability** | ≥2 commercial providers behind automatic failover; alert when primary >20 blocks behind head (D19 — no own nodes) |
| NFR-15 | **Signer availability** | KMS multi-region; on outage executions queue and retry — they never bypass |

---

## 12. Security & compliance requirements

| ID | Requirement |
|---|---|
| SEC-1 | No private key material in application code, environment variables, logs, or the database. Signing exclusively via the KMS-backed `corral-signer` service (SEC-13). |
| SEC-2 | One session signer per user account. A single signer compromise must not affect other users. |
| SEC-3 | The entire off-chain runtime — including infrastructure we own and operate — is treated as untrusted in the threat model; a full compromise must be bounded by policy alone. Documented and tested. |
| SEC-4 | LLM inputs and outputs are treated as untrusted. Prompt-injection tests are part of CI: a corpus of adversarial intents must produce zero policy-violating plans and zero submissions. |
| SEC-5 | All contract deployments verified on the block explorer with published source and reproducible builds. |
| SEC-6 | External audit of all custom Solidity plus the policy-composition configuration before mainnet with user funds. All critical/high findings closed and re-reviewed. |
| SEC-7 | Bug bounty live at launch. |
| SEC-8 | Secrets rotation runbook; quarterly rotation; break-glass procedure documented. |
| SEC-9 | Anomaly detection: unusual execution frequency, unusual size relative to budget, module-set change, repeated policy rejections → alert + auto-pause. |
| SEC-10 | Incident response: named on-call, pre-drafted user comms, a rehearsed global pause, and a public post-mortem commitment. |
| SEC-11 | **Legal review required before launch** on: (a) whether delegated execution constitutes custody in target jurisdictions, (b) whether strategy templates constitute investment advice, (c) money-transmission exposure, (d) MiCA/geographic restrictions. Product copy must not promise returns or describe Corral as managing, advising on, or optimising a portfolio. |
| SEC-12 | Publish the bounded revocation guarantee (feasibility doc §6) rather than an "instant" claim. Overstating the guarantee is both a trust and a legal risk. |
| SEC-13 | **Key custody is ours (v3: D23).** Mainnet signing keys live in KMS/HSM (secp256k1) and are never exported; the signer module is the only component permitted to hold KMS credentials. The testnet-only encrypted-at-rest key model inherited from Coral is a launch blocker until replaced. Rotation quarterly; break-glass documented and rehearsed. |
| SEC-14 | **The signer independently refuses to sign for a revoked or expired session**, regardless of caller. This replaces the defence-in-depth previously provided by a custody vendor's policy engine. |
| SEC-15 | **Session-configuration correctness is a release gate (v3: D22).** Session encoding uses the reference TypeScript SmartSessions SDK, pinned by exact version and lockfile integrity; an SDK upgrade is a security-reviewed change, never a routine bump. Every installed session is read back from chain, decoded and compared against the signed policy before being marked ACTIVE; a mismatch pauses and pages. The on-chain violation matrix must pass on every commit. |
| SEC-16 | **The relayer cannot widen policy.** It receives signed userOps and submits them. Its key is hot and holds gas only; the blast radius of its compromise is gas theft, not user funds. |
| SEC-17 | **Self-hosting confers no additional trust.** Our servers remain in the untrusted zone of the threat model. Any argument of the form "it's safe because it's on our own infrastructure" is rejected in review. |
| SEC-18 | **Do not claim censorship resistance.** Base uses a centralised sequencer; running our own nodes does not change that. Marketing and product copy must not imply otherwise (feasibility §1.2). |

---

## 13. Success metrics

| Metric | Launch target (30 days post-launch) |
|---|---|
| Sessions created | 100 |
| Autonomous executions completed | 1,000 |
| Executions requiring user interaction | <5% |
| Policy violations that reached the chain and were rejected there | 100% of attempts (this number being non-zero is *good* — it means enforcement is real and observed) |
| Policy violations that succeeded | **0** |
| Successful revocations | 100% of attempts, all within SLO |
| Median session budget | Reported, not targeted (trust indicator) |
| Support tickets asking "what can my agent do?" | <5% of active users (a proxy for FR-11.1 quality) |
| Unplanned pauses caused by mirror drift | <1% of executions |

---

## 14. Release plan

| Stage | Gate | Population | Caps |
|---|---|---|---|
| Internal alpha (wk 8) | G1′ | Team only | Testnet |
| Testnet beta (wk 17–18) | G2, G3 | 20–50 invited | Testnet, uncapped |
| Guarded mainnet (wk 20) | G4, G5 | Allowlist, ~100 users | $500/account, $25k global |
| Open beta (wk 22+) | 30 days clean | Public | $5,000/account |
| GA | 90 days clean + bounty findings closed | Public | Policy-limited only |

---

## 15. Open questions (owner + needed-by)

Resolved since v1: chain (Base), backend language (Rust), infrastructure posture (self-hosted, Tier 3), custody (own KMS-backed signer), submission (own relayer).

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | ~~Is the infra/SRE engineer hired or assigned?~~ **Resolved by D19 (1 Aug 2026):** managed posture (Supabase/hosted services) removes the dedicated-infra-owner requirement; on-call for the services we run is still needed (Q10 stands) | — | Closed |
| Q2 | ~~Confirm the existing frontend stack, and whether it currently contains any policy or execution logic~~ **Resolved (31 Jul 2026, stakeholder):** the FE is ready and is not expected to be an issue. On import into `apps/web`, verify it contains no hand-written Policy/Action/ExecutionStatus types (FR-11.9) before wiring the WASM core (C-801) | FE dev | ~~Wk 1~~ Done |
| Q3 | KMS provider and region strategy (AWS vs GCP; secp256k1 support required); multi-region replication plan. **Direction fixed by D23 (KMS before mainnet); provider choice still open** | BE | Before mainnet-prep epic |
| Q4 | Audit budget and tier confirmed, so the week-16 slot can be booked in week 5 | Founder | Wk 2 |
| Q5 | Legal posture on custody and advice — note that operating our own signing infrastructure may change the custody analysis versus using a regulated vendor. Raise this with counsel explicitly | Founder + counsel | **Wk 2** |
| Q6 | ~~Hosting: bare metal, dedicated cloud, or colo?~~ **Resolved by D19:** managed hosting (Render/Vercel-class + Supabase), as Coral runs today | — | Closed |
| Q7 | Gas sponsorship: indefinite, or passed through after beta? | Product | Wk 10 |
| Q8 | ~~L1 endpoint for `op-node`?~~ **Moot under D19:** no own Base nodes; commercial RPC with multi-provider failover permanently | — | Closed |
| Q9 | Do we support a user's existing Safe, or only Corral-deployed accounts? Existing accounts carry an unknown module set — a real security consideration | SOL | Wk 4 |
| Q10 | On-call: who, what rota, what escalation? Self-hosting means there is no vendor to page | Founder + INF | Wk 14 |
| Q11 | Target geography and geo-fencing | Founder | Wk 14 |
| Q12 | Is "Corral" cleared for trademark in the relevant classes? | Founder | Wk 12 |

**Q1 and Q5 are the two that can move the whole plan.** Q1 sets the timeline; Q5 could change the architecture if counsel takes the view that operating our own keys alters the custody analysis in a target jurisdiction.

**A note carried over from v1 and still true:** v1's strategies (fixed DCA, percentage swaps, price triggers) are fully expressible without an LLM. The design keeps the model at *authoring* time with a human in the loop, and uses deterministic code at *execution* time with no human. That split means prompt injection cannot cause an unattended execution, and it costs nothing in v1 capability.
