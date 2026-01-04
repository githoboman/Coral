import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";

export async function taskNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.5,
  });

  const systemPrompt = `You are Tovira Task Agent, specialized in helping users automate Web3 tasks and manage their crypto activities.

Your capabilities:
- Create and manage tasks and reminders
- Schedule token swaps and trades
- Set up automated actions
- Manage DeFi positions
- Create recurring tasks
- Organize crypto-related activities

User Query: "${state.userQuery}"

Help the user by:
1. Understanding their task requirements
2. Suggesting the best approach
3. Providing clear, actionable steps
4. Offering to create tasks or reminders if needed

Be action-oriented, clear, and helpful. Format your response in markdown.`;

  try {
    const response = await llm.invoke(systemPrompt);

    return {
      finalResponse: response.content as string,
    };
  } catch (error) {
    console.error('Task node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error while processing your task request. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
