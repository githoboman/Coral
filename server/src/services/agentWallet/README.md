# Autonomous Agent Wallet

An on-chain–constrained agent that executes DeepBook V3 actions (swaps, limit
orders, cancellations) on Sui **without per-action human approval**, inside limits
the owner sets once. Built on Tovira's intent engine for Sui Overflow 2026.

## Why it's safe

The agent signs its own transactions, but it cannot exceed its mandate. Every
constraint lives in a **shared Move policy object** that the agent must reference in
each transaction. The contract validates the action and records spend atomically; a
violation aborts the whole transaction. The off-chain layer adds a fast pre-flight
check purely to save gas — it is never the thing standing between the agent and your
funds. That guarantee is the Move contract.

The owner can **pause** or **revoke** at any time. Revocation destroys the agent's
authority object, after which the agent's next transaction fails on-chain.

> Key custody and the policy-engine internals are intentionally not documented here.

## Architecture

```
Owner (connected wallet)                Agent (server-controlled wallet)
        │                                          │
        │ create policy (budget, scope, expiry)    │
        ▼                                          ▼
  ┌───────────────────────────────────────────────────────┐
  │            AgentPolicy  (shared Move object)            │
  │  budget · protocol whitelist · asset scope · expiry    │
  │  is_active · validate_action() · record_spend()        │
  └───────────────────────────────────────────────────────┘
        ▲                                          │
   pause / revoke                          guarded PTB per action:
        │                          validate → DeepBook call → record → log
        │                                          ▼
        │                                   DeepBook V3 (testnet)
        │                                          │
        └───────── on-chain events ◄───── settle ──┘──► Walrus receipt (additive)
```

### Pipeline (per intent)

1. Parse intent → action + params
2. **Off-chain pre-flight** — fast reject on obviously invalid intents
3. Build a single PTB: `validate_action` → DeepBook moveCall → `record_spend` → `log_action`
4. Sign with the **agent** key (not the user's wallet) and submit
5. Settle → on-chain `AgentActionEvent` emitted → in-app alert → Walrus receipt

Dual enforcement: the pre-flight is an optimization; the on-chain checks are the
guarantee. Both run.

## Modules

| File | Role |
|------|------|
| `init.ts`, `store.ts`, `keypair.ts` | Agent wallet lifecycle + encrypted custody |
| `config.ts` | Package/object ids, asset type strings, Sui client |
| `policyChecker.ts` | Off-chain pre-flight (reads the on-chain policy) |
| `budgetTracker.ts` | Soft budget incl. pending allocations |
| `ptbBuilder.ts` | Wraps each action in the policy guard |
| `executor.ts` | Signs with the agent key, submits, dry-runs |
| `deepbookClient.ts` | DeepBook V3 reads + transaction fragments |
| `swapAgent.ts` | Market swaps + limit orders, end to end |
| `orderManager.ts` | Open-order tracking, partial fills, cancellation |
| `strategies.ts` | Percentage swaps, scheduled actions, conditional orders |
| `owner/` | Policy creation, pause/resume, two-step revocation |
| `alerts.ts` | In-app notification feed |
| `walrusArchiver.ts` | Post-settlement intent receipts (additive) |

The Move package lives in `contract/agent_policy/` (`policy`, `capability`,
`events` modules) with full constraint tests.

## Setup

1. Publish the Move package:
   ```
   sui client publish ./contract/agent_policy
   ```
   Set `AGENT_POLICY_PACKAGE_ID` to the published package id.
2. Set `DEEPBOOK_PACKAGE_ID` (DeepBook V3 testnet), `ENCRYPTION_MASTER_KEY`,
   and the Walrus URLs. See `.env.example`.
3. Apply the migration in `migrations/001_agent_wallets.sql` (optional; without it
   the wallet store runs in-memory).

> **Testnet liquidity is thin.** Self-seed a SUI/USDC DeepBook pool before a demo,
> or trade an amount guaranteed to fill.

## Revocation (two steps)

Destroying the capability and cleaning up the agent's funds require different
signers, so revocation is two sequenced atomic steps:

1. **Agent-signed** — cancel all open orders + sweep funds back to the owner.
2. **Owner-signed** — `revoke()` destroys the capability and deactivates the policy.

After step 2 the agent's next action aborts on-chain (capability not found).

## Demo flow

1. Owner creates a policy: budget, DeepBook only, SUI+USDC, 24h expiry.
2. Agent wallet initialized, capability delegated.
3. "swap 100 SUI to USDC" → validated → executed on DeepBook → event + receipt.
4. "place limit order to buy SUI at 0.20 USDC" → validated → order placed.
5. Owner clicks **Revoke** → cleanup+sweep, then capability destroyed.
6. "swap 50 SUI to USDC" → **aborts on-chain** → UI shows "Agent revoked".
7. On-chain event log shows every action, fully traceable.
