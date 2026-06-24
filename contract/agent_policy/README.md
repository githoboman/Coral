# Autonomous Agent Wallet — Implementation vs. PRD

A point-by-point map of the **Product Requirements Document** to what is **built in
this repo**, with file locations and verification status.

> **Legend:** ✅ Done & verified · 🟡 Built, needs live testnet to demo · ⛓️ Needs
> chain/funds (not code)

**Verified state:** 17/17 Move contract tests · 28/28 backend tests · server & app
typecheck clean.

### 🟢 LIVE ON TESTNET

The package is **published and proven on-chain** — `create_and_delegate` was executed
live, creating a shared `AgentPolicy` and an owned `AgentCapability` exactly as designed.

| Object | ID |
|---|---|
| `agent_policy` package | `0x2192e9f75e83d8d3814a34bf62a087950f64d053008067a7e1dc0b521aa49cc3` |
| UpgradeCap | `0x627b8e7561c09969210b3d1b0c43b11e84ece089b0ff9f8d9108f051943af363` |
| DeepBook V3 (testnet) | `0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c` |
| Example AgentPolicy (smoke test, shared) | `0xbe3b17c9a0b634064e7568c7b04ab7d8cc84e7cb1ce8c6b67538688df62892bf` |
| Example AgentCapability (smoke test) | `0x41ddcb94b834a40fcb419708cf22ff9be68a99ae2acefe01f779c63cb4c84fad` |

These are wired into `server/.env` (`AGENT_POLICY_PACKAGE_ID`, `DEEPBOOK_PACKAGE_ID`).

### ✅ Live demo proof (real testnet transactions)

The full PRD-critical flow has been executed end-to-end on testnet — **no mocks**:

| Step | Result | Tx digest |
|---|---|---|
| Create policy (shared object + capability) | ✅ success | `0xbe3b17c9…` (policy object) |
| **Agent market swap 1 SUI → DBUSDC** on real DeepBook pool | ✅ success | `jZ6NhJfFNMPoweB1bPL9gAvcgTYphv6m5hgHFBZ9yFM` |
| **Owner revoke** (destroys capability, emits `PolicyRevoked`) | ✅ success | `FzUfzWZMPTgZDnPHVoBvZXn7BubGhUBUc3Jp2EGF78yQ` |
| **Agent action after revoke** | ✅ **blocked on-chain** (`object deleted`) | — |

Pool used: `SUI_DBUSDC` `0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5`
(mid ~0.749, minSize 1 SUI) — an existing DeepBook testnet pool, no self-seeding needed.

Reproduce with the standalone scripts (no server/db needed), driven by `AGENT_DEMO_KEY`:
`src/scripts/agent{PoolCheck,DeepbookDemo,LiveSwap,RevokeDemo}.ts`.

> **SDK note:** `@mysten/deepbook-v3` is pinned to `^0.23.2` (not 1.x) because 1.x
> requires `@mysten/sui` v2, while the rest of the server is on sui `^1.45`. 0.23.2 is
> the newest DeepBook SDK on the sui-v1 line.

---

## Objective

> Enable an AI agent to autonomously execute on-chain actions within strictly enforced
> constraints (budget, protocol scope, time), without requiring per-action human approval.

✅ **Met.** The agent signs and submits with its own server-held Ed25519 key. Every
action is wrapped on-chain as `validate_action → trade → record_spend → log_action` in a
single atomic transaction. If any constraint fails, the whole transaction aborts — no
human approval needed, no bypass possible.

---

## 1. Agent Wallet Initialization

| PRD | Status | Where |
|---|---|---|
| Create agent-controlled wallet (zkLogin **or** Move policy object) | ✅ | Move policy object path chosen (zkLogin noted as mainnet path). `server/src/services/agentWallet/keypair.ts`, `init.ts` |
| Bind wallet to owner address | ✅ | `init.ts` → `AgentWalletRecord.ownerAddress`; on-chain `AgentPolicy.owner` |
| Bind wallet to policy constraints | ✅ | `init.ts:bindToPolicy()` + on-chain `AgentCapability` links agent → policy |

Agent key is generated server-side, **encrypted at rest** (AES-256-GCM via
`EncryptionService`), and persisted in Supabase (`agent_wallets`), with an in-memory
fallback in no-database mode. The agent wallet is
**separate** from the user's connected wallet.

