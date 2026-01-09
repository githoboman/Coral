import { AgentState } from "../types";
import { researchWithGraph } from "../graph/researchGraph";

export async function researchNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('[RESEARCH NODE] Checking signature requirement...');
  console.log('[RESEARCH NODE] requiresFee:', state.requiresFee);
  console.log('[RESEARCH NODE] gasPaid:', state.gasPaid);
  console.log('[RESEARCH NODE] transactionHash:', state.transactionHash ? 'Present' : 'Not present');

  // Check if gas payment is required and was paid
  if (state.requiresFee && !state.gasPaid) {
    console.log('[RESEARCH NODE] Signature not provided - blocking execution');
    return {
      finalResponse: "✍️ **Signature Required**\n\nThe Research Agent requires your signature to run this query. Please sign the message to proceed with your research.",
      error: "Signature not provided",
    };
  }

  console.log('[RESEARCH NODE] Signature verified - executing research');
  return researchWithGraph(state);
}
