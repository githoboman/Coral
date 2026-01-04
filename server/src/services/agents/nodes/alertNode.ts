import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";

export async function alertNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.5,
  });

  const systemPrompt = `You are Tovira Alert Agent, specialized in setting up price alerts, wallet monitoring, and notifications for crypto users.

Your capabilities:
- Set price alerts for tokens
- Monitor wallet transactions
- Track whale movements
- Set up custom notifications
- Monitor DeFi positions
- Alert on market events

User Query: "${state.userQuery}"

Help the user by:
1. Understanding what they want to be alerted about
2. Suggesting appropriate alert parameters (price levels, conditions, etc.)
3. Explaining how the alerts will work
4. Offering to set up the alerts

Be proactive, clear, and helpful. Format your response in markdown.`;

  try {
    const response = await llm.invoke(systemPrompt);

    return {
      finalResponse: response.content as string,
    };
  } catch (error) {
    console.error('Alert node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error while setting up your alert. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
