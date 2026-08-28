# Corral — Operations

**Tickets:** I-506, I-601–I-606, I-204 · **Version:** 1.0 (28 Aug 2026, managed posture per D19)

Scoped to what we actually run. D19 chose a managed posture — Supabase, hosted app tier, commercial RPC — so there are no node runbooks and no failover drills for hardware we do not own. What remains is small enough to rehearse, which is the point.

**The rule that governs every procedure here:** when in doubt, **pause**. Corral cannot move a user's funds and cannot widen a policy, so the worst outcome of pausing wrongly is a missed trade. The worst outcome of continuing wrongly is spending a budget against a state we did not understand.

---

## 1. Deployment topology

```
┌────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
│  app (Vercel)  │──▶│  api  (Render web)   │──▶│  Supabase Postgres    │
│  Vite + React  │   │  Express, read-only  │   │  (mirror, never       │
└────────────────┘   │  toward the signer   │   │   authoritative)      │
                     └──────────────────────┘   └───────────▲───────────┘
                                                            │
                     ┌──────────────────────┐               │
                     │  engine (Render      │───────────────┘
                     │  worker, separate    │
                     │  process)            │──▶ KMS ──▶ Base (own relayer)
                     └──────────────────────┘
```

### The engine runs in its own process. This is not optional.

Testing the Corral routes against the full inherited app fails without `GOOGLE_API_KEY`, because the chat routes construct an LLM client at import time. That is a symptom, not the problem. The rule from CLAUDE.md §8.4 is that Corral execution paths must not depend on the gamification and chat modules, and **a compromise of those modules must not reach the signer**.

Enforcing that at the process boundary makes it structural instead of aspirational: the engine process imports `services/corral/**` and `services/evm/**` and nothing from `services/chatService`, `pointsService`, `referralService`, or `telegramService` except through the lazy notification adapters.

| Process | Runs | Holds | Must never import |
|---|---|---|---|
| `api` | Express routes | Session cookie secret | Signer credentials |
| `engine` | Worker loop, scheduler, safety sweeps, relayer | KMS credentials, relayer key | Chat, points, referrals, badge, leaderboard |
| `app` | Static bundle | Nothing | — |

### Environment

| Variable | Process | Notes |
|---|---|---|
| `DATABASE_URL` | api, engine | Supabase **session pooler** URI. The direct host is IPv6-only on new projects |
| `DATABASE_SCHEMA` | tests only | Never set in production |
| `EVM_RPC_URLS` | engine | Comma-separated, preference order. **Never logged** — these embed API keys |
| `CORRAL_ENGINE` | engine | `true`. Absent ⇒ the server boots with the engine off |
| `RELAYER_MAX_FEE_WEI` | engine | Gas ceiling. Past it we stop and page rather than escalate |
| `APP_BASE_URL` | engine | Used in notification links |
| KMS credentials | engine | **Signer module only** (SEC-13) |

---

## 2. Alerts

Spec §11.4, scoped to the managed posture. Every alert names the runbook that answers it.

| # | Alert | Threshold | Severity | Runbook |
|---|---|---|---|---|
| A1 | **Post-install verification mismatch** | Any | **Page** | R1 |
| A2 | **Budget mirror drift** | Any non-zero | **Page** | R2 |
| A3 | **Module set changed** | Any | **Page** | R3 |
| A4 | Relayer head-of-line nonce unchanged | >5 min | **Page** | R4 |
| A5 | Signer refusals | >10 in 5 min | **Page** | R5 |
| A6 | Anomaly auto-pause | Any | Ticket | R6 |
| A7 | Queue depth | >100 pending, or oldest >15 min | Ticket | R7 |
| A8 | Executions stranded in SUBMITTED | >5 | Ticket | R8 |
| A9 | RPC providers degraded | No provider within 20 blocks of head | **Page** | R9 |
| A10 | Indexer lag | Cursor >100 blocks behind safe head | Ticket | R10 |
| A11 | Notification queue not draining | >200 pending | Ticket | R7 |
| A12 | Relayer gas balance | <0.05 ETH | Ticket | R4 |

**Paging alerts share one property:** each means we cannot currently tell whether the system's state matches what the user signed. That is the only class of problem worth waking someone for — everything else costs a delayed trade.

---

## 3. Runbooks

Each is written to be followed at 3am by someone who did not write the code.

### R1 — Post-install verification mismatch

**Means:** a session installed on-chain does not match the policy the user signed. **The session is already PAUSED_MISMATCH and was never marked ACTIVE** — no agent can act under it.

