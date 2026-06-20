# Tovira Autonomous Agent Wallet — Dev Briefing

## What we built (one sentence)
An AI agent that executes real DeepBook V3 trades on Sui **without per-action
approval**, but can only act inside limits the user sets once — and those limits are
enforced **on-chain**, so even if our server key were compromised, it cannot overspend
or act outside scope.

## Status: code-complete & verified — not yet live on testnet
- ✅ **17/17** Move (smart contract) tests pass
- ✅ **28/28** backend tests pass
- ✅ Backend and frontend both typecheck clean
- ❌ Nothing has run on live testnet yet (needs publishing + funds)

---

## 1. Smart contracts — `contract/agent_policy/`
The core safety layer and the most complete part.

| File | What it does |
|---|---|
| `sources/policy.move` | `AgentPolicy`: a **shared** on-chain object holding the rules — budget cap, allowed protocols/assets, expiry, active/paused. Validates every action and **aborts the transaction** if any rule is broken. Also has a Clock time-gate for scheduled actions. |
| `sources/capability.move` | `AgentCapability`: the agent's permission slip. Revoking = destroying it; afterward the agent's transactions fail on-chain. |
| `sources/events.move` | Emits a structured on-chain event for every agent action (the audit log). |
| `tests/` | Coverage for budget overflow, expiry, whitelist violations, revocation, the double-spend race, and time-gating. |

**Affects Tovira:** This is the trust foundation. It lets us claim the agent is *safe*
because the guarantee is enforced by the chain, not by trusting our backend.
Self-contained — no dependency on the existing `tovira_points` contract.

## 2. Backend engine — `server/src/services/agentWallet/`
~18 new files. Turns a user request into a safe, signed trade.

- **Wallet** (`keypair`, `store`, `init`): generates the agent key, stores it encrypted
  (reuses Tovira's existing `EncryptionService`), persists to Supabase (`agent_wallets`).
- **Engine** (`policyChecker`, `budgetTracker`, `ptbBuilder`, `executor`): off-chain
  pre-flight → builds a transaction wrapped in policy guards → signs with the agent key
  → submits. Every action runs as `validate → trade → record_spend → log` in one atomic tx.
- **DeepBook** (`deepbookClient`, `swapAgent`, `orderManager`, `deepbookSetup`): market
  swaps, limit orders, order/fill tracking, cancellation, BalanceManager bootstrap.
- **Strategies** (`strategies`): percentage swaps, scheduled swaps (Clock-enforced),
  conditional price-triggered orders.
- **Owner controls** (`owner/`): create policy, pause/resume, two-step revoke.
- **Observability** (`alerts`, `walrusArchiver`): in-app alert feed + trade receipts
  archived to Walrus.

**Affects Tovira:** Entirely **additive** — a new folder that touches none of the
existing chat/points/research code. Reuses the same Sui client, encryption, and Supabase
patterns the codebase already uses.

## 3. API — `server/src/routes/agentWallet.ts`
New endpoints under `/api/agent/*`: init, wallet status, create-policy, bind,
pause, resume, revoke, swap, schedule, DeepBook bootstrap, alerts. Registered with a
single line added to `routes/index.ts`.

**Affects Tovira:** Adds new routes, changes no existing ones. Owner actions return an
**unsigned transaction** the user signs in their own wallet (dapp-kit); agent actions
run server-side. Matches how Tovira already handles wallet signing.

## 4. Frontend — `app/src/`
- `hooks/useAgentWallet.ts`: calls the API, signs owner transactions with the connected
  wallet.
- `components/agent/AgentControls.tsx`: the UI panel — policy form, pause/resume, revoke
  button, live alert feed.

**Affects Tovira:** New hook + component, nothing else touched.
⚠️ **Open item:** the panel is built but **not yet placed in any page**. A dev needs to
drop `<AgentControls />` into a screen (Dashboard or a new tab). 1-line placement +
a product decision on where it lives.

---

## Changed vs. new (for PR review)
- **Modified (minimal):** `server/src/routes/index.ts` (+route), `server/.env.example`
  (new vars), `server/package.json` (added `@mysten/deepbook-v3` + test scripts), lockfiles.
- **New files:** everything in `contract/agent_policy/`, `server/src/services/agentWallet/`,
  `server/src/routes/agentWallet.ts`, and `app/src/.../agent/` + `useAgentWallet.ts`.

## Important context to share honestly
The original spec (`CLAUDE.md`) assumed Tovira already had a swap engine, DeepBook
integration, and intent parser ("exist, don't rebuild"). **They were not in the repo.**
So we built the trading foundation from scratch, not just the wallet layer on top. That's
why this was more work than the spec implied, and why some spec items ("expand existing
swaps") became "build swaps."

## Key design decisions
- **Move contract has no DeepBook dependency** — the backend composes the policy checks
  and DeepBook calls into one atomic transaction. Keeps the contract simple and its build
  reliable.
- **Two-step revocation** — destroying the capability (owner-signed) and sweeping the
  agent's funds (agent-signed) need different signers, so Sui can't do both in one atomic
  transaction. We sequence them; the demo still shows "revoke → agent fails."
- **Dual enforcement** — an off-chain pre-flight check saves gas on obviously-invalid
  requests; the on-chain contract is the authoritative guarantee. Both run.

## What's left before a live demo (needs funds/access — not code)
1. Publish the Move package to testnet → set `AGENT_POLICY_PACKAGE_ID`
2. Get the real DeepBook testnet package ID → set `DEEPBOOK_PACKAGE_ID`
3. Seed a SUI/USDC pool (testnet liquidity is thin — spec budgets ~30 min)
4. Run the bootstrap endpoint to create the agent's BalanceManager
5. Mount `<AgentControls />` in a page
6. Live demo: create policy → trade → revoke → agent's next trade fails on-chain

## Verification commands (for the team)
- Smart contract tests: `sui move test --path contract/agent_policy`
- Backend tests: `cd server && npm test`
- Backend typecheck: `cd server && npx tsc --noEmit`
- Frontend typecheck: `cd app && npx tsc --noEmit`
