import { pipeline } from '@xenova/transformers';
import { AgentState, IntentType, AgentType } from "../types";

/**
 * Singleton for the classification pipeline to avoid reloading the model.
 */
class RouterClassifier {
  private static instance: any = null;
  private static loading = false;

  static async getInstance() {
    if (this.instance) return this.instance;
    if (this.loading) {
      // Wait for it to load if another request is already loading it
      while (this.loading) await new Promise(r => setTimeout(r, 100));
      return this.instance;
    }

    this.loading = true;
    console.log('[ROUTER] Loading local transformer model (Xenova/distilbert-base-uncased-mnli)...');
    try {
      this.instance = await pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
      console.log('[ROUTER] Local model loaded successfully.');
    } catch (err) {
      console.error('[ROUTER] Failed to load local model:', err);
    } finally {
      this.loading = false;
    }
    return this.instance;
  }
}

/**
 * Tovira's Router Node - Temporarily disabled in favor of manual agent selection.
 */
export async function routerNode(state: AgentState): Promise<Partial<AgentState>> {
  const query = state.userQuery || "";
  const lowerQuery = query.toLowerCase();

  // Respect the pre-selected agent if provided from the frontend
  if (state.targetAgent && state.targetAgent !== "main") {
    console.log(`[ROUTER] Using pre-selected agent: ${state.targetAgent}`);
    const selectedAgent = state.targetAgent as AgentType;
    let intent = IntentType.CHAT;
    let requiresFee = false;
    let estimatedCost = 0;

    if (selectedAgent === AgentType.RESEARCH) {
      intent = IntentType.RESEARCH;
      requiresFee = true;
      estimatedCost = 0.0008;
    } else if (selectedAgent === AgentType.TASK) {
      intent = IntentType.TASK;
    } else if (selectedAgent === AgentType.ALERT) {
      intent = IntentType.ALERT;
    }

    return { intent, targetAgent: selectedAgent, requiresFee, estimatedCost };
  }

  console.log(`[ROUTER] No agent selected, defaulting to MAIN. Query: "${query}"`);

  /* AUTOMATIC ROUTING DISABLED AS REQUESTED
  try {
    const classifier = await RouterClassifier.getInstance();
    if (!classifier) throw new Error("Classifier not available");
    // ... logic ...
  } catch (error) {
    console.warn(`[ROUTER] Hybrid classification failed`, error);
  }
  */

  return { intent: IntentType.CHAT, targetAgent: AgentType.MAIN, requiresFee: false, estimatedCost: 0 };
}
