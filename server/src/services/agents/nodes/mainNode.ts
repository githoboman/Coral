import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../types";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tavilySearch } from "../tools/tavily";

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
- Search the web for real-time information and latest news using the 'tavily_search' tool

If the user asks for current prices, news, or recent events, USE the search tool.

Provide a helpful, informative response. Be:
- Extremely concise and to the point. Avoid fluff.
- Summarize long information.
- Educational when appropriate.
- Friendly and approachable.
- Accurate and up-to-date.

CRITICAL: At the very end of your response, strictly provide 2-3 short, suggestive follow-up questions that the user might want to ask next. Format them as a list.

Format your response in markdown with proper formatting for readability.`;

  try {
    // Combine system prompt with conversation history
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages
    ];

    // Bind tools to the LLM
    const llmWithTools = llm.bindTools([tavilySearch]);

    // First call to the model
    const response = await llmWithTools.invoke(messages);

    // Check for tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolCalls = response.tool_calls;
      const toolMessages = [];

      // Execute tools
      for (const toolCall of toolCalls) {
        if (toolCall.name === 'tavily_search') {
          console.log(`Executing tool ${toolCall.name}:`, toolCall.args);
          const toolResult = await tavilySearch.invoke(toolCall.args as { query: string });

          toolMessages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: toolCall.name,
            content: toolResult
          });
        }
      }

      // Add tool results to messages and call model again
      // Note: We need to cast response and tool messages to match LangChain types if strict typing is enforced,
      // but for now we pass them as part of the conversation flow.
      // We append the assistant's request (response) and the tool outputs.

      const finalResponse = await llmWithTools.invoke([
        ...messages,
        response,
        ...toolMessages as any
      ]);

      return {
        finalResponse: finalResponse.content as string,
      };
    }

    // No tool calls, return original response
    return {
      finalResponse: response.content as string,
    };
  } catch (error) {
    console.error('Main node error:', error);
    return {
      finalResponse: "I apologize, but I encountered an error. Please try rephrasing your question.",
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
