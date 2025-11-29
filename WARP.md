# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project layout

- `backend/`: FastAPI API, AI/agent orchestration, Supabase + Redis integration, and Telegram bot entrypoints.
- `app/`: React + TypeScript dashboard SPA (authenticated product UI: chat, agents, tasks, events, account views).
- `frontend/`: React + TypeScript marketing/landing SPA (public site shell with a simple `Home` route and layout).
- `contract/telegram_bot/`: Sui Move package implementing on-chain user profiles, subscriptions, points, and referrals for the Telegram bot.
- `.github/workflows/`: Currently contains `pipeline.yml` with no logic; CI is effectively unspecified here.

## Common commands

### Backend (FastAPI API + Telegram bot)

Run these from `backend/`.

- **Install Python dependencies** (FastAPI, LangChain/Graph, Supabase, Redis, Telegram, Web3, etc.):
  - `pip install -r requirements.txt`

- **Run the API server** (also wires in the Telegram bot via FastAPI lifespan if `TELEGRAM_BOT_TOKEN` is set):
  - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
  - Alternatively: `python -m uvicorn app.main:app` (for a non-reload production-style run).

- **Python testing** (pytest is included in `requirements.txt`, but there are currently no test files):
  - Run all tests: `pytest`
  - Run a single test (once tests exist): `pytest path/to/test_file.py::TestClass::test_case`

- **Python linting / formatting** (ruff + black are in `requirements.txt`):
  - Lint backend code: `ruff check app`
  - Auto-fix lint issues where possible: `ruff check app --fix`
  - Format code: `black app`

### Frontend: product dashboard (`app/`)

Run these from `app/`.

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build for production: `npm run build`
- Lint: `npm run lint`

The Vite config defines an alias `"@" -> ./src`, so imports like `@/pages/...` resolve under `src/`.

### Frontend: marketing site (`frontend/`)

`frontend/` is another Vite + React app, structured as a lean landing/marketing surface. Commands are parallel to `app/` and use the same scripts:

Run these from `frontend/`.

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build for production: `npm run build`
- Lint: `npm run lint`

### Move contracts (`contract/telegram_bot`)

Run these from `contract/telegram_bot/` with the Sui CLI installed and configured:

- Build smart contracts: `sui move build`
- Run Move tests: `sui move test`

## Backend architecture (FastAPI + Supabase + Agents)

### Entry point and application lifecycle

- `backend/app/main.py` defines the FastAPI `app` with a custom `lifespan` context manager.
  - On startup, if `TELEGRAM_BOT_TOKEN` is set, it calls `app.telegram_bot.telegram_bot.create_telegram_application(...)`, initializes the Telegram Application, starts it, and begins polling in a background task.
  - On shutdown, it gracefully stops and shuts down the Telegram bot.
- CORS is configured to allow the local Vite dev server (`http://localhost:5173`) and production domains (`tovira.xyz`, `tovira.onrender.com`).
- The main API mounts versioned routers under `/api` for users, account, chats, tasks, and events, plus a top-level waitlist router.
- Simple health endpoints exist at `/` and `/health`, and `/telegram/status` surfaces Telegram bot runtime status.

### Configuration and environment

