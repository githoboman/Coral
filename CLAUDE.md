# Tovira Autonomous Agent Wallet — Status & "Where We Stopped"

> Sui Overflow 2026 — **Agentic Web** track.
> This repo (`Coral`) is the isolated build of Tovira's Autonomous Agent Wallet,
> copied out of the main Tovira codebase so it can be developed/submitted without
> touching production Tovira code.

For the full architecture narrative, read [`BRIEFING.md`](./BRIEFING.md). This file
is the **current state + what's left**, so anyone picking it up knows exactly where we are.

---

## One-sentence pitch
An AI agent that executes **real DeepBook V3 trades on Sui without per-action approval**,
constrained by limits the user sets once — and those limits are enforced **on-chain**, so
even a compromised server key cannot overspend or act outside scope.

---

## ✅ Done & proven on testnet
- **Smart contracts** (`contract/agent_policy/`): `AgentPolicy` (shared, budget/whitelist/
  expiry/pause, aborts on violation, Clock time-gate), `AgentCapability` (destroy-on-revoke),
  events. **17/17 Move tests pass.**
- **Published to Sui testnet** — package id, DeepBook V3 testnet ids, and a live
  `create_and_delegate` smoke test all confirmed (concrete object ids live in the team's
  private notes / local `.env`, not committed).
- **Live trade executed** — real DeepBook V3 market swap (1 SUI → DBUSDC) succeeded on
  testnet, no mocks. DeepBook SDK pinned to `@mysten/deepbook-v3 ^0.23.2` to match `sui ^1.45.2`.
- **Revoke proven** — owner `revoke()` destroys the capability; the agent's next on-chain
  action then fails (`input objects are invalid: deleted`). Exactly the PRD guarantee.
- **Backend engine** (`server/src/services/agentWallet/`): wallet (keypair/store/init),
  policy engine (policyChecker/budgetTracker/ptbBuilder/executor — atomic
  `validate → trade → record_spend → log`), DeepBook (client/swap/orders/setup), strategies
  (percentage/scheduled/conditional), owner controls (create/pause/resume/two-step revoke),
  observability (alerts + Walrus archiver). **28/28 backend tests pass, tsc clean.**
- **API** (`server/src/routes/agentWallet.ts`): `/api/agent/*` — init, status, policy
  create/bind, pause/resume, revoke, swap, schedule, DeepBook bootstrap, alerts, and NL `/intent`.
- **Frontend** (`app/src/`): `useAgentWallet` hook, `AgentControls` panel, mounted as a
  real page at `/agent` (nav item in Layout). Dev-auth bypass (`AGENT_DEV_AUTH` +
  `x-dev-wallet`) lets the demo run locally without Supabase login.
- **Full server boots** without real external creds (Supabase/Tavily/Gemini fall back to
  safe dummies); agent routes verified live (401 when unauth, 200 via dev-auth).

---

## 🟡 The ONE blocked item — Natural-language intent engine (the differentiator)
The agentic NL layer that makes this win the *Agentic Web* track is **built and typechecks
clean** but was blocked on credentials:

- `server/src/services/agentWallet/tradeIntentParser.ts` — LangChain + Gemini
  `withStructuredOutput`, `TradeIntentSchema` (action / tokenIn / tokenOut / amount /
  percentage / price / condition / schedule / summary).
- `server/src/services/agentWallet/tradeIntentService.ts` — routes a parsed intent to
  `swapAgent` / `executePercentageSwap` / `watchPriceCondition` / `scheduleSwap`
  (SUI=9, USDC=6 decimals).
- `POST /api/agent/intent` route + frontend NL command box in `AgentControls`
  (example prompt chips, "Understood:" result card, busy state).

**Blocker:** needs a **real `GEMINI_API_KEY`** — local `.env` had a dummy key, so the parser
reached the Gemini API but failed `API_KEY_INVALID`. Wiring is confirmed correct.

**To unblock / test:**
```bash
cd server
# put a real key in server/.env:  GEMINI_API_KEY=...   (or GEMINI_API_KEY_TASK=...)
npx tsx src/scripts/testIntentParse.ts "swap 30% of my SUI to USDC"
```
Optional safety net for the live demo: add a deterministic **regex fallback** parser so the
NL box still works if the Gemini call fails mid-presentation.

---

## What's left before the live demo (mostly ops, not code)
1. Plug in the real `GEMINI_API_KEY` → verify the intent parser end-to-end.
2. (Optional) Add the regex fallback parser as a demo safety net.
3. Create a **fresh** AgentPolicy + Capability for the live demo (the smoke-test pair was
   consumed/destroyed by the revoke demo).
4. Run the demo flow: create policy → NL command → trade executes → revoke → agent's next
   trade fails on-chain.
5. Decide where `<AgentControls />` finally lives in the product (currently `/agent`).

---

## Verification commands
```bash
sui move test --path contract/agent_policy   # 17/17
cd server && npm test                         # 28/28 agent-wallet tests
cd server && npx tsc --noEmit                 # clean
cd app && npx tsc --noEmit                    # clean
```

## Repo hygiene notes
- `server/.env` and `app/.env` are **gitignored** — all secrets (keys, mnemonic, testnet
  object ids) live there, never committed.
- `contract/agent_policy/build/` is gitignored (compiled Move bytecode).
- This is **additive** to Tovira — it adds new folders/routes and touches no existing
  chat/points/research code.
