import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { Annotation, StateGraph, messagesStateReducer } from "@langchain/langgraph";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";
import { getBlockVisionService } from "../blockVisionService";
import { getUserStateService } from "../userStateService";
import { getRedFlagService } from "../redFlagService";
import { getSentimentService } from "../sentimentService";
import type { ChatRequest, createSSEWriter } from "./agentTypes";

// ======================================================================
// STATE
// ======================================================================

const ResearchState = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: messagesStateReducer,
  }),
  query: Annotation<string>,
  walletAddress: Annotation<string>,
  walletContext: Annotation<string>,
  sse: Annotation<ReturnType<typeof createSSEWriter>>,
  steps: Annotation<string[]>,
  finalReport: Annotation<string>,
});

// ======================================================================
// SERVICES
// ======================================================================

// Tavily Tool
const tavilyTool = new TavilySearch({
  maxResults: 5,
  topic: "general",
  searchDepth: "basic",
});

// BlockVision Wrapper
const blockVision = getBlockVisionService();

const BlockVisionTool = {
  name: "blockvision_analyze",
  description:
    "Analyze onchain data for Sui addresses, tokens, or NFTs. Use this for wallet analysis or portfolio checks.",
  schema: z.object({
    type: z
      .enum(["portfolio", "token", "nfts"])
      .describe("Type of analysis: 'portfolio' for wallet addresses, 'token' for specific coin types (0x...::module::Token), 'nfts' for wallet assets."),
    target: z.string().describe("The Address (0x...) or Coin Type to analyze"),
  }),
  func: async ({ type, target }: { type: string; target: string }) => {
    if (type === "portfolio") {
      const data = await blockVision.getAccountPortfolio(target);
      return {
        totalValue: `$${data.totalValue.toFixed(2)}`,
        topCoins: data.coins
          .slice(0, 5)
          .map(
            (c: any) => `${c.symbol}: ${c.balance} ($${c.valueUsd?.toFixed(2)})`
          ),
      };
    }
    if (type === "token") {
      const info = await blockVision.getTokenInfo(target);
      if (!info) return "No data found for this token.";
      return {
        name: info.name,
        symbol: info.symbol,
        price: `$${info.price.toFixed(10)}`,
        change24h: `${info.change24h.toFixed(2)}%`,
        decimals: info.decimals,
        holders: info.holders,
        marketCap: info.marketCap ? `$${info.marketCap.toLocaleString()}` : undefined,
        verified: info.verified ? "Yes" : "No",
      };
    }
    if (type === "nfts") {
      const nfts = await blockVision.getNFTs(target);
      return nfts.slice(0, 5).map((n) => n.name);
    }
    return "Unknown analysis type";
  },
};

// Phase 4: Simulation Tool
const SimulationTool = {
  name: "simulate_action",
  description:
    "Simulate a Sui blockchain transaction without executing it. Use this when the user asks 'what if', 'simulate', or wants to preview a transfer, swap, or staking action. Returns estimated gas, warnings, and a human-readable narrative.",
  schema: z.object({
    type: z
      .enum(["transfer", "swap", "stake"])
      .describe("Type of simulation"),
    amount: z.string().describe("Amount to simulate (in human units, e.g. '10' for 10 SUI)"),
    coinType: z.string().optional().describe("Coin type for transfers (default: 0x2::sui::SUI)"),
    recipient: z.string().optional().describe("Recipient address for transfers"),
    targetCoin: z.string().optional().describe("Target coin symbol for swaps (e.g. 'USDC')"),
    validatorAddress: z.string().optional().describe("Validator address for staking"),
  }),
  // func is handled in toolNode via lazy import
};

// ── LLM with tools (used in researchNode only) ──
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
}).bindTools([tavilyTool, BlockVisionTool, SimulationTool]);

// ── LLM without tools (used in reportNode to avoid Gemini re-ingestion errors) ──
const reportModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// ======================================================================
// HELPERS
// ======================================================================

/**
 * Strips Gemini-internal metadata (__gemini_function_call_thought_signatures__)
 * from messages before re-ingesting them into a new model.invoke() call.
 * Feeding this metadata back to the Gemini API causes:
 *   TypeError: Cannot read properties of undefined (reading 'message')
 */