---

## 2. Policy Engine (On-Chain)

**`contract/agent_policy/sources/policy.move`** — `AgentPolicy` is a **shared** Move
object (sequenced access → race-free budget enforcement).

| PRD constraint | Status | Detail |
|---|---|---|
| **Budget Cap** — max spend, track cumulative, reject over-spend | ✅ | `budget_cap` / `budget_spent`; `record_spend()` aborts atomically if exceeded |
| **Protocol Scope** — whitelisted contracts (DeepBook only) | ✅ | `allowed_protocols`; `validate_action` aborts on non-whitelisted protocol |
| **Asset Scope** — allowed tokens (SUI, USDC) | ✅ | `allowed_assets`; enforced for value-moving actions |
| **Time Constraint** — expiry timestamp, disable after | ✅ | `expiry_timestamp` checked against on-chain `Clock` (`0x6`) |
| **Action Types** — swap / limit order / cancel | ✅ | `allowed_actions` (0=swap, 1=limit, 2=cancel) |

All checks are **AND** logic — every field must pass or the transaction aborts (`assert!`,
not boolean return).

---

## 3. Execution Engine (Agent)

| PRD | Status | Where |
|---|---|---|
| Receive user intent (e.g. "swap 30% SUI to USDC") | ✅ | `strategies.ts`, `swapAgent.ts` |
| Translate into executable transactions | ✅ | `ptbBuilder.ts` composes the guarded PTB |
| Sign & submit via agent wallet | ✅ | `executor.ts` signs with the agent key |
| Query on-chain policy **before** execution | ✅ | `policyChecker.ts` off-chain pre-flight (gas-saving) |
| Respect all constraints without exception | ✅ | On-chain `validate_action` is the authoritative guarantee |

**Dual enforcement:** off-chain pre-flight rejects obvious violations cheaply; the
on-chain contract is the hard, unbypassable check. Both run.

---

## 4. DeepBook Integration (Required)

| PRD | Status | Where |
|---|---|---|
| Market orders | ✅ | `deepbookClient.ts`, `swapAgent.ts` |
| Limit orders | ✅ | `swapAgent.ts` (price-based) |
| Price-based execution | ✅ | `strategies.ts:watchPriceCondition` |
| Time-based execution | ✅ | On-chain Clock gate `validate_action_after` + `strategies.ts:scheduleSwap` |
| Partial fills | ✅ | `orderManager.ts` tracks filled vs total |
| Order cancellation (manual + automatic) | ✅ | `orderManager.ts`; auto-cancel on revoke |

⛓️ **Live demo needs:** real `DEEPBOOK_PACKAGE_ID`, a seeded SUI/USDC testnet pool, and a
bootstrapped agent BalanceManager (`deepbookSetup.ts`).

---

## 5. Budget Enforcement (Self + On-Chain)

| PRD | Status | Where |
|---|---|---|
| Agent tracks remaining budget | ✅ | `budgetTracker.ts` |
| Agent tracks allocated vs spent | ✅ | `budgetTracker.ts` (pending-order allocations) |
| On-chain hard rejection if exceeded | ✅ | `policy.move:record_spend()` aborts |
| No bypass path | ✅ | Shared object sequences concurrent txs; second over-cap tx aborts |

The classic double-spend race (two txs reading the same `budget_spent`) is covered by a
dedicated Move test and a TS test.

---

## 6. On-Chain Activity Log

| PRD | Status | Where |
|---|---|---|
| Structured event per action (type, amount, pair, timestamp, status) | ✅ | `events.move:AgentActionEvent` via `event::emit` |
| Queryable on-chain | ✅ | Via `suix_queryEvents` filtered on `policy_id` |

Separate from Walrus archiving — events are the live on-chain feed (PRD requirement);
Walrus is our additive deep-archive.

---

## 7. Owner Controls

