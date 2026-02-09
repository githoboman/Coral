import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tavilySearch } from "../tools/tavily";
import { getWalletBalance } from "../tools/sui";
import { extractMessageContent } from "../utils";

export async function mainNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.7,
  });

  const systemPrompt = `You are Tovira, an AI assistant specialized in Web3, cryptocurrency, and the Sui blockchain ecosystem.

Your capabilities:
- Answer questions about crypto, DeFi, and Web3
- Explain blockchain concepts
- Provide information about the Sui ecosystem
- Help users understand crypto terminology
- Offer general guidance on crypto topics
- Check user wallet balances using 'get_wallet_balance' (Pass the user's wallet address if they ask about 'my funds' or 'how much I have')
- Search the web for real-time information and latest news using the 'tavily_search' tool

If the user asks for current prices, news, or recent events, USE the search tool.

Provide a helpful, informative response. Be:
- Extremely concise and to the point. Avoid fluff.
- Summarize long information.
- Educational when appropriate.
- Friendly and approachable.
- Accurate and up-to-date.

CRITICAL: At the very end of your response, strictly provide 2-3 short, suggestive follow-up questions that the user might want to ask next. Format them as a list.

Format your response in markdown with proper formatting for readability.

USER CONTEXT:
- Wallet Address: ${state.walletAddress || "Not connected"}
`;

  // FAST PATH: Check for simple greetings or thanks to avoid LLM call
  const query = (state.userQuery || "").toLowerCase().trim();
  const greetings = ["hi", "hello", "hey", "gm", "good morning", "good evening", "tovira", "who are you"];
  const thanks = ["thanks", "thank you", "thx", "appreciate it"];

  if (greetings.includes(query)) {
    return {
      finalResponse: "Hello! I'm Tovira, your Sui blockchain assistant. How can I help you today?\n\n- What's my wallet balance?\n- Research the latest SUI news\n- Send SUI to an address"
    };
  }

  if (thanks.includes(query)) {
    return {
      finalResponse: "You're very welcome! Let me know if there's anything else you need help with."
    };
  }

  try {
    // Combine system prompt with conversation history
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages
    ];

    // Bind tools to the LLM
    const llmWithTools = llm.bindTools([tavilySearch, getWalletBalance]);

    // First call to the model
    const response = await llmWithTools.invoke(messages);

    // Check for tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolCalls = response.tool_calls;

      // Execute tools in parallel
      const toolMessages = await Promise.all(toolCalls.map(async (toolCall) => {
        console.log(`Executing tool ${toolCall.name}:`, toolCall.args);

        let content = "";
        if (toolCall.name === 'tavily_search') {
          content = await tavilySearch.invoke(toolCall.args as { query: string });
        } else if (toolCall.name === 'get_wallet_balance') {
          content = await getWalletBalance.invoke(toolCall.args as { address: string });
        }

        return new ToolMessage({
          tool_call_id: toolCall.id!,
          content: content,
        });
      }));

      // Add tool results to messages and call model again
      const finalResponse = await llmWithTools.invoke([
        ...messages,
        response,
        ...toolMessages
      ]);

      return {
        finalResponse: extractMessageContent(finalResponse),
      };
    }

    // No tool calls, return original response
    return {
      finalResponse: extractMessageContent(response),
    };
  } catch (error) {
    console.error('Main node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error. Please try rephrasing your question.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
