import { AgentState } from "../types";
import { researchWithGraph } from "../graph/researchGraph";

export async function researchNode(state: AgentState): Promise<Partial<AgentState>> {
  return researchWithGraph(state);
}
