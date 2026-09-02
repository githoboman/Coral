# Corral — Threat Model

**Ticket:** C-002 · **Gate:** G0 · **Version:** 1.0 (28 Aug 2026, v3 stack — D19–D26)

This document exists to be argued with. It states what we are protecting, from whom, what we assume, and — most importantly — **what we do not defend against**. A threat model that only lists wins is marketing.

Read `CLAUDE.md` §1 first: the whole product is one security property, and everything below is an attempt to break it.

> If every off-chain component — API, job runner, planner, signer, relayer, indexer, database, frontend, and every server or managed service we use — is fully controlled by an attacker, the maximum loss is the active session's remaining per-asset budget, and funds can only move to policy-permitted destinations.

---

## 1. Assets

Ordered by what an attacker would actually want.

| # | Asset | Where it lives | Loss if compromised |
|---|---|---|---|
| A1 | **User funds** | The user's ERC-7579 smart account on Base | The thing everything else exists to protect |
| A2 | **Owner key** | The user's wallet. We never see it | Total loss for that user — game over, and outside our boundary |
| A3 | **Session signer key** | KMS at mainnet (D23); AES-256-GCM at rest on testnet | Bounded: the attacker gets exactly the session's remaining budget, to permitted destinations |
| A4 | **Relayer key** | Hot, holds gas only | Gas theft. Cannot widen policy, cannot redirect funds (SEC-16) |
| A5 | **Execution ledger** | Supabase Postgres | Double execution *if* the ledger's uniqueness were bypassed; see T7 |
| A6 | **Policy configuration in flight** | Between authoring and install | A user signs limits they did not intend — see T1, the highest-severity realistic attack |
| A7 | **User PII** | Supabase (email, Telegram id) | Privacy harm, phishing material |
| A8 | **Journal history** | On-chain, `CorralJournal` | Cannot be forged for an account the attacker does not control; can be spammed with noise |

---

## 2. Actors

| Actor | Capability assumed | Trusted? |
|---|---|---|
| **Owner** | Holds the owner key; can install, revoke, and move funds directly | Yes — they are the principal |
| **Agent operator (us)** | Runs every off-chain component | **No.** Explicitly untrusted (SEC-3, SEC-17) |
| **Full backend compromise** | Root on our servers, Supabase, the signer's *caller*, the relayer | No — and the security property is stated against exactly this |
| **KMS compromise** | Can request signatures but cannot export keys | Partially: bounded to the session budget |
| **Malicious protocol** | The DEX router behaves adversarially | No — bounded by `amountOutMinimum` and the recipient pin |
| **Prompt injector** | Controls text a model reads during authoring | No — see T2 |
| **Base sequencer** | Orders and can censor transactions | Partially — we explicitly do not claim censorship resistance (SEC-18) |
| **RPC provider** | Can lie about chain state, or lag | No — see T8 |
| **Curious observer** | Reads the chain and our public endpoints | N/A — this is a design goal (FR-7.6) |

---

## 3. Trust boundaries

```
   ┌──────────────────────── UNTRUSTED ────────────────────────┐
   │  app/ (browser)   server/ (API, jobs, planner, relayer)   │
   │  Supabase Postgres   hosting   commercial RPC   indexer   │
   └──────────────┬──────────────────────────┬─────────────────┘
                  │                          │
        signature request               signed userOp
                  │                          │
        ┌─────────▼─────────┐      ┌─────────▼─────────┐
        │   KMS boundary    │      │  Base consensus   │
        │   (D23, SEC-13)   │      │  + audited        │
        │  keys never leave │      │    modules        │
        └───────────────────┘      └───────────────────┘
                            TRUSTED
```

**Trusted, and only these:** the owner's key, Base consensus, the audited SmartSessions/policy modules, our audited `CorralJournal` and `CorralRateLimitPolicy`, and the KMS boundary.

Everything we write and everything we rent is on the untrusted side. "It is safe because it runs on our own infrastructure" is a rejected argument (SEC-17).

---

## 4. Attack tree

The root goal: **move a user's funds somewhere the user did not permit.**

### T1 — Make the user sign the wrong policy *(highest realistic severity)*

The attacker does not need to break anything cryptographic. They need the review screen to say something softer than the configuration it describes.

**Paths:**
- Compromise the frontend and render a friendlier summary than the policy allows.
- Supply a hostile token symbol or contract label that reads as safe.
- Exploit a gap between what `parsePolicy` enforces and what the screen claims.