1. **Do not "fix" it by re-running the install.** A mismatch is either an SDK behaviour change or a composer bug, and installing again reproduces it.
2. Read the stored expectation and the on-chain config: `npm --prefix server exec tsx src/scripts/evmVerifySession.ts <sessionId>`.
3. Compare field by field. Which policy is *wider* — the installed one or the signed one?
4. If the installed one is wider: **incident**. Notify the user, prepare a revoke, and treat the SDK pin as suspect (SEC-15).
5. If narrower: still a bug, not an incident. The user is over-protected, not exposed.
6. Either way: do not unpause. Fix the composer, add the case to the violation matrix, install a fresh session.

**Do not:** mark ACTIVE manually. That is the one action this whole mechanism exists to prevent.

### R2 — Budget mirror drift

**Means:** our record of spend disagrees with the chain. The session is already paused (FR-6.3).

1. The chain is authoritative. Always. Our number is the wrong one by definition.
2. `SELECT * FROM corral_budget_mirror WHERE session_id = …` and compare against `getPolicyData` on-chain.
3. Mirror **ahead** of chain (we think more was spent): usually a failed execution recorded as spent. Harmless to the user; find the accounting bug.
4. Mirror **behind** chain (we think less was spent): more serious — something spent budget outside our pipeline. Check the journal for entries with no matching execution row. If found, escalate: either a second signer exists or the session was used elsewhere.
5. Refresh the mirror from chain, then unpause only once the *cause* is understood.

### R3 — Module set changed

**Means:** a validator was installed or removed on a user's account. Only the owner can do this.

1. Session is already `PAUSED_MODULE_CHANGE`.
2. Read `corral_anomalies` for the snapshot: what appeared, what disappeared, and whether enumeration was available.
3. **Contact the user.** The question is simply "did you do this?"
4. If yes and the module is benign: record the decision, unpause manually.
5. If no: **treat the owner key as compromised.** Corral cannot help — the owner can move funds directly. Advise them to move funds to a fresh account, and revoke the session.
6. If enumeration was unavailable (`enumerated: false`), say so honestly: we detected a *missing* module, and cannot rule out an added one.

### R4 — Relayer stuck (head-of-line nonce)

**Means:** one nonce is blocking every subsequent submission from that relayer. This stalls all users at once.

1. `SELECT * FROM corral_relayer_txs WHERE status IN ('ALLOCATED','SENT') ORDER BY nonce LIMIT 5`.
2. Status `ALLOCATED`, no `tx_hash`: a worker died mid-allocation. The stale sweep reclaims it after 90s. If it has not, the sweep is not running — check the engine process.
3. Status `SENT`: check the hash on the explorer.
   - Mined: the settle write failed. Update the row; investigate the write path.
   - Not found: replace-by-fee should have fired. Check for `FeeCeilingExceeded` — if the ceiling was hit, this is a **deliberate stop**, not a bug. Decide whether to raise `RELAYER_MAX_FEE_WEI` (a cost decision) or wait.
4. **Last resort:** send a self-transfer from the relayer EOA with the stuck nonce and a high fee, to clear the slot. Record it.
5. If the relayer key itself is unavailable, promote the standby (I-405) by config and restart the engine. Never run both.

### R5 — Signer refusal storm

**Means:** something is repeatedly asking for signatures it will not get.

1. `SELECT requester, outcome, count(*) FROM corral_signer_audit WHERE created_at > now() - interval '15 min' GROUP BY 1,2`.
2. `REFUSED_REVOKED` in bulk: a job queue holding work for revoked sessions. Harmless — the refusal is the system working — but drain the queue.
3. `REFUSED_WRONG_SIGNER`: **stop and escalate.** Something is asking to sign with a key that is not the session's. This is either a serious bug or an intrusion.
4. `REFUSED_UNKNOWN_SESSION`: usually a stale worker after a data reset.
5. The refusals themselves are never the emergency. What is asking, and why, is.

### R6 — Anomaly auto-pause

**Means:** burn rate, execution size, or a rejection streak tripped a detector (SEC-9). Session is paused.

1. Read the finding in `corral_anomalies` — each carries the numbers that triggered it.
2. `BURN_RATE`: compare against the strategy's own interval. A legitimate cause is a schedule change; an illegitimate one is a compromised planner.
3. `OUTSIZED_EXECUTION`: this overlaps the planner's own FR-4.7 bound, so a finding here means something *got past* that bound. Treat as a bug until proven otherwise.
4. `REJECTION_RATE`: someone is repeatedly proposing work the policy refuses. Benign causes exist (a misconfigured strategy); "probing the boundary" looks identical. Check whether the rejected plans vary systematically.
5. Notify the user before unpausing — they were told it was paused, and silence afterwards is its own problem.

### R7 — Queue not draining

