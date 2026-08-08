/**
 * Autonomous Agent Wallet — public surface.
 *
 * The agent acts under an on-chain AgentPolicy (shared Move object) that enforces
 * budget, protocol whitelist, asset scope, action scope, expiry and pause/revoke.
 * The server holds an Ed25519 agent key and signs policy-guarded PTBs; the Move
 * contract is the authoritative constraint layer, so the key alone cannot exceed
 * its mandate. See README.md for architecture.
 */

// Wallet lifecycle
export { getAgentWalletInitializer, AgentWalletInitializer } from "./init.js";
export { getAgentKeypairService } from "./keypair.js";
export { getAgentWalletStore } from "./store.js";

// Execution engine
export { getPolicyChecker } from "./policyChecker.js";
export { getBudgetTracker } from "./budgetTracker.js";
export { getAgentPtbBuilder } from "./ptbBuilder.js";
export { getAgentExecutor } from "./executor.js";

// DeepBook + agents
export { AgentDeepBookClient } from "./deepbookClient.js";
export { getSwapAgent } from "./swapAgent.js";
export { getOrderManager } from "./orderManager.js";
export { bootstrapBalanceManager } from "./deepbookSetup.js";

// Strategies
export {
  executePercentageSwap,
  scheduleSwap,
  watchPriceCondition,
} from "./strategies.js";

// Owner controls
export { buildCreatePolicyTx, extractCreatedIds } from "./owner/policyCreator.js";
export { buildPauseTx, buildResumeTx } from "./owner/pauseResume.js";
export { cleanupAndSweep, buildRevokeTx } from "./owner/revocation.js";

// Observability
export { getAgentAlerts } from "./alerts.js";
export { getWalrusArchiver } from "./walrusArchiver.js";

// Types / config
export * from "./types.js";
export {
  getAgentPolicyConfig,
  assetTypeFor,
  deepbookProtocolId,
  CLOCK_OBJECT_ID,
} from "./config.js";
