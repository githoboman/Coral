# Tovira Upgrade Progress Tracker
## From Reactive Tool to Proactive Web3 Companion

> **Last Updated**: 2026-02-20
> **Current Phase**: Phase 4 -- Safe Simulations for Web3 Actions (COMPLETE)

---

## Phase 1: Enhance Core Foundations (Prep for Proactivity)
**Goal**: Solidify the base with user state management and event monitoring to support proactive behaviors.

### 1.1 User State Management
- [x] Expand Supabase schema: `user_state` table (wallet snapshots, interaction patterns, preferences)
- [x] Wallet scan on login/connect via Sui RPC (`suix_getOwnedObjects`, recent txs)
- [x] Store snapshots without constant polling
- [x] Encrypt sensitive data; add opt-out toggle for tracking
- [x] Add user preferences (risk tolerance, notification frequency)

### 1.2 Event Monitoring Setup
- [x] Lightweight event listeners using Sui RPC WebSocket subscriptions
- [x] Event filters: new token received, balance change >X%, staking rewards, NFT mint/transfer
- [x] Noise suppression: thresholds (e.g., ignore micro-txs <0.1 SUI)
- [x] Pipe events to research agent for contextual analysis
- [x] Limit to 5-10 tracked items per user initially

### 1.3 Testing
- [x] Unit tests for state persistence (user state CRUD)
- [x] Unit tests for event filtering logic
- [x] Simulate Sui testnet events end-to-end
- [x] Performance benchmarks: ensure no degradation with event monitoring active

---

## Phase 2: Inject Proactivity into Task Manager (Make It Anticipatory)
**Goal**: Shift from user-driven to assistant-driven suggestions. Tovira notices events and proposes actions.

### 2.1 Auto-Suggestion Engine
- [x] Wallet event triggers (e.g., new SUI received -> suggest staking/portfolio check)
- [x] Post-research triggers (e.g., researched Token X -> suggest price alert)
- [x] Periodic daily scan (epoch changes, known airdrops via Tavily)
- [x] Rule-based personalization using interaction history
- [x] Telegram proactive messages with inline buttons ("Yes -- Daily", "Customize", "Ignore")
- [x] Auto-create task on acceptance

### 2.2 Best-Interest Safeguards
- [x] Bias toward safety: risk warnings on volatile assets (Tavily + BlockVision data)
- [x] Spam control: max 2-3 suggestions/session/day
- [x] Learned dismissal: reduce frequency for ignored suggestion types
- [x] Auto-suggest on pain points (e.g., "Staking APR dropped -- research alternatives?")

### 2.3 Implementation
- [x] "Proactive mode" flag on NLP parser
- [x] Cron jobs / event-driven hooks for periodic scans (free-tier friendly, batched)
- [x] Natural-language explanation UX ("Based on your recent trades...")

---

## Phase 3: Chain & Enhance Research Agent (Insight-to-Action Flow)
**Goal**: Make research actionable -- chain outputs to tasks/simulations in the user's best interest.

### 3.1 Chained Workflows
- [x] On query: research (Tavily + BlockVision + Sui RPC) -> summarize -> auto-suggest task/simulation
- [x] Personalize with wallet context ("You hold similar tokens -- risk of correlation?")
- [x] Flag red flags (rug pull heuristics: low holders, volume spikes without news)

### 3.2 Light Sentiment Analysis
- [x] X/Twitter keyword search integration (free-tier API or keyword pulls)
- [x] Rule-based positive/negative scoring
- [x] Chain sentiment with on-chain data ("Buzz high on X, but dumps detected -- watch closely?")

### 3.3 Implementation
- [x] LangChain/LangGraph chaining: add post-processing step for suggestions
- [x] Error handling: graceful fallback, always explain data sources
- [x] Transparency: cite Tavily, BlockVision, RPC sources in responses


---

## Phase 4: Introduce Safe Simulations for Web3 Actions (COMPLETE)
**Goal**: Add "what-if" power without risk. Dry-run transactions via Sui SDK to advise users.

### 4.1 Simulation Engine
- [x] Trigger on user query or proactive suggestion ("Price pump -- simulate sell?")
- [x] Scope: swaps on Sui DEXes (Cetus), reward claims, simple transfers (no leverage)
- [x] Build tx via Sui SDK dry-run: estimate gas, slippage, output
- [x] Output narrative: "Simulated: Swapping 10 SUI -> ~X tokens, gas 0.001 SUI, 2% slippage"
- [x] Suggest real execution -> prompt wallet sign in Telegram

### 4.2 Best-Interest Safeguards
- [x] Include warnings ("High slippage -- wait 30min?")
- [x] Suggest alternatives ("Better APR on staking instead?")
- [x] Never store private keys; all execution user-side
- [x] Audit logs for every simulation

### 4.3 Feedback Loop
- [x] Log sim outcomes; if executed, track real results
- [x] Adjust suggestions based on user patterns (low-slippage preference)


---

## Phase 5: Deployment, Testing, & Iteration
**Goal**: Staged rollout, metrics, iteration.

### 5.1 Rollout
- [ ] Internal testing
- [ ] Opt-in for testnet users (announce on X)
- [ ] Metrics: task creations from suggestions, sim usages, retention

### 5.2 Feedback Integration
- [ ] In-app polls
- [ ] Monitor X/Discord for user reactions
- [ ] Iterate based on "too intrusive" feedback -- add more controls

### 5.3 Scalability
- [ ] Use event-driven (websockets) over polling
- [ ] Limit concurrent simulations
- [ ] Handle Sui network congestion and API rate limits gracefully

---

## Architecture Notes (Current State)

| Component | File | Status |
|---|---|---|
| User profiles | `walrusUserManager.ts` | Active (Walrus + encryption) |
| Task storage | `taskStorageService.ts` | Active (Supabase `tasks` table) |
| Research agent | `researchAgent.ts` | Active (LangGraph + Tavily + BlockVision) |
| Task manager agent | `taskManagerAgent.ts` | Active (LangGraph intent extraction) |
| RPC manager | `rpcManager.ts` | Active (10 endpoints, round-robin) |
| On-chain indexer | `suiIndexerService.ts` | Active (RPC fallback for BlockVision) |
| Scheduler | `scheduler.ts` | Active (cron, task due checks) |
| Notifications | `notificationService.ts` | Active (Telegram + Email) |
| Telegram bot | `telegramService.ts` | Active (Telegraf, account linking) |
| Simulation | `simulationService.ts` | Active (Dry-runs + audit logs) |

---

## Legend
- `[ ]` Not started
- `[/]` In progress
- `[x]` Completed
