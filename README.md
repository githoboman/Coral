# 🪸 Coral — Autonomous Agent Wallet on Sui

> **Sui Overflow 2026 · Agentic Web track**

An AI agent that executes **real DeepBook V3 trades on Sui without per-action
approval** — constrained by limits the user sets once, and enforced **on-chain**.
Even a fully compromised server key cannot overspend or act outside its scope.

---

## The one-line idea

You tell the agent what you want in plain English ("swap 30% of my SUI to USDC").
The agent **decides** the trade, **signs** it with its own key, and the **on-chain
policy restricts** what it's allowed to do. That third part is the whole point.

### Why this matters (the critical distinction)

| ❌ Agent-controlled **UX** | ✅ Agent-controlled **wallet** (Coral) |
|---|---|
| Agent decides | Agent decides |
| **Human signs** every tx | **Agent signs** — true autonomy |
| — | **Policy restricts** on-chain |

Most "AI + crypto" demos are the left column: a chatbot with a Confirm button.
That isn't autonomous. Coral is the right column — the agent holds a key and acts
on its own, but a Move contract (`AgentPolicy`) is a hard wall around it: budget
cap, asset/protocol whitelist, expiry, pause, and owner revoke are all enforced
*on-chain*, so the agent **cannot** exceed them even if the backend is breached.

---

## What it does for the Sui ecosystem

- **A reusable safety primitive for the agentic web.** `AgentPolicy` +
  `AgentCapability` is a general pattern any Sui dApp can adopt to delegate
  signing authority to an agent *safely*. The capability is destroy-on-revoke, so
  killing access is a single on-chain action.
- **Drives real DeepBook V3 volume** from autonomous, natural-language intent —
  not mock swaps. Trades settle through DeepBook's central limit order book.
- **Makes "give an AI a wallet" defensible.** The reason teams fall back to
  human-signing is fear of a runaway key. Coral shows the on-chain-policy answer:
  bounded autonomy.

---

## Architecture

```
app/        Vite + React frontend (dapp-kit wallet, chat UI, policy/activity/history)
server/     Express + TypeScript backend (agent engine, NL intent parser, DeepBook)
contract/   Move package: AgentPolicy (shared) + AgentCapability (owned)
```

- **Contract** (`contract/agent_policy`): `validate_action → record_spend →
  log_action`, aborting on any policy violation. Clock-gated for scheduled/expiry
  rules. **17/17 Move tests.**
- **Backend** (`server/src/services/agentWallet`): the agent keypair (encrypted at
  rest), policy checker, budget tracker, guarded PTB builder/executor (one atomic
  transaction: validate → trade → record → log), DeepBook client, and the
  **natural-language intent engine** (Gemini with a deterministic regex fallback,
  so it works even without an API key). **104/104 server tests.**
- **Frontend** (`app/src`): a Corral-designed agent surface — chat command box,
  policy creation/management, live activity log, transaction history, wallet
  drawer, light/dark themes.

---

## Live testnet status (proven, not mocked)

- Move package **published to Sui testnet**.
- A **real DeepBook V3 swap** (SUI → DBUSDC) executed by the agent, no human
  signature per trade.
- **Revoke proven**: owner revokes → the agent's next on-chain action fails
  (`input objects are invalid: deleted`) — exactly the guarantee.

---

## Run it locally

You need **two terminals** (the frontend talks to the backend).

```bash
# 1. Backend
cd server
cp .env.example .env        # then fill the values (see below)
npm install --legacy-peer-deps
npm run dev                  # http://localhost:3000

# 2. Frontend
cd app
cp .env.example .env         # then fill VITE_API_BASE_URL etc.
npm install --legacy-peer-deps
npm run dev                  # http://localhost:5173
```

Open **http://localhost:5173** and connect a **Sui testnet** wallet.

> For a quick local demo without real auth, set `AGENT_DEV_AUTH=true` in
> `server/.env` and `VITE_AGENT_DEV_AUTH=true` in `app/.env` — the backend then
> trusts the connected wallet without a login round-trip. **Never enable these in
> production.**

### Verify the build & tests

```bash
sui move test --path contract/agent_policy   # 17/17
cd server && npx vitest run                   # 104/104
cd server && npx tsc --noEmit                 # clean
cd app    && npm run build                     # tsc -b + vite build -> dist/
```

---

## How to test the product (the demo arc)

1. **Connect** a Sui testnet wallet (header → Connect Wallet).
2. **Initialize** the agent → it gets its own address.
3. **Create a policy** (`/agent/policy`): budget cap, allowed tokens (SUI/USDC),
   expiry. Sign once — this is the *only* signature you give. The header pill
   flips to **Active** with a live budget bar + expiry countdown.
4. **Instruct in plain English** (`/agent`): e.g. *"Swap 1 SUI to USDC."* The
   agent parses it → shows a **Strategy Parsed** card → executes a **real
   DeepBook trade** → gives a **View TX** explorer link. No per-trade signing.
5. **See it** on `/agent/activity` (live log + stats) and `/agent/history`
   (settled-tx timeline).
6. **Revoke** → the agent's next action **fails on-chain**. That's the safety
   guarantee, demonstrated.

> The natural-language box works **with or without** a Gemini key — without one it
> uses a deterministic parser, so the demo never hard-depends on a credential.

---

## How to deploy

Configured for **Render (backend)** + **Vercel (frontend)**.

### Backend → Render
- New Web Service from this repo, root `server` (or use `server/render.yaml`).
- Build: `npm install --legacy-peer-deps && npm run build` · Start: `npm start`
- Set the env vars from **`server/.env.example`** (Render → Environment).
  At minimum: `NODE_ENV=production`, `CORS_ORIGIN`, `TOKEN_HMAC_SECRET`,
  `ENCRYPTION_MASTER_KEY`, `SUI_NETWORK`, `AGENT_POLICY_PACKAGE_ID`,
  `DEEPBOOK_PACKAGE_ID`, `AGENT_IMPORT_KEY` (+ `GEMINI_API_KEY` for full NL).

### Frontend → Vercel
- Import this repo, **Root Directory = `app`**, install
  `npm install --legacy-peer-deps`, framework Vite (output `dist`).
- Set the env vars from **`app/.env.example`**: `VITE_API_BASE_URL` (the Render
  URL), `VITE_SUI_NETWORK`, `VITE_AGENT_BALANCE_MANAGER`, `VITE_MAINTENANCE_MODE`.

### Wire them together (don't skip)
1. On Render, set `CORS_ORIGIN` to the exact Vercel URL → redeploy.
2. On Vercel, set `VITE_API_BASE_URL` to the exact Render URL → redeploy.
3. Auth cookies are cross-domain; the server already sends `SameSite=None; Secure`
   when `NODE_ENV=production`, so login works across the two domains over HTTPS.

> Render's free tier sleeps after ~15 min idle — the first request then takes
> ~30–50s to wake. Fine for a demo.

---

## Security notes

- All secrets live in the gitignored `.env` files — never committed. Use the
  `.env.example` files as the template.
- The agent's signing key is **encrypted at rest** (AES-256-GCM). The on-chain
  policy is the real guard: a leaked key still cannot exceed budget/scope/expiry.
- Rotate `AGENT_IMPORT_KEY` for any real deployment — generate a fresh agent
  wallet, fund it, and import that key.

---

## Tech

Sui Move · `@mysten/sui` · `@mysten/dapp-kit` · `@mysten/deepbook-v3` ·
Express + TypeScript · LangChain + Gemini (with regex fallback) · React + Vite +
Tailwind · Walrus (intent archiving).
