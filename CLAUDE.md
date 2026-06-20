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
- **Both swap directions wired** — DeepBook `quantity` is whole BASE tokens regardless of
  side, while the agent tracks `amount` in tokenIn base units. `swapAgent` now reconciles:
  SELL (base→quote) converts amount→whole base; BUY (quote→base) converts the quote spend
  to a base quantity via `price` (limit) or `getBaseQuantityOut` (market). Sized via
  shared `config.toWholeTokens`. Only the SELL (SUI→USDC) leg has a live testnet receipt;
  the BUY leg is coded + unit-tested but not yet live-confirmed.
- **Revoke proven** — owner `revoke()` destroys the capability; the agent's next on-chain
  action then fails (`input objects are invalid: deleted`). Exactly the PRD guarantee.
- **Backend engine** (`server/src/services/agentWallet/`): wallet (keypair/store/init),
  policy engine (policyChecker/budgetTracker/ptbBuilder/executor — atomic
  `validate → trade → record_spend → log`), DeepBook (client/swap/orders/setup), strategies
  (percentage/scheduled/conditional), owner controls (create/pause/resume/two-step revoke),
  observability (alerts + Walrus archiver). **40/40 agent-wallet backend tests pass, tsc clean.**
- **API** (`server/src/routes/agentWallet.ts`): `/api/agent/*` — init, status, policy
  create/bind, pause/resume, revoke, swap, schedule, DeepBook bootstrap, alerts, and NL `/intent`.
- **Frontend** (`app/src/`): `useAgentWallet` hook, `AgentControls` panel, mounted as a
  real page at `/agent` (nav item in Layout). Dev-auth bypass (`AGENT_DEV_AUTH` +
  `x-dev-wallet`) lets the demo run locally without Supabase login.
- **Full server boots** without real external creds (Supabase/Tavily/Gemini fall back to
  safe dummies); agent routes verified live (401 when unauth, 200 via dev-auth).

---

## ✅ Deployment-readiness sweep (whole repo green)
Hardened the **entire** codebase, not just the agent-wallet feature:
- **Gemini-without-a-key, everywhere it matters** — `ChatGoogleGenerativeAI`'s constructor
  THROWS with no key, which previously broke `SuggestionEngine` at construction (10 failing
  tests) in any no-creds environment. New `server/src/services/llm.ts` (`createChatModel`
  returns `null` instead of throwing; `isUsableLlmKey`/`resolveGeminiKey`); the suggestion
  engine now degrades to its regex path. The intent parser uses the same guard.
- **sentimentService** — `formatForReport` now renders the `Sources:` line it always
  promised.
- **simulationService** — `simulateSwap` hard-fails on insufficient balance (dropped the
  ambiguous "hypothetical simulation" path) to match intended behavior.
- **Frontend build fixed** — `tsconfig.app.json` was missing the `@/` path alias, so
  `npm run build` (`tsc -b`) failed on every aliased import. Added it; `npm run build` now
  emits `dist/` cleanly.
- **Green across the board:** Move 17/17 · server 104/104 + tsc clean · app tsc clean +
  `npm run build` succeeds.

---

## 🟢 Natural-language intent engine — now demo-safe without credentials
The agentic NL layer that makes this win the *Agentic Web* track is **built, typechecks
clean, and now runs with or without a Gemini key**:

- `server/src/services/agentWallet/tradeIntentSchema.ts` — shared `TradeIntentSchema`
  (action / tokenIn / tokenOut / amount / percentage / price / condition / schedule /
  summary), imported by both the LLM parser and the fallback (no import cycle).
- `server/src/services/agentWallet/tradeIntentParser.ts` — LangChain + Gemini
  `withStructuredOutput`. Now **degrades gracefully**: if no usable `GEMINI_API_KEY` is
  configured (missing/placeholder) **or** the Gemini call throws (invalid key, network,
  rate limit), `parse()` falls back to the deterministic regex parser instead of failing.
- `server/src/services/agentWallet/tradeIntentFallback.ts` — **NEW** dependency-free
  regex parser covering every canonical shape (market/percentage/conditional/limit/
  scheduled/cancel). Never invents amounts/prices. 12 unit tests in
  `__tests__/tradeIntentFallback.test.ts`.
- `server/src/services/agentWallet/tradeIntentService.ts` — routes a parsed intent to
  `swapAgent` / `executePercentageSwap` / `watchPriceCondition` / `scheduleSwap`
  (decimals via shared `config.decimalsFor`; SUI=9, USDC=6).
- `POST /api/agent/intent` route + frontend NL command box in `AgentControls`
  (example prompt chips, "Understood:" result card, busy state).

**Status:** the NL box works in the live demo even with a dummy/missing key (proven via
`testIntentParse.ts` — prints `Parser: deterministic fallback`). With a real
`GEMINI_API_KEY` it uses Gemini for richer paraphrase handling. The Gemini path itself was
only ever blocked on a real key (wiring confirmed correct).

**To use the LLM path / test either path:**
```bash
cd server
# Optional: real key in server/.env  ->  GEMINI_API_KEY=...   (or GEMINI_API_KEY_TASK=...)
npx tsx src/scripts/testIntentParse.ts "swap 30% of my SUI to USDC"   # prints which parser ran
```
The deterministic **regex fallback** is now in place (`tradeIntentFallback.ts`), so the NL
box still works if the Gemini call fails mid-presentation.

---

## What's left before the live demo (mostly ops, not code)
1. ~~Plug in `GEMINI_API_KEY`~~ — no longer a blocker; fallback runs without it. Add a real
   key only if you want Gemini's richer paraphrase handling during the demo.
2. ~~Add the regex fallback~~ — **done** (`tradeIntentFallback.ts`, 12 tests).
3. Create a **fresh** AgentPolicy + Capability for the live demo (the smoke-test pair was
   consumed/destroyed by the revoke demo).
4. Run the demo flow: create policy → NL command → trade executes → revoke → agent's next
   trade fails on-chain.
5. (Optional) Live-confirm the BUY leg (USDC→SUI) on testnet — coded + unit-tested but only
   the SELL leg has a live receipt so far.
6. Decide where `<AgentControls />` finally lives in the product (currently `/agent`).

---

## Verification commands
```bash
sui move test --path contract/agent_policy   # 17/17
cd server && npx vitest run                   # 104/104 (full server suite; 40 agent-wallet)
cd server && npx tsc --noEmit                 # clean
cd app    && npx tsc --noEmit                 # clean (root tsconfig, has @/ alias)
cd app    && npm run build                    # tsc -b + vite build — green, emits dist/
```

> Deployment note: `tsconfig.app.json` now carries the same `@/* -> ./src/*` path
> alias as the root tsconfig and `vite.config.ts`. Without it, `npm run build`'s
> `tsc -b` step failed to resolve every `@/` import (the plain `tsc --noEmit` uses the
> root config and masked this). Both the typecheck and the bundle now pass.

## Repo hygiene notes
- `server/.env` and `app/.env` are **gitignored** — all secrets (keys, mnemonic, testnet
  object ids) live there, never committed.
- `contract/agent_policy/build/` is gitignored (compiled Move bytecode).
- This is **additive** to Tovira — it adds new folders/routes and touches no existing
  chat/points/research code.