| PRD | Status | Where |
|---|---|---|
| **a. Policy creation** (budget, protocol scope, expiry) | ✅ | `owner/policyCreator.ts` + UI form in `AgentControls.tsx` |
| **b. Revocation** (disable wallet / invalidate policy) | ✅ | `owner/revocation.ts` — **two-step**: agent-signed cleanup+sweep, then owner-signed `revoke()` destroys the capability |
| Post-revocation: agent txs fail on-chain | ✅ | Destroyed `AgentCapability` → any agent PTB aborts on object-not-found |
| **c. Pause / resume** | ✅ | `owner/pauseResume.ts`; on-chain `is_active` flag |
| **c. Update policy** | 🟡 | Constraints are immutable by design except `is_active`/`budget_spent`; documented decision |

> **Why two-step revocation:** destroying the capability (owner-signed) and sweeping the
> agent's funds (agent-signed) require different signers, so Sui can't atomically do both
> in one transaction. They're sequenced; the demo still shows "revoke → agent fails."

---

## 8. Strategy Execution Features

| PRD | Status | Where |
|---|---|---|
| Fixed-amount swaps | ✅ | `swapAgent.ts` |
| Percentage-based swaps (30% SUI → USDC) | ✅ | `strategies.ts:executePercentageSwap` (uses agent wallet balance) |
| Scheduled actions (execute at time) | ✅ | `strategies.ts:scheduleSwap` + on-chain Clock gate |
| Conditional / price-triggered orders | ✅ | `strategies.ts:watchPriceCondition` (DeepBook mid-price polling) |
| Time-expiry orders | ✅ | Policy `expiry_timestamp` + order TTL |

---

## 9. Notification Layer (Off-Chain)

| PRD | Status | Where |
|---|---|---|
| Order not filled in window | ✅ | `alerts.ts` |
| Order about to expire | ✅ | `alerts.ts` |
| Budget nearly exhausted (80%) | ✅ | `alerts.ts:evaluatePolicy` |
| Channels: web / push / email | 🟡 | In-app web feed built (`GET /api/agent/alerts` + UI). Telegram/email are stretch goals |

---

## Non-Negotiable Requirements

| Requirement | Status |
|---|---|
| Real DeepBook transactions (no mocks) | ✅ **Live swap executed** (`jZ6NhJf…`) on real SUI_DBUSDC pool |
| Enforced budget ceiling on-chain | ✅ `record_spend()` aborts |
| Strict protocol whitelisting | ✅ `validate_action` aborts |
| On-chain activity logs for all actions | ✅ `AgentActionEvent` |
| Owner revocation fully functional & testable | ✅ **Proven live** (`FzUfzW…`) — agent blocked on-chain after revoke |

---

## Success Criteria

| Criterion | Status |
|---|---|
| Agent executes trades autonomously within constraints | ✅ **Live swap on testnet** (`jZ6NhJf…`) |
| Any violation attempt fails at contract level | ✅ Proven by 17/17 Move tests + live revoke block |
| Full traceability via on-chain logs | ✅ Events emitted per action |
| Owner can instantly revoke with guaranteed effect | ✅ **Proven live** — agent action failed `object deleted` |

---

## What's left before the live demo (chain/funds, not code)

1. Publish the Move package to testnet → set `AGENT_POLICY_PACKAGE_ID`
2. Get the real `DEEPBOOK_PACKAGE_ID` (testnet)
3. Self-seed a SUI/USDC pool (testnet liquidity is thin — budget ~30 min)
4. Run the bootstrap endpoint to create the agent's BalanceManager
5. Mount `<AgentControls />` in a page (placement is the team's call)
6. Live demo: create policy → trade → revoke → agent's next trade fails on-chain

## Verify it yourself

```bash
# Smart-contract tests (17/17)
sui move test --path contract/agent_policy

# Backend tests (28/28)
cd server && npm test

# Typechecks (both clean)
cd server && npx tsc --noEmit
cd app && npx tsc --noEmit
```

## Layout

```
contract/agent_policy/         Move package — policy, capability, events + tests
server/src/services/agentWallet/   keypair, store, init, policyChecker, budgetTracker,
                                   ptbBuilder, executor, deepbookClient, swapAgent,
                                   orderManager, strategies, alerts, walrusArchiver
server/src/routes/agentWallet.ts   /api/agent/* endpoints
app/src/hooks/useAgentWallet.ts    frontend hook (dapp-kit owner signing)
app/src/components/agent/AgentControls.tsx   owner control panel
```