- `backend/app/core/config.py` contains a centralized `Settings` class using `pydantic-settings` and `.env` loading.
  - Core values: `ENVIRONMENT`, `DEBUG`, `LOG_LEVEL`.
  - Supabase: `SUPABASE_URL`, `SUPABASE_KEY`.
  - AI/LLM: `GEMINI_API_KEY`, `TAVILY_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_MAX_RETRIES`, etc.
  - Telegram: `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, webhook flags/URL.
  - Web3/Sui: `SUI_NETWORK_RPC`, `SUI_DEVNET_RPC`, `USE_MAINNET`, `BLOCKVISION_API_KEY`, `BLOCKVISION_BASE_URL`.
  - Redis/cache and rate limiting: `REDIS_URL`, `ENABLE_REDIS_CACHE`, `CACHE_TTL`, `RATE_LIMIT_*`.
  - Security/monitoring: `SECRET_KEY`, `SENTRY_DSN`, metrics flags.
- `validate_configuration()` runs on import; in non-production it logs warnings instead of raising on some missing values, but in production it is strict about essentials (Supabase, Gemini, secret key, etc.).
- `TAVILY_API_KEY` is also exported to the process environment for LangChain via `os.environ["TAVILY_API_KEY"]`.

### Supabase data access

- `backend/app/db/session.py` exposes `get_supabase_client()` which lazily instantiates a `supabase.Client` with auth headers and caches it in a module-level singleton.
- All FastAPI routers use `Depends(get_supabase_client)` to share a single Supabase client per process.
- Supabase is the central store for:
  - `user_profiles`, `users`: identity, basic profile, onboarding state, XP/points, time zones.
  - `waitlist_emails`: pre-onboarding waitlist.
  - `chats`, `chat_messages`: conversation metadata and transcripts.
  - `tasks`, `task_reminders`: structured tasks and reminders.
  - `events`: calendar-style events.
  - Various RPCs (e.g., `get_user_rank`, `create_task_with_history`) used by account and task flows.

### Caching and leveling

- `backend/app/core/redis_client.py` defines an async `RedisCache` abstraction:
  - Uses `redis.asyncio` with a connection pool configured via `settings.REDIS_URL` and `REDIS_PASSWORD`.
  - Provides JSON-serialized `get`/`set` with TTL, simple `exists`/`ttl`, atomic counters, and a multi-key `get_many`.
  - All operations are defensive: if Redis is unreachable or disabled, the code falls back gracefully.
- `backend/app/core/leveling.py` centralizes the XP and leveling formulas used by account and leaderboard logic:
  - XP curve: `XP = 1000 * level^1.5` with helper functions to map XP ↔ level and compute percent progress to next level.
  - `XP_REWARDS` and `POINTS_REWARDS` define canonical values for actions (daily check-in, posts, referrals, streaks, etc.).

### HTTP API layer (`app/api/routers`)

Routers are organized by feature, each depending on Supabase and Pydantic schema modules under `app/schemas`.

- `account.py`:
  - Derives user level from XP and keeps `user_profiles.level` in sync based on XP using the same formula as `core/leveling.py`.
  - Exposes `/account/{user_id}` for a consolidated view (XP, level, points, referral points, rank) and `/leaderboard` for the top N users by XP/level/points.
  - Provides `/add-xp/{user_id}` to atomically add XP, recompute level, and return level-up information.

- `users.py`:
  - `/fetch-user`: fetches a profile and indicates whether the user is "onboarded" (driven by presence of an email).
  - `/onboard-user`: validates that the email exists in `waitlist_emails`, ensures it is unique across `user_profiles`, then attaches it (and optional username/name fields) to the existing profile.
  - `/update-user`: upserts the basic `user_profiles` record for a newly seen user (wallet, default flags and counters) but does not handle email; that's left to onboarding.

- `waitlist.py`:
  - `/waitlist`: idempotently inserts new waitlist emails into `waitlist_emails`, returning `409` on duplicates.

- `chats.py`:
  - `POST /chat/stream`: primary chat endpoint used by the dashboard for SSE streaming.
    - Validates input, creates a `chats` record if needed (with an AI-generated name via `generate_chat_name()` from `services/agents/base_agent.py`), stores the user message in `chat_messages`, and fetches the last few messages as context.
    - Streams AI output chunk-by-chunk via `generate_ai_response_stream()` for responsive UX, then persists the final AI message and updates the `chats.last_updated` timestamp.
  - `POST /chat`: non-streaming variant that consumes the same streaming generator but buffers content into a single response.
  - `GET /chat/{chat_id}`: full history; `GET /chats`: list of chats for a user; `PATCH /chat/{chat_id}` to rename; `DELETE /chat/{chat_id}` cascades deletion of `chat_messages`.

- `tasks.py` and `events.py`:
  - Symmetric CRUD and list endpoints for tasks and events, keyed by `user_id`.
  - Support bulk creation, filterable list views (status, priority, tags, date ranges), per-item retrieval/update/delete, and stats endpoints summarizing counts (overdue, completed, recurring, etc.).
  - Tasks/events store structured arrays for tags, attendees, reminder times, which tie into AI and Telegram flows.

### AI and agent stack (`app/services/agents`)

This layer is responsible for all AI behavior and external Web3/market data access.

- `llm_factory.py`:
  - Defines an async `LLMFactory` singleton that returns a configured `ChatGoogleGenerativeAI` instance (Gemini) for reuse across the Web3 agent.

- `base_agent.py`:
  - Declares Pydantic `ResearchState` and several LangChain tools: `web_search`, `browse_page`, `sui_onchain_data`, `coingecko_data`.
  - Implements `SuiResearchAgent` using LangGraph `StateGraph` to orchestrate a multi-pillar research workflow (value proposition, fundamentals, technicals, on-chain metrics, and final synthesis) for Sui ecosystem projects.
  - Provides the streaming primitives used by `chats.py` (`generate_ai_response_stream`, plus helper functions to name chats and emit agent metadata), so chat endpoints do not construct prompts directly.

- `general_agent.py`:
  - Handles general conversational queries for the "Tovira" persona.
  - Classifies queries as greetings, capability questions, gratitude, or free-form conversation, and routes them to different prompts and handlers.
  - Uses Gemini via `ChatGoogleGenerativeAI` with structured `ChatPromptTemplate`s and returns concise, on-brand responses.

- `web3_agent.py`:
  - Encapsulates all network-facing Web3/market data access (DexScreener, Sui RPC, CoinGecko) and sentiment analysis.
  - `DataFetcher`: shared async HTTP client with retry and an in-memory TTL cache (`CachedData` + `CacheStrategy`) to avoid hammering endpoints.
  - Sui integration: multiple mainnet RPC endpoints with failover for `sui_getCoinMetadata`, `sui_getObject`, etc.
  - Market data: token price/liquidity/volume/change from DexScreener; extended community metrics from CoinGecko.
  - `SentimentAnalyzer`: normalizes crypto slang, removes noise, and uses TextBlob to compute polarity and aggregate sentiment across batches.

- `insights_agent.py`:
  - `Web3Agent` client plus Gemini prompts to produce rich, structured token insights resembling Binance AI-style reports.
  - Builds `StructuredInsights` dataclass (overview, TLDR, technical signals, market metrics, positives/risks, community sentiment, data sources).
  - Formats output either as Markdown for chat display or as JSON for API usage.

- `alerts_agent.py`:
  - Combines:
    - `DatabaseClient` ↔ Supabase.
    - `TaskManager` for CRUD on `tasks` and `task_reminders` (including reminder scheduling metadata).
    - `TaskExtractor`, a LangChain/Gemini-backed parser that turns natural language into structured `TaskExtraction`/`MultipleTaskExtraction` models, handling time zones and special phrases like "in a minute" or "twice daily".
  - `alerts_agent_tool_async(query, context)`: entrypoint that:
    - Parses `context` for `user_id`/`timezone` hints.
    - Handles task listing/completion/deletion shortcuts.
    - Otherwise extracts one or more tasks and creates them via Supabase, returning human-readable summaries.
  - This function is designed to be registered as a tool in the main agent graph.

## Telegram bot and on-chain integration

There are two main generations of Telegram bot code; the current integration is via `app/main.py` and `app/telegram_bot/`.

### Integrated Telegram bot (`app/telegram_bot`)

- `app/telegram_bot/telegram_bot.py`:
  - Implements the primary Telegram bot for Tovira with:
    - A registration system that anchors user identity to Sui on-chain profiles and Walrus-encrypted blobs.
    - Session and key management using helper utilities (`get_walrus_client`, `get_key_manager`, `get_sui_client`, `save_user_session`, etc.).
    - Rich registration flows (password setup, key generation, Walrus encryption, blockchain profile creation) coordinated through `TelegramRegistrationSystem` and multiple conversation states.
    - Task/debug commands that query Sui for on-chain tasks and validate encryption/decryption pipelines.
  - Provides `create_telegram_application(token: str) -> Application`, which wires up all command, callback, and conversation handlers and is what `app.main` uses during lifespan startup.

- `app/telegram_bot/bot.py`:
  - Alternate bot wiring that imports handlers from `app.telegram_bot.handlers.*` modules and registers them with a `setup_telegram_bot(token)` helper.
  - This variant is more modular but is not currently the one wired into the FastAPI lifespan (the lifespan uses `telegram_bot.create_telegram_application`).

### Legacy/standalone Telegram bots (top-level `backend/` scripts)

These exist primarily for historical or standalone use and are not invoked by the FastAPI app:

- `backend/copilotbot.py`: original Telegram bot with an `ai.agent.ToviraAgent` integration, its own Supabase client, and reminder scheduler.
- `backend/task_manager.py`: older, more monolithic task creation + email reminder system using APScheduler and SMTP.
- `backend/tasks.py`: simpler Telegram command handler for listing and completing tasks via inline keyboards.

If you need to modify or extend Telegram functionality for the main product, prefer working in `app/telegram_bot/telegram_bot.py` and the utilities it uses, and treat the root-level bots as legacy unless you have a reason to revive them.

## Smart contracts (`contract/telegram_bot`)

The Move package under `contract/telegram_bot` defines on-chain primitives for the bot.

- `Move.toml` names the package `telegram_bot` and defines a named address `telegram_bot`.
- `sources/user_management.move`:
  - `UserProfile`: on-chain representation of a Telegram user with Sui address, plan type, subscription expiry, points, referrals, and timestamps.
  - `UserRegistry`: global registry tracking total users and admin address.
  - Events: `UserRegistered`, `PlanUpgraded` to notify off-chain systems.
  - Entry functions to register users, upgrade their plan, and manipulate points/referrals/last check-in.
- `sources/subscription.move`:
  - `Treasury`: holds SUI balances and revenue counters.
  - `SubscriptionRecord`: per-user record of subscription term, amount, and auto-renew preference.
  - Constants for monthly/annual subscription types, pricing (in MIST), and durations.
  - `purchase_subscription` and `renew_subscription`: validate payment, update `UserProfile` via `user_management::upgrade_plan`, and emit events.
  - `withdraw_funds`: admin-only withdrawal from the treasury.

These contracts are expected to be used by the Telegram bot’s Sui client for on-chain premium access, points, and subscription logic.

## Frontend architecture

### Dashboard app (`app/`)

- Vite-based React SPA with TypeScript.
- `vite.config.ts`:
  - Uses `@vitejs/plugin-react` and `@tailwindcss/vite`.
  - Aliases `"@"` to `./src`, and configures the dev server to listen on port `5173` and accept hosts like `tovira.xyz` and `tovira.onrender.com`.
- `src/main.tsx` sets up `BrowserRouter` and renders `App` inside `React.StrictMode`.
- `src/App.tsx` defines the main route structure:
  - `AppLayout` as the top-level shell, with nested routes for `/agents`, `/activity`, `/account`.
  - A `Dashboard` route at `/`, with optional `/:chatId` param for deep-linking into a specific chat.
  - `ToastContainer` from `react-toastify` is mounted at the root for global notifications.
- Pages and components under `src/pages` and `src/components` handle:
  - Chat UI bound to `/api/chat` and `/api/chat/stream`.
  - Task and event views backed by `/api/tasks` and `/api/events`.
  - Account/leaderboard views backed by `/api/account` and related endpoints.

When adding new API features, follow the existing pattern: add a router in `backend/app/api/routers`, Pydantic schemas in `backend/app/schemas`, and corresponding React hooks/pages under `app/src` that call the `/api/...` endpoints.

### Marketing app (`frontend/`)

- Also a Vite + React + TypeScript app with the same tooling configuration as `app/` (alias `"@"` to `./src`, Tailwind + React plugin).
- `src/main.tsx` and `src/App.tsx` define a simpler routing tree:
  - `LandingPageLayout` at `/` with a single `Home` route.
- This app is appropriate for marketing/landing experiences, while `app/` is the logged-in dashboard.

## Notes for future Warp agents

- Prefer modifying the FastAPI app (`backend/app/main.py` and `backend/app/api/routers/...`) and the integrated Telegram bot in `backend/app/telegram_bot/` when implementing new backend features.
- Reuse the existing agent abstractions in `backend/app/services/agents/` for any AI-related work instead of calling LLMs directly from routers.
- Keep Supabase access behind `get_supabase_client()` and follow the existing pattern of per-feature routers rather than mixing SQL/HTTP logic inside agents or UI code.
- Coordinate frontend changes with backend routes: new endpoints should be surfaced via typed fetch layers or hooks in the React apps rather than ad hoc `fetch` calls scattered across components.