function sanitizeMessages(messages: any[]): any[] {
  return messages.map((msg) => {
    // Detect AI Message
    const isAI = msg?._getType?.() === "ai" || msg?.type === "ai" || (msg?.id?.join?.(".")?.includes?.("AIMessage"));

    if (isAI) {
      // Reconstruct as a clean AIMessage to ensure proper prototype and kwargs
      const toolCalls = msg.tool_calls || msg.kwargs?.tool_calls || [];
      const content = extractContent(msg);

      // Strip internal problematic signatures from additional_kwargs
      const cleanAdditional = { ...(msg.kwargs?.additional_kwargs || {}) };
      delete cleanAdditional.__gemini_function_call_thought_signatures__;

      return new AIMessage({
        content,
        tool_calls: toolCalls,
        additional_kwargs: cleanAdditional,
      });
    }

    if (msg?._getType?.() === "tool" || msg?.type === "tool") {
      return new ToolMessage({
        content: msg.content,
        tool_call_id: msg.tool_call_id || msg.kwargs?.tool_call_id,
        name: msg.name || msg.kwargs?.name,
      });
    }

    return msg;
  });
}

/**
 * Extracts plain string content from a LangChain message object,
 * handling both raw messages and LangChain constructor-wrapped objects.
 */
function extractContent(msg: any): string {
  if (!msg) return "";
  const content = msg.content ?? msg.kwargs?.content;
  if (!content) return "";

  if (typeof content === "string") return content;

  // Handle Gemini/LangChain array of parts
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        return part.text || part.content || "";
      })
      .join("");
  }

  return "";
}

/**
 * FIX: Returns true only if the last message is a genuine AI text answer.
 * Previously, this function would accept Gemini's hallucinated tool-call text
 * (e.g. `print(default_api.sui_rpc_get_total_supply(...))`) as a valid direct
 * answer because it had no tool_calls and non-empty content.
 *
 * Now we explicitly reject content that looks like raw tool invocations or
 * code blocks, which prevents junk from leaking into the final report.
 */