**Defences:**
- `policySummary()` lives in `@corral/core`, beside `parsePolicy` — the sentence on screen is produced by the same code that validates what goes on-chain (FR-11.1). A frontend-authored summary would be a second, unverified description free to drift.
- The summary **never understates**: an unpinned, unbounded transfer target is reported as `unrestricted` with a warning, not rounded to "your own account". Tested.
- Labels are display-only; identity is always the address, and the address is always rendered. Tested with a hostile label.
- Decimals are supplied, never guessed — guessing 18 for a 6-decimal token understates a cap by a trillion.

**Residual:** a fully compromised frontend can still lie, because it controls the pixels. The mitigation is that the *installed* session is read back from chain and compared to the signed policy (SEC-15), and the standalone `/revoke` page and the public `/verify` view give the user an independent way to see the truth. **We do not claim a compromised frontend is harmless — we claim it is detectable and bounded.**

### T2 — Prompt injection into execution

**Path:** poison text a model reads, so it emits a plan that spends elsewhere.

**Defence — architectural, not filtering:** no model output reaches execution. Unattended runs use the deterministic planner, a pure function of (typed config, chain state, quote) with **no text input at all** (CLAUDE.md §2.7). Model output can only propose *configuration*, which must survive `parsePolicy` and a human signature.

**Evidence:** the SEC-4 corpus (76 cases) shows every adversarial payload is either rejected at the parse boundary or yields a policy whose invariants still hold, and that compiled calldata is byte-identical regardless of attacker-controlled symbols.

**Residual:** a user who reads the review screen carelessly can still be socially engineered into signing a bad-but-valid policy. This is T1 again, and it is why FR-11.1 is a MUST and C-811 (usability testing) exists.

### T3 — Steal the session signer key

**Path:** compromise the signer, the KMS credentials, or the process holding them.

**Defence:** the loss is bounded *by design* — this is the security property. The attacker gets the session's remaining per-asset budget, to permitted destinations only, at the permitted rate. The recipient pin means a swap's output returns to the account; the budget caps bound the loss; the usage and rate-limit policies bound the speed.

**Additional layers:** the signer refuses independently for a revoked/expired session (SEC-14), every request is audited, and mainnet keys are non-exportable (D23).

**Residual:** the remaining budget is genuinely at risk. **We say this plainly rather than implying zero loss.** The user's mitigation is a smaller budget and a shorter window; ours is the rate limit.

### T4 — Widen a policy from the backend

**Path:** call `enableSessions` from job or API code.

**Defence:** session installation is owner-initiated only (CLAUDE.md §2.3). A CI grep fails the build if `enableSessions` appears outside `server/src/services/evm/sessionInstall`. No API endpoint accepts calldata, an address, or an amount destined for the signer.

**Residual:** a compromise that reaches the *owner* can install anything. That is A2 and outside our boundary.

### T5 — Install a second, looser validator

**Path:** with the owner key, install a validator module whose rules are permissive. The SmartSessions policies are not modified — they simply stop being the path.

**Defence:** `module.monitor` detects a changed module set and pauses the session (FR-1.5); the module allowlist and codehash pins are asserted at boot.

**Honest limitation:** enumeration (`getValidatorsPaginated`) is a Safe7579 extension. Where an account does not support it, the snapshot reports `enumerated: false` — it can prove a required module is *gone*, not that nothing extra was *added*. The code says so rather than reporting a clean bill of health it did not verify.

**Residual:** requires the owner key, so it is A2 again. The monitor exists to make an owner-key compromise loud rather than silent.

### T6 — Burn the whole budget at once

**Path:** own the planner and spend a month of budget in an hour. Every execution is individually legitimate; nothing on-chain objects, because nothing on-chain was asked to.

**Defences:** `CorralRateLimitPolicy` enforces a rolling 24h cap **on-chain** (D26); the scheduler enforces it off-chain as defence in depth; anomaly detection compares burn rate against the session's own schedule and pauses.

**Residual:** within one rate-limit window the attacker gets that window's worth. Bounded, not zero.

### T7 — Double execution

**Path:** race two workers, or replay a job, so one budget is spent twice.

**Defences:** the idempotency key is inserted **before anything is signed** — the ledger is the commit point, not a record after the fact. Per-session concurrency is a unique partial index, not a query. `execution.recover` resolves stranded rows by *reading the chain*, and never re-submits.

**Evidence:** the chaos harness kills the real pipeline at five stages and always finds exactly one execution row and at most one submission.

**Residual:** the 10-lifecycle-point × 5 version of the gate (C-507) is not yet run; the current evidence is 5 points.

### T8 — Lie about chain state

**Path:** a compromised or lagging RPC provider reports stale budgets, so the planner believes there is headroom that is gone.

**Defences:** multi-provider failover with per-provider lag reporting (NFR-14); the preflight/simulation gate before signing; and crucially, **the on-chain policy is the enforcement** — a plan built on a lie still fails validation on-chain.

**Residual:** wasted gas and failed executions, not loss.

### T9 — Manipulate the price

**Path:** sandwich or manipulate the pool so the agent trades at a terrible price.

**Defences:** `amountOutMinimum` derived from a quote with a policy-floored slippage tolerance, enforced on-chain by a GTE param rule. The policy's `min_output_bps` has a hard floor of 5000 at parse time.

**Residual:** losses up to the configured slippage tolerance, per trade. Real, bounded, and disclosed.

### T10 — Attack revocation

**Path:** delay or suppress a revoke so one more execution lands.

**Defences:** the off-chain signer is disabled **first**, before anything on-chain (measured <1s, NFR-3). We run our own relayer, so no signed operation sits in a mempool we do not control (D13) — the residual window is our own submission latency and nothing else. The relayer independently refuses to broadcast for a non-executable session (I-406). The standalone `/revoke` page works with every Corral service down (FR-8.3).

**Residual, stated plainly (CLAUDE.md §10.1):** revocation prevents everything after it; it cannot reverse an already-included transaction. The window is small, measurable, and **not zero**.

### T11 — Poison the feed

**Path:** emit `CorralJournal.Logged` events from an unrelated contract or account to fabricate history.

**Defence:** the journal has no access control by design, and consumers filter on `account`. The indexer matches a journal entry to an execution row and ignores entries that are not ours; realised amounts come from ERC-20 `Transfer` logs crediting the account, not from a router's claim.

**Residual:** an observer using a naive indexer could be misled. Ours is not; third parties are told to filter.

### T12 — Database compromise

**Path:** full write access to Supabase.

**What that buys:** schedule manipulation, feed falsification, PII theft, denial of service. **What it does not buy:** more money than the policy allows. The database is a mirror and is never authoritative about funds; a mirror that disagrees with the chain pauses the session rather than proceeding (FR-6.3).

**Residual:** privacy loss (A7) is real and is not bounded by any on-chain rule. This is the one asset our security property does not protect, and it should be said out loud.

---

## 5. What we do not defend against

Stated deliberately. Each of these is a decision, not an oversight.

1. **A compromised owner key.** Total loss. Nothing in this system helps.
2. **Censorship by the Base sequencer.** We do not claim censorship resistance (SEC-18); running our own nodes would not change it.
3. **Reversal of an included transaction.** Revocation is forward-only (SEC-12).
4. **PII confidentiality under a full database compromise.** Bounded by policy for *funds*, not for personal data.
5. **A user who signs a bad-but-valid policy.** The review screen and usability testing reduce this; they cannot eliminate it.
6. **Losses within the configured slippage tolerance.**
7. **Loss of the remaining budget under a signer compromise.** This is the security property's stated ceiling, not a gap in it.
8. **Bugs in the audited third-party modules.** SmartSessions and the policy modules are trusted; that trust is the reason the SDK is exact-pinned and an upgrade is a security review (SEC-15), not a routine bump.

---

## 6. Assumptions

If any of these is false, the model above does not hold.

| # | Assumption | How it is checked |
|---|---|---|
| AS1 | SmartSessions and the policy modules enforce what their interfaces claim | The 26-case violation matrix, on a Base fork, every commit |
| AS2 | The pinned module addresses are the contracts we reviewed | Codehash assertions at boot; CI check |
| AS3 | The installed session matches the signed policy | Post-install read-back verification; a mismatch pauses and pages (SEC-15) |
| AS4 | The KMS does not export keys | Vendor guarantee + key policy (D23). **Mainnet blocker until in place** |
| AS5 | Base finalises and does not reorg deeply | Indexer stays 5 blocks behind head and detects reorgs by block hash |
| AS6 | `@corral/core` has no I/O and cannot be influenced at runtime | dependency-cruiser, in CI |
| AS7 | Money never touches a float | Branded `TokenAmount`, `Math.*`/`Number()` lint bans, property tests |

---

## 7. Open items at the time of writing

| Item | Status |
|---|---|
| KMS custody (AS4) | **Open — mainnet blocker** (I-301…I-306, D23) |
| External audit | Open (C-905) |
| Mainnet module attestation | Open — Base Sepolia uses a dev-key self-attestation shim |
| G2 at full scale (10 kill points × 5) | Partial — 5 points proven |
| Legal review (SEC-11) | Open |
| Restore drill (NFR-13) | Open |

---

## 8. Review

This document is reviewed when: a new contract is added, the trust boundary moves, a new external dependency with meaningful trust appears, or an incident shows a path not listed here. Changes to the *decisions* behind it go in `00_FEASIBILITY_AND_TIMELINE.md` §6 (the ADR log), not only here.