1. `SELECT kind, status, count(*) FROM corral_jobs GROUP BY 1,2` and check the oldest `run_at`.
2. All `PENDING`, none `RUNNING`: no worker. Check the engine process is up and `CORRAL_ENGINE=true`.
3. Many `RUNNING` and stale `locked_at`: workers died. The reaper handles it; if not, it is not running.
4. Many `DEAD`: read `last_error`. **A dead-lettered policy rejection is correct behaviour** — never retry it (non-negotiable #4).
5. One session's jobs blocked: expected. Per-session concurrency is 1 by design.

### R8 — Executions stranded in SUBMITTED

1. `execution.recover` resolves these by reading the chain. If the count is growing, the job is not running.
2. It **never re-submits**. If a stranded row's transaction landed, recovery records the real outcome; if it never existed, the row is closed after the abandon window.
3. A stranded row is not lost money — the ledger's key is consumed, so nothing will re-plan that slot.

### R9 — RPC degraded

1. Run `checkProviders()` (`rpc.health` writes an anomaly with per-host lag).
2. A provider that answers but trails is more dangerous than one that is down: reads succeed and describe an old chain.
3. Failover is automatic. If *every* provider is degraded, executions will fail preflight and retry — which is the safe outcome. Do not disable preflight to "get things moving". That is an incident, not a workaround.
4. Add a provider to `EVM_RPC_URLS` and restart. **Never paste the URL into a ticket, a log, or a chat — it contains the API key.**

### R10 — Indexer lag

1. `SELECT * FROM corral_indexer_cursor`.
2. Lag is a *feed* problem, not a money problem: budgets come from chain reads, not from the indexer.
3. If the cursor is stuck at one block, suspect a repeating reorg detection. Check that block's hash.
4. To force a rebuild: delete the cursor row. Re-indexing is idempotent — events key on (chain, txHash, logIndex).

---

## 4. Database restore drill (I-204, NFR-13)

**Targets:** RPO <5 min, RTO <2h. Drilled quarterly. Record each drill below.

1. Confirm PITR is enabled on the Supabase project and note the retention window.
2. Restore to a **new** project at a timestamp ~30 minutes old. Never restore over production.
3. Point a scratch engine at it with `CORRAL_ENGINE=false` (read-only) and run:
   - `SELECT count(*) FROM corral_executions` — compare against expectations for that timestamp.
   - `SELECT * FROM corral_relayer_nonces` — **the critical one.** A restored nonce counter that is *behind* the chain is harmless (it reconciles forward on the next allocation); one that is *ahead* would skip nonces. Verify the reconciliation.
   - Re-run the mirror refresh and confirm it converges to chain state.
4. Confirm the security property still holds on restored data: no session is ACTIVE without a `verified_at`.
5. Record the drill: date, restore time (RTO), data gap (RPO), problems found.

**What a restore cannot do:** recover money. The database is a mirror. What it recovers is the schedule, the audit trail, and the idempotency ledger — and the third of those is the one that matters, because losing it means a slot could be executed twice. **If the ledger is restored to a point behind the chain, do not resume the engine until the mirror has been refreshed and in-flight executions reconciled.**

| Drill date | RTO | RPO | Findings |
|---|---|---|---|
| _(not yet run — I-204 open)_ | | | |

---

## 5. Deploys (I-506)

1. **Migrations are forward-only and must be backward-compatible.** A migration that a rollback would strand is not deployable. Adding a value to a CHECK constraint is safe; removing one is not (see migration 005).
2. Deploy order: migrations → engine → api → app. The engine tolerates an older API; the API does not tolerate a schema it has not seen.
3. Blue/green on the API tier. **The engine is not blue/green** — two engines is not an outage risk (per-session concurrency is enforced in Postgres, not in the process) but it doubles relayer contention for no benefit. Stop the old one first.
4. Rollback: revert the app and API. **Never roll back a migration** — restore from PITR instead if the schema is genuinely wrong.

---

## 6. Incident response (SEC-10)

1. **Pause first, diagnose second.** Pausing a session costs a missed trade. Diagnosing first can cost a budget.
2. The global pause is: stop the engine process. The API keeps serving reads, the kill switch keeps working, and `/revoke` is unaffected because it depends on none of it.
3. Tell users what happened, what it could have cost, and what it did cost — in that order. Overstating our guarantees is a trust and legal risk (SEC-12).
4. Public post-mortem for anything that touched user funds or could have.
5. **Never claim revocation is instant.** It prevents everything after it; it cannot reverse an included transaction (CLAUDE.md §10.1).

---

## 7. Open

| Item | Ticket |
|---|---|
| Alert wiring to a real paging provider | I-601, I-602 |
| Runbook rehearsals, one each | I-604 |
| On-call rota and escalation | I-605 |
| Failure injection against DB / signer / relayer / RPC | I-606 |
| Restore drill | I-204 |
| Blue/green pipeline | I-506 |