function hasDirectAnswer(messages: any[]): boolean {
  const last = messages[messages.length - 1];
  if (!last) return false;

  const isAIMessage =
    last?.kwargs !== undefined
      ? last?.id?.includes?.("AIMessage") ||
      last?.id?.join?.(".")?.includes?.("AIMessage")
      : last?._getType?.() === "ai" ||
      last?.type === "ai";

  if (!isAIMessage) return false;

  const toolCalls = last?.tool_calls ?? last?.kwargs?.tool_calls ?? [];
  const content = extractContent(last);
  const lower = content.toLowerCase();

  // FIX: Detect hallucinated tool-call patterns that Gemini Lite emits as text.
  // These are NOT real answers — they're the model pretending to call tools
  // in plain text instead of using the structured tool_calls mechanism.
  const hasFakeToolCall =
    lower.includes("print(default_api.") ||
    lower.includes("```tool_code") ||
    lower.includes("tool_code") ||
    // Also catch generic code-block tool invocations
    /```[\s\S]*?default_api\.[a-z_]+\(/.test(lower);

  return (
    toolCalls.length === 0 &&
    content.length > 0 &&
    !hasFakeToolCall &&
    !lower.startsWith("i am sorry") &&
    !lower.startsWith("i cannot") &&
    !lower.startsWith("i'm sorry")
  );
}

/**
 * Extracts token symbols mentioned in a query for sentiment/red-flag analysis.
 */
function extractTokenMentions(text: string): string[] {
  // Match known tokens and any ALLCAPS 2-6 letter words that look like tickers
  const knownTokens = ["SUI", "USDC", "USDT", "BTC", "ETH", "CETUS", "TURBOS", "NAVI", "SCALLOP", "DEEP", "BLUE"];
  const found: string[] = [];

  for (const token of knownTokens) {
    if (text.toUpperCase().includes(token)) {
      found.push(token);
    }
  }

  // Also match unknown tickers: $TICKER or standalone ALLCAPS 2-6 chars
  const tickerMatches = text.match(/\$([A-Z]{2,6})\b/g);
  if (tickerMatches) {
    for (const match of tickerMatches) {
      const symbol = match.replace("$", "");
      if (!found.includes(symbol)) {
        found.push(symbol);
      }
    }
  }

  return found;
}

/**
 * FIX: Detects whether the raw query is a bare Sui coin type or wallet address
 * with no surrounding context. When users paste a raw address like
 * `0xABC...::clawd::CLAWD`, models tend to get confused and hallucinate tool
 * calls as text. Wrapping the input with explicit intent solves this.
 *
 * Returns a clarified query string, or the original if no transformation needed.
 */
function clarifyQuery(query: string): string {
  const trimmed = query.trim();

  // Matches a fully-qualified Sui coin type: 0x<hex>::<module>::<struct>
  const isCoinType = /^0x[0-9a-fA-F]+::[a-zA-Z_]+::[a-zA-Z_]+$/.test(trimmed);

  // Matches a Sui wallet address: 0x followed by 62-66 hex chars (no ::)
  const isWalletAddress = /^0x[0-9a-fA-F]{62,66}$/.test(trimmed);

  if (isCoinType) {
    return `Perform a detailed 'token' analysis for this Sui coin type and provide a full research report: ${trimmed}`;
  }

  if (isWalletAddress) {
    return `Perform a detailed 'portfolio' analysis for this Sui wallet address and provide a full portfolio and activity report: ${trimmed}`;
  }

  return query;
}

// ======================================================================
// NODES
// ======================================================================

// ── Phase 3: Wallet Context ──────────────────────────────────────────

async function walletContextNode(state: typeof ResearchState.State) {
  const { walletAddress, sse } = state;

  if (!walletAddress) {
    return { walletContext: "" };
  }

  try {
    sse.status("Loading your wallet context...");
    const userState = getUserStateService();
    const uState = await userState.getOrCreateState(walletAddress);

    const snapshot = uState.wallet_snapshot;
    const prefs = uState.preferences;
    const patterns = uState.interaction_patterns;

    // Build compact context string
    const lines: string[] = [];

    // Holdings summary
    if (snapshot?.coins?.length > 0) {
      const holdings = snapshot.coins
        .filter((c) => c.valueUsd && c.valueUsd > 0.01)
        .slice(0, 8)
        .map((c) => `${c.symbol}: ${c.balance} (~$${c.valueUsd?.toFixed(2)})`)
        .join(", ");
      lines.push(`Holdings: ${holdings}`);
      if (snapshot.totalValue > 0) {
        lines.push(`Total portfolio: ~$${snapshot.totalValue.toFixed(2)}`);
      }
    }

    // NFT count
    if (snapshot?.nftCount > 0) {
      lines.push(`NFTs owned: ${snapshot.nftCount}`);
    }

    // Risk tolerance
    lines.push(`Risk profile: ${prefs.risk_tolerance}`);

    // Recently researched tokens
    if (patterns.tokens_researched?.length > 0) {
      lines.push(`Recently researched: ${patterns.tokens_researched.slice(0, 5).join(", ")}`);
    }

    // Tracked items
    if (uState.tracked_items?.length > 0) {
      const tracked = uState.tracked_items
        .slice(0, 5)
        .map((t) => t.label)
        .join(", ");
      lines.push(`Watching: ${tracked}`);
    }

    const context = lines.length > 0
      ? `[User Context]\n${lines.join("\n")}`
      : "";

    return { walletContext: context };
  } catch (err: any) {
    console.warn(`[Research] Wallet context fetch failed: ${err?.message}`);
    return { walletContext: "" };
  }
}

// ── Research Node ────────────────────────────────────────────────────

async function researchNode(state: typeof ResearchState.State) {
  const { query, sse, messages, walletContext } = state;

  sse.status("Researching...");

  // FIX: Clarify bare addresses/coin types before sending to the model.
  // A raw `0x...::module::TOKEN` string gives the LLM no clear intent,
  // increasing the chance it hallucinates tool calls as plain text.
  const clarifiedQuery = clarifyQuery(query);

  // Build system prompt with wallet context
  let systemContent =
    "You are Tovira, a sophisticated AI Research Agent for the Sui blockchain. Your goal is to provide deep, actionable insights into tokens, wallets, and on-chain activity.\n\n" +
    "GUIDELINES:\n" +
    "1. USE 'blockvision_analyze' with type='portfolio' for wallet addresses (0x...).\n" +
    "2. USE 'blockvision_analyze' with type='token' for specific coin types (0x...::module::Token).\n" +
    "3. Use 'tavily_search' for market sentiment, project background, and recent news.\n" +
    "4. Use 'simulate_action' if the user wants to preview a transaction (transfer, swap, or stake). ALWAYS use the provided 'walletAddress' from the user context as the sender.\n" +
    "5. IMPORTANT: You MUST use the available tools to gather data. Do NOT write code or respond from internal memory only.\n" +
    "6. TONE: Professional, helpful, and concise. Avoid technical jargon.\n" +
    "7. PRIVACY & SECRECY (CRITICAL):\n" +
    "   - NEVER reveal the names of your internal tools (e.g., 'blockvision_analyze', 'tavily_search', 'simulate_action').\n" +
    "   - NEVER discuss technical implementation details: no mention of LangChain, Gemini, LLMs, or specific APIs.\n" +
    "   - If asked how you work, explain in high-level, real-world terms: 'I research your request across the Sui blockchain and market data to provide clear, actionable feedback.' or 'I analyze on-chain activity and sentiment to give you a complete picture.'\n" +
    "8. FORMATTING: Always structure findings as a clean Research Report with clear markdown headings (##). Use bolding (**) for emphasis. NEVER cite sources, URLs, or mention tool names.";

  if (walletContext) {
    systemContent += `\n\nUSER CONTEXT:\n${walletContext}\n\nReference these holdings to personalize your report. If you see risks to their portfolio, highlight them gently but clearly.`;
  }

  systemContent += "\n\nDo NOT output raw code blocks or JSON unless explicitly asked.";

  const response = await model.invoke([
    { role: "system", content: systemContent },
    { role: "user", content: clarifiedQuery },
    ...messages,
  ]);

  return { messages: [response] };
}

// ── Tool Node ────────────────────────────────────────────────────────

async function toolNode(state: typeof ResearchState.State) {
  const { messages, sse } = state;
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage.tool_calls?.length) {
    return {};
  }

  sse.status("Gathering data...");

  const results = await Promise.all(
    lastMessage.tool_calls.map(async (call: any) => {
      let content: string;
      try {
        let result;
        if (call.name === "tavily_search") {
          result = await tavilyTool.invoke(call.args);
        } else if (call.name === "blockvision_analyze") {
          result = await BlockVisionTool.func(call.args as any);
        } else if (call.name === "simulate_action") {
          // Lazy import to avoid circular deps and reduce startup cost
          const { getSimulationService } = await import("../simulationService");
          const simService = getSimulationService();
          const args = call.args as any;
          const sender = state.walletAddress;

          sse.status("Running simulation...");

          if (args.type === "transfer") {
            result = await simService.simulateTransfer(
              sender, args.recipient || "", args.amount, args.coinType || "0x2::sui::SUI"
            );
          } else if (args.type === "swap") {
            result = await simService.simulateSwap(
              sender, args.coinType || "SUI", args.targetCoin || "", args.amount
            );
          } else if (args.type === "stake") {
            result = await simService.simulateStake(
              sender, args.validatorAddress || "", args.amount
            );
          } else {
            result = { success: false, narrative: "Unknown simulation type" };
          }
        }
        content = typeof result === "string" ? result : JSON.stringify(result);
      } catch (error: any) {
        content = JSON.stringify({ error: error?.message ?? "Unknown tool error" });
      }
      return new ToolMessage({
        tool_call_id: call.id,
        content,
        name: call.name,
      });
    })
  );

  return { messages: results };
}

// ── Report Node ──────────────────────────────────────────────────────

async function reportNode(state: typeof ResearchState.State) {
  const { messages, sse, walletContext } = state;

  sse.status("Synthesizing report...");

  // FIX: hasDirectAnswer now rejects hallucinated tool-call text (e.g. 
  // `print(default_api.sui_rpc_get_total_supply(...))`). If the model output 
  // genuine junk, fall through to reportModel for a clean synthesis pass.
  if (hasDirectAnswer(messages)) {
    const directAnswer = extractContent(messages[messages.length - 1]);
    return { finalReport: directAnswer };
  }

  // Sanitize messages before re-ingesting into Gemini
  const cleanMessages = sanitizeMessages(messages);

  let reportSystemPrompt =
    "Synthesize the gathered research into a premium quality report. Do NOT cite sources, URLs, or mention which tools were used (Tavily, BlockVision, etc.). Present the information as your own unified analysis.\n\n" +
    "STRUCTURE:\n" +
    "1. **Executive Summary**: A 1-2 sentence overview.\n" +
    "2. **On-Chain Analysis**: Holder distribution, liquidity, or wallet activity (from BlockVision/RPC).\n" +
    "3. **Market Context**: Sentiment and news (from Tavily). DO NOT include links or source references.\n" +
    "4. **Tovira's Verdict**: A final summary of the asset's risk/opportunity profile.\n\n" +
    "STYLE:\n" +
    "- Use professional markdown (headers, bolding, lists).\n" +
    "- Be objective and data-driven.\n" +
    "- Do NOT output raw tool results or backticks-wrapped code unless it's a specific simulation narrative.\n" +
    "- REMINDER: No source links or URLs allowed.";

  if (walletContext) {
    reportSystemPrompt += "\n\n**Portfolio Impact**: Add a section explaining how this data affects the user's specific holdings.";
  }

  const response = await reportModel.invoke([
    { role: "system", content: reportSystemPrompt },
    { role: "user", content: state.query },
    ...cleanMessages,
  ]);

  return { finalReport: response.content as string };
}

// ── Phase 3: Post-Processor Node ─────────────────────────────────────

async function postProcessorNode(state: typeof ResearchState.State) {
  const { finalReport, query, walletAddress, sse } = state;

  if (!finalReport || finalReport.length < 50) {
    return {};
  }

  const tokens = extractTokenMentions(query);

  // Optimization: Extract tokens AND their coin types from tool results if possible
  const tokenData: Array<{ symbol: string, coinType?: string }> = tokens.map((t: string) => ({ symbol: t }));

  // Skip enrichment for generic queries with no token mentions
  if (tokenData.length === 0) {
    return {};
  }

  sse.status("Analyzing risks and sentiment...");

  let enrichment = "";

  try {
    // Run red flag analysis and sentiment in parallel for each token
    const redFlagService = getRedFlagService();
    const sentimentService = getSentimentService();

    // Get user risk tolerance for warning calibration
    let riskTolerance = "moderate";
    try {
      const userState = getUserStateService();
      const prefs = await userState.getPreferences(walletAddress);
      riskTolerance = prefs.risk_tolerance;
    } catch { }

    // Skip well-known majors for red flag checks (but still do sentiment)
    const safeMajors = ["SUI", "BTC", "ETH", "USDC", "USDT"];

    for (const data of tokenData.slice(0, 3)) { // cap at 3 tokens to avoid slowness
      const symbol = data.symbol;
      const coinType = data.coinType;
      const isMajor = safeMajors.includes(symbol);

      const [flags, sentiment] = await Promise.allSettled([
        (isMajor || !coinType)
          ? Promise.resolve([])
          : redFlagService.analyzeToken(coinType, symbol),
        sentimentService.analyzeSentiment(symbol),
      ]);

      // Append red flag warnings
      if (flags.status === "fulfilled" && flags.value.length > 0) {
        enrichment += redFlagService.generateWarnings(flags.value, riskTolerance);
      }

      // Append sentiment
      if (sentiment.status === "fulfilled") {
        enrichment += sentimentService.formatForReport(sentiment.value);
      }
    }
  } catch (err: any) {
    console.warn(`[Research] Post-processing enrichment failed: ${err?.message}`);
  }

  if (enrichment) {
    return { finalReport: finalReport + enrichment };
  }

  return {};
}

// ======================================================================
// GRAPH
// ======================================================================

const graph = new StateGraph(ResearchState)
  .addNode("fetchContext", walletContextNode)
  .addNode("research", researchNode)
  .addNode("tools", toolNode)
  .addNode("report", reportNode)
  .addNode("postProcessor", postProcessorNode)
  .addEdge("__start__", "fetchContext")
  .addEdge("fetchContext", "research")
  .addConditionalEdges("research", (state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    return lastMsg.tool_calls?.length ? "tools" : "report";
  })
  .addEdge("tools", "report")
  .addEdge("report", "postProcessor")
  .addEdge("postProcessor", "__end__")
  .compile();

// ======================================================================
// EXPORT
// ======================================================================

export const researchAgent = {
  handle: async (
    req: ChatRequest,
    sse: ReturnType<typeof createSSEWriter>
  ) => {
    try {
      const finalState = await graph.invoke({
        query: req.message,
        walletAddress: req.userId,
        walletContext: "",
        sse,
        messages: [],
        steps: [],
        finalReport: "",
      });

      sse.chunk(finalState.finalReport);
      sse.action({ type: "research_completed" });
      sse.done();
      return finalState.finalReport;
    } catch (error) {
      console.error("Research Agent Error:", error);
      sse.error("Research failed. Please try again.");
      return "Error";
    }
  },
};

export const getResearchAgent = () => researchAgent;