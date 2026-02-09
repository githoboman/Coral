import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { tavilySearch } from "../tools/tavily";
import { suiTools } from "../tools/sui";
import { AgentState, WorkflowStep } from "../types";
import { extractMessageContent } from "../utils";

// Combine all research tools
const tools = [tavilySearch, ...suiTools];

// Create the research agent with tools
function createResearchAgent() {
  const model = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.3,
  }).bindTools(tools);

  return model;
}

// Agent node - makes decisions and calls tools
async function agentNode(state: typeof MessagesAnnotation.State) {
  const model = createResearchAgent();
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// Router function - decides whether to continue to tools or end
function shouldContinue(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  // If there are tool calls, continue to tools node
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }

  // Otherwise, end the workflow
  return END;
}

// Create the StateGraph workflow
export function createResearchWorkflow() {
  const workflow = new StateGraph(MessagesAnnotation)
    // Add nodes
    .addNode("agent", agentNode)
    .addNode("tools", new ToolNode(tools))

    // Add edges
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  return workflow.compile();
}

// Main research function that integrates with existing AgentState
export async function researchWithGraph(state: AgentState): Promise<Partial<AgentState>> {
  const workflow = createResearchWorkflow();

  // Initialize workflow steps
  const steps: WorkflowStep[] = [
    { step: "Analyzing query", status: "completed", message: "Understanding research request..." },
    { step: "Planning research", status: "running", message: "Determining research strategy..." },
  ];

  try {
    const systemPrompt = `You are Tovira Research Agent, a specialized AI for comprehensive cryptocurrency research and analysis.

Your capabilities:
- Web search for recent news, documentation, and market data
- Sui blockchain queries for on-chain verification
- Token fundamental analysis
- NFT and DeFi protocol research

Research Strategy:
1. For RECENT information (prices, news, events): Use web_search first
2. For ON-CHAIN data (ownership, supply, contracts): Use sui_object_lookup or sui_coin_metadata
3. ALWAYS verify claims with multiple sources
4. Cite your sources with URLs

User Query: "${state.userQuery}"

Provide a thorough, data-driven research report with:
- **Overview**: Brief summary
- **Key Findings**: Main discoveries from your research
- **On-Chain Data**: Verified blockchain information (if applicable)
- **Market Context**: Recent news and trends
- **Sources**: List all URLs and data sources used

Format in clear markdown with headers and bullet points.`;

    // Run the workflow
    const result = await workflow.invoke({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: state.userQuery },
      ],
    });

    // Extract final response
    const messages = result.messages as BaseMessage[];
    const finalMessage = messages[messages.length - 1];
    const finalResponse = extractMessageContent(finalMessage);

    // Update all steps to completed
    const completedSteps = [
      { step: "Analyzing query", status: "completed" as const, message: "Query analyzed" },
      { step: "Gathering data", status: "completed" as const, message: "Data collected from web and blockchain" },
      { step: "Analyzing findings", status: "completed" as const, message: "Research synthesized" },
      { step: "Generating report", status: "completed" as const, message: "Report complete" },
    ];

    return {
      finalResponse,
      workflowSteps: completedSteps,
    };
  } catch (error) {
    console.error('Research workflow error:', error);

    const errorSteps = steps.map(s => ({ ...s, status: 'failed' as const }));

    return {
      finalResponse: "I apologize, but I encountered an error while conducting the research. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error',
      workflowSteps: errorSteps,
    };
  }
}
