// server/src/services/agents/bridgeAgent.ts
//
// ARCHITECTURE:
//   The agent lives entirely server-side. Its job is:
//     1. Parse the user's natural-language bridge intent via LLM
//     2. Validate amounts against configured min/max
//     3. Return a structured `bridge_transaction_ready` action event
//        containing the serialised unsigned transaction + all display metadata
//
//   The frontend (Dashboard.tsx) catches `bridge_transaction_ready`,
//   renders a "Sign & Bridge" card in the chat, and calls the appropriate
//   wallet SDK (Sui / Phantom / MetaMask) to sign.  The server NEVER
//   touches a private key — signing always stays in the user's browser.
//
//   After the user signs, the frontend emits a `bridge_signed` POST to
//   /api/bridge/confirm so the agent can stream delivery-status updates.
//
// GRAPH:
//   __start__ → parseIntent → validate → buildTx → respond → __end__

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { ChatRequest, createSSEWriter } from "./agentTypes";

// ══════════════════════════════════════════════════════════════════════
// BRIDGE CONFIGURATION
// These values must match config.ts in the bridge codebase exactly.
// ══════════════════════════════════════════════════════════════════════

export const BRIDGE_CFG = {
  // Exchange rates (base units per MIST)
  rateSuiToSolLamportsPerMist: BigInt(
    process.env.RATE_SUI_TO_SOL || "10590000",
  ),
  rateSuiToEthWeiPerMist: BigInt(
    process.env.RATE_SUI_TO_ETH || "449000000000000",
  ),

  // Fee
  feeBps: parseInt(process.env.BRIDGE_FEE_BPS || "30"),

  // Minimums (base units)
  minAmountSui: BigInt(process.env.MIN_BRIDGE_AMOUNT_SUI || "10000000"), // 0.01 SUI
  minAmountSol: BigInt(process.env.MIN_BRIDGE_AMOUNT_SOL || "100000"), // 0.0001 SOL
  minAmountEth: BigInt(process.env.MIN_BRIDGE_AMOUNT_ETH || "1000000000000"), // ~0.000001 ETH

  // Maximums (base units)
  maxAmountSui: BigInt(process.env.MAX_BRIDGE_AMOUNT_SUI || "1000000000"), // 1 SUI
  maxAmountSol: BigInt(process.env.MAX_BRIDGE_AMOUNT_SOL || "2000000"), // 0.002 SOL
  maxAmountEth: BigInt(process.env.MAX_BRIDGE_AMOUNT_ETH || "100000000000000"), // 0.0001 ETH

  // Contract identifiers (Sui testnet)
  suiPackageId:
    process.env.SUI_BRIDGE_PACKAGE_ID ||
    "0x4fa5caa2a56279b502ae4ee94f9a0e4ff13f5ec76670a6a628f6c3c26b84a21a",
  suiPoolObjectId:
    process.env.SUI_BRIDGE_POOL_ID ||
    "0x3a9ee2a78579db7fbbd9cb8a43208f94682f6724abe3351d20c4110dfdfc0371",

  // Bridge vault addresses on destination chains
  solanaVaultAddress:
    process.env.SOLANA_BRIDGE_VAULT ||
    "61Tadihhy2J6MtjAubiz2qAGHSEhmmK7RH18wDRawzQP",
  ethereumVaultAddress: (process.env.ETH_BRIDGE_VAULT ||
    "0xb3eC343184311fA58F85f3f52027F27849472624") as `0x${string}`,

  solanaMemoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",

  // Delivery timeout for polling (ms)
  deliveryTimeoutMs: 3 * 60 * 1000,
  pollIntervalMs: 5_000,
} as const;

// ── Supported routes ─────────────────────────────────────────────────

export type BridgeDirection =
  | "SUI_TO_SOL"
  | "SOL_TO_SUI"
  | "SUI_TO_ETH"
  | "ETH_TO_SUI";

const SUPPORTED_ROUTES: BridgeDirection[] = [
  "SUI_TO_SOL",
  "SOL_TO_SUI",
  "SUI_TO_ETH",
  "ETH_TO_SUI",
];

// ══════════════════════════════════════════════════════════════════════
// AMOUNT HELPERS  (pure bigint, no floating point)
// ══════════════════════════════════════════════════════════════════════

function calcSuiToSol(mist: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  const raw = (mist * BRIDGE_CFG.rateSuiToSolLamportsPerMist) / 1_000_000_000n;
  return (raw * (10_000n - fee)) / 10_000n;
}

function calcSolToSui(lamports: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  const raw =
    (lamports * 1_000_000_000n) / BRIDGE_CFG.rateSuiToSolLamportsPerMist;
  return (raw * (10_000n - fee)) / 10_000n;
}

function calcSuiToEth(mist: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  const raw = (mist * BRIDGE_CFG.rateSuiToEthWeiPerMist) / 1_000_000_000n;
  return (raw * (10_000n - fee)) / 10_000n;
}

function calcEthToSui(wei: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  const raw = (wei * 1_000_000_000n) / BRIDGE_CFG.rateSuiToEthWeiPerMist;
  return (raw * (10_000n - fee)) / 10_000n;
}

function formatSui(mist: bigint): string {
  return (Number(mist) / 1e9).toFixed(4);
}
function formatSol(lamports: bigint): string {
  return (Number(lamports) / 1e9).toFixed(5);
}
function formatEth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function displayRate(direction: BridgeDirection): string {
  switch (direction) {
    case "SUI_TO_SOL":
      return `1 SUI ≈ ${formatSol(calcSuiToSol(1_000_000_000n))} SOL`;
    case "SOL_TO_SUI":
      return `1 SOL ≈ ${formatSui(calcSolToSui(1_000_000_000n))} SUI`;
    case "SUI_TO_ETH":
      return `1 SUI ≈ ${formatEth(calcSuiToEth(1_000_000_000n))} ETH`;
    case "ETH_TO_SUI":
      return `1 ETH ≈ ${formatSui(calcEthToSui(1_000_000_000_000_000_000n))} SUI`;
  }
}

// ══════════════════════════════════════════════════════════════════════
// INTENT SCHEMA
// ══════════════════════════════════════════════════════════════════════

const BridgeIntentSchema = z.object({
  intent: z.enum([
    "bridge", // user wants to bridge tokens
    "quote", // user wants a rate/fee estimate
    "status", // user asking about a previous bridge
    "help", // user asking how bridging works
    "cancel", // user wants to cancel
    "unrelated", // message has nothing to do with bridging
  ]),

  // Populated when intent === "bridge" or "quote"
  direction: z
    .enum(["SUI_TO_SOL", "SOL_TO_SUI", "SUI_TO_ETH", "ETH_TO_SUI"])
    .optional(),
  amount: z.string().optional(), // human-readable, e.g. "0.5"
  recipientAddress: z.string().optional(), // destination chain address

  // When the user doesn't specify an amount
  amountMissing: z.boolean().optional(),
  // When the user doesn't specify a direction
  directionMissing: z.boolean().optional(),
  // When the user doesn't provide a recipient address and we need one
  recipientMissing: z.boolean().optional(),
});

type BridgeIntent = z.infer<typeof BridgeIntentSchema>;

// ══════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════

const BridgeAgentState = Annotation.Root({
  userId: Annotation<string>,
  message: Annotation<string>,
  sse: Annotation<ReturnType<typeof createSSEWriter>>,
  intent: Annotation<BridgeIntent | null>,
  validationError: Annotation<string | null>,
  responseText: Annotation<string>,
  actionEvent: Annotation<Record<string, unknown> | null>,
  clientTime: Annotation<string>,
});

// ══════════════════════════════════════════════════════════════════════
// LLM
// ══════════════════════════════════════════════════════════════════════

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
  maxRetries: 1,
  maxOutputTokens: 512,
});

const structuredLlm = llm.withStructuredOutput(BridgeIntentSchema);

// ══════════════════════════════════════════════════════════════════════
// NODES
// ══════════════════════════════════════════════════════════════════════

// ── 1. Parse Intent ──────────────────────────────────────────────────

async function parseIntentNode(
  state: typeof BridgeAgentState.State,
): Promise<Partial<typeof BridgeAgentState.State>> {
  state.sse.status("Understanding your bridge request...");

  const systemPrompt = `You are a bridge intent extractor for a cross-chain bridge supporting Sui, Solana, and Ethereum.

Extract the user's bridging intent from their message.

DIRECTION MAPPING:
- "SUI to SOL/Solana" → SUI_TO_SOL
- "SOL/Solana to SUI" → SOL_TO_SUI  
- "SUI to ETH/Ethereum" → SUI_TO_ETH
- "ETH/Ethereum to SUI" → ETH_TO_SUI
- SOL↔ETH is NOT supported — if user asks, set intent to "unrelated" with a note

AMOUNT: Extract the numeric amount as a string, e.g. "0.5", "1", "100".
If no amount mentioned, set amountMissing: true.

RECIPIENT: Only set recipientAddress if the user explicitly provides a destination address.
If the user says "to my wallet" or "to my address" — leave recipientAddress empty and set recipientMissing: true (the frontend will use their connected wallet).
If the user provides an explicit address string, use it.

RULES:
- Be generous with intent detection. "move my SUI to Solana" = bridge
- "how much does it cost to bridge" = quote
- "what's the rate" = quote
- "how does bridging work" = help
- Anything else = unrelated`;

  try {
    const result = (await Promise.race([
      structuredLlm.invoke([
        { role: "system", content: systemPrompt },
        { role: "human", content: state.message },
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), 8000),
      ),
    ])) as BridgeIntent;

    return { intent: result };
  } catch (err) {
    console.error("[BRIDGE] Intent parse failed:", err);
    // Graceful fallback — treat as a help request
    return {
      intent: {
        intent: "help",
      },
    };
  }
}

// ── 2. Validate ──────────────────────────────────────────────────────

async function validateNode(
  state: typeof BridgeAgentState.State,
): Promise<Partial<typeof BridgeAgentState.State>> {
  const { intent } = state;
  if (!intent || intent.intent !== "bridge") {
    return { validationError: null }; // nothing to validate
  }

  // Check missing fields
  if (intent.directionMissing || !intent.direction) {
    return {
      validationError:
        "I need to know which direction you want to bridge. For example: " +
        '"Bridge 0.5 SUI to Solana" or "Bridge 0.002 SOL to SUI".',
    };
  }

  if (intent.amountMissing || !intent.amount) {
    const dir = intent.direction as BridgeDirection;
    return {
      validationError:
        `How much would you like to bridge? For example: ` +
        `"Bridge 0.5 ${sourceTokenOf(dir)} to ${destChainOf(dir)}".`,
    };
  }

  // Parse and convert amount to base units
  const amountFloat = parseFloat(intent.amount);
  if (isNaN(amountFloat) || amountFloat <= 0) {
    return {
      validationError:
        "That doesn't look like a valid amount. Please enter a positive number.",
    };
  }

  const dir = intent.direction as BridgeDirection;

  // Convert to base units for validation
  let amountBase: bigint;
  try {
    switch (dir) {
      case "SUI_TO_SOL":
      case "SUI_TO_ETH":
        amountBase = BigInt(Math.floor(amountFloat * 1e9)); // MIST
        break;
      case "SOL_TO_SUI":
        amountBase = BigInt(Math.floor(amountFloat * 1e9)); // lamports
        break;
      case "ETH_TO_SUI":
        amountBase = BigInt(Math.floor(amountFloat * 1e18)); // wei
        break;
    }
  } catch {
    return { validationError: "Amount is too large to process." };
  }

  // Min/max checks
  switch (dir) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH": {
      if (amountBase < BRIDGE_CFG.minAmountSui) {
        return {
          validationError: `Minimum bridge amount is ${formatSui(BRIDGE_CFG.minAmountSui)} SUI. You entered ${amountFloat} SUI.`,
        };
      }
      if (amountBase > BRIDGE_CFG.maxAmountSui) {
        return {
          validationError: `Maximum bridge amount is ${formatSui(BRIDGE_CFG.maxAmountSui)} SUI per transaction. You entered ${amountFloat} SUI.`,
        };
      }
      break;
    }
    case "SOL_TO_SUI": {
      if (amountBase < BRIDGE_CFG.minAmountSol) {
        return {
          validationError: `Minimum bridge amount is ${formatSol(BRIDGE_CFG.minAmountSol)} SOL.`,
        };
      }
      if (amountBase > BRIDGE_CFG.maxAmountSol) {
        return {
          validationError: `Maximum bridge amount is ${formatSol(BRIDGE_CFG.maxAmountSol)} SOL per transaction.`,
        };
      }
      break;
    }
    case "ETH_TO_SUI": {
      if (amountBase < BRIDGE_CFG.minAmountEth) {
        return {
          validationError: `Minimum bridge amount is ${formatEth(BRIDGE_CFG.minAmountEth)} ETH.`,
        };
      }
      if (amountBase > BRIDGE_CFG.maxAmountEth) {
        return {
          validationError: `Maximum bridge amount is ${formatEth(BRIDGE_CFG.maxAmountEth)} ETH per transaction.`,
        };
      }
      break;
    }
  }

  return { validationError: null };
}

// ── 3. Build Transaction ─────────────────────────────────────────────

async function buildTxNode(
  state: typeof BridgeAgentState.State,
): Promise<Partial<typeof BridgeAgentState.State>> {
  const { intent, validationError } = state;

  // ── Handle non-bridge intents ────────────────────────────────────
  if (!intent) {
    return {
      responseText:
        'I couldn\'t understand that. Try: "Bridge 0.5 SUI to Solana".',
      actionEvent: null,
    };
  }

  if (intent.intent === "help") {
    return {
      responseText: buildHelpMessage(),
      actionEvent: null,
    };
  }

  if (intent.intent === "quote") {
    return {
      responseText: buildQuoteMessage(
        intent.direction as BridgeDirection | undefined,
      ),
      actionEvent: null,
    };
  }

  if (intent.intent === "unrelated") {
    return {
      responseText:
        "I'm the Bridge Agent — I can help you transfer assets between Sui, Solana, and Ethereum. " +
        'Try: "Bridge 0.5 SUI to Solana" or "How much does it cost to bridge?"',
      actionEvent: null,
    };
  }

  if (intent.intent === "status") {
    return {
      responseText:
        "To check the status of a bridge transaction, you can view it on the relevant block explorer. " +
        "Bridges typically complete within 2–3 minutes. If it's been longer, please check the source chain transaction first.",
      actionEvent: null,
    };
  }

  if (intent.intent === "cancel") {
    return {
      responseText:
        "No problem — bridge cancelled. Let me know if you'd like to try a different amount or route.",
      actionEvent: null,
    };
  }

  // ── Validation error ─────────────────────────────────────────────
  if (validationError) {
    return {
      responseText: validationError,
      actionEvent: null,
    };
  }

  // ── Build the bridge transaction ─────────────────────────────────
  if (intent.intent !== "bridge" || !intent.direction || !intent.amount) {
    return {
      responseText:
        'Please specify the amount and direction. For example: "Bridge 0.5 SUI to Solana".',
      actionEvent: null,
    };
  }

  state.sse.status("Preparing your bridge transaction...");

  const dir = intent.direction as BridgeDirection;
  const amountFloat = parseFloat(intent.amount);

  // Compute base-unit amounts
  let amountIn: bigint;
  let amountOut: bigint;
  let amountOutDisplay: string;
  let amountInDisplay: string;
  let sourceToken: string;
  let destToken: string;

  switch (dir) {
    case "SUI_TO_SOL": {
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSuiToSol(amountIn);
      amountInDisplay = `${formatSui(amountIn)} SUI`;
      amountOutDisplay = `${formatSol(amountOut)} SOL`;
      sourceToken = "SUI";
      destToken = "SOL";
      break;
    }
    case "SOL_TO_SUI": {
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSolToSui(amountIn);
      amountInDisplay = `${formatSol(amountIn)} SOL`;
      amountOutDisplay = `${formatSui(amountOut)} SUI`;
      sourceToken = "SOL";
      destToken = "SUI";
      break;
    }
    case "SUI_TO_ETH": {
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSuiToEth(amountIn);
      amountInDisplay = `${formatSui(amountIn)} SUI`;
      amountOutDisplay = `${formatEth(amountOut)} ETH`;
      sourceToken = "SUI";
      destToken = "ETH";
      break;
    }
    case "ETH_TO_SUI": {
      amountIn = BigInt(Math.floor(amountFloat * 1e18));
      amountOut = calcEthToSui(amountIn);
      amountInDisplay = `${formatEth(amountIn)} ETH`;
      amountOutDisplay = `${formatSui(amountOut)} SUI`;
      sourceToken = "ETH";
      destToken = "SUI";
      break;
    }
  }

  const feePercent = (BRIDGE_CFG.feeBps / 100).toFixed(2);

  // Build the transaction payload that the FRONTEND will use to call
  // the appropriate wallet SDK. We serialise everything as strings
  // because SSE/JSON cannot carry BigInt.
  const txPayload = buildTxPayload(dir, amountIn, intent.recipientAddress);

  const responseText =
    `## Bridge Preview\n\n` +
    `**You send:** ${amountInDisplay}\n` +
    `**You receive:** ~${amountOutDisplay}\n` +
    `**Route:** ${sourceChainOf(dir)} → ${destChainOf(dir)}\n` +
    `**Fee:** ${feePercent}% (${displayRate(dir)})\n` +
    `**Estimated time:** ~2–3 minutes\n\n` +
    `Review the details above, then click **Sign & Bridge** to proceed. ` +
    `You'll be asked to approve the transaction in your wallet.`;

  const actionEvent: Record<string, unknown> = {
    type: "bridge_transaction_ready",
    direction: dir,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    amountInDisplay,
    amountOutDisplay,
    sourceChain: sourceChainOf(dir),
    destChain: destChainOf(dir),
    sourceToken,
    destToken,
    feePercent,
    txPayload,
    // The frontend will substitute the user's actual connected wallet
    // if recipientAddress is null (i.e. user said "to my wallet")
    recipientAddress: intent.recipientAddress || null,
    recipientMissing: intent.recipientMissing || false,
  };

  return { responseText, actionEvent };
}

// ── 4. Respond ───────────────────────────────────────────────────────

async function respondNode(
  state: typeof BridgeAgentState.State,
): Promise<Partial<typeof BridgeAgentState.State>> {
  state.sse.chunk(state.responseText);

  if (state.actionEvent) {
    state.sse.action(state.actionEvent as Record<string, unknown>);
  }

  state.sse.done();
  return {};
}

// ══════════════════════════════════════════════════════════════════════
// TRANSACTION PAYLOAD BUILDER
//
// Returns a plain-JSON-serialisable description of the unsigned
// transaction so the frontend can reconstruct it using the same
// helpers that already exist in the bridge UI (suiTx.ts, solanaTx.ts,
// ethTx.ts).  The frontend calls these helpers AFTER the user confirms.
// ══════════════════════════════════════════════════════════════════════

function buildTxPayload(
  direction: BridgeDirection,
  amountIn: bigint,
  recipientAddress?: string,
): Record<string, unknown> {
  switch (direction) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH": {
      // Frontend uses buildLockSuiTx from utils/suiTx.ts
      return {
        chain: "sui",
        type: "lock_sui",
        amountMist: amountIn.toString(),
        destChainId: direction === "SUI_TO_SOL" ? 1 : 0,
        recipientAddress: recipientAddress || null, // null = use connected Solana/ETH wallet
        packageId: BRIDGE_CFG.suiPackageId,
        poolObjectId: BRIDGE_CFG.suiPoolObjectId,
      };
    }
    case "SOL_TO_SUI": {
      // Frontend uses buildSendSolTx from utils/solanaTx.ts
      return {
        chain: "solana",
        type: "send_sol",
        amountLamports: amountIn.toString(),
        vaultAddress: BRIDGE_CFG.solanaVaultAddress,
        memoProgramId: BRIDGE_CFG.solanaMemoProgramId,
        suiRecipientAddress: recipientAddress || null, // null = use connected Sui wallet
      };
    }
    case "ETH_TO_SUI": {
      // Frontend uses buildSendEthTxParams from utils/ethTx.ts
      return {
        chain: "ethereum",
        type: "send_eth",
        amountWei: amountIn.toString(),
        vaultAddress: BRIDGE_CFG.ethereumVaultAddress,
        suiRecipientAddress: recipientAddress || null, // null = use connected Sui wallet
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function sourceTokenOf(dir: BridgeDirection): string {
  return dir.startsWith("SUI") ? "SUI" : dir.startsWith("SOL") ? "SOL" : "ETH";
}

function sourceChainOf(dir: BridgeDirection): string {
  return dir.startsWith("SUI")
    ? "Sui"
    : dir.startsWith("SOL")
      ? "Solana"
      : "Ethereum";
}

function destChainOf(dir: BridgeDirection): string {
  return dir.endsWith("SOL")
    ? "Solana"
    : dir.endsWith("ETH")
      ? "Ethereum"
      : "Sui";
}

function buildHelpMessage(): string {
  return (
    `## Bridge Agent\n\n` +
    `I can help you transfer assets between **Sui**, **Solana**, and **Ethereum**.\n\n` +
    `**Supported routes:**\n` +
    `- SUI → SOL (Sui to Solana)\n` +
    `- SOL → SUI (Solana to Sui)\n` +
    `- SUI → ETH (Sui to Ethereum Sepolia)\n` +
    `- ETH → SUI (Ethereum to Sui)\n\n` +
    `**How it works:**\n` +
    `1. Tell me what you'd like to bridge\n` +
    `2. I'll prepare the transaction and show you a preview\n` +
    `3. You approve in your wallet — you always stay in control\n` +
    `4. The bridge relayer handles delivery (~2–3 minutes)\n\n` +
    `**Current fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}%\n\n` +
    `**Try:** *"Bridge 0.5 SUI to Solana"* or *"How much will I receive for 0.001 ETH?"*`
  );
}

function buildQuoteMessage(direction?: BridgeDirection): string {
  if (!direction) {
    // Show all rates
    const lines = SUPPORTED_ROUTES.map(
      (d) => `- **${sourceChainOf(d)} → ${destChainOf(d)}:** ${displayRate(d)}`,
    );
    return (
      `## Bridge Rates\n\n` +
      lines.join("\n") +
      `\n\n**Fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% on all routes\n` +
      `\nTo get an exact quote, tell me how much you'd like to bridge: *"How much SOL will I get for 1 SUI?"*`
    );
  }

  const rate = displayRate(direction);
  const fee = (BRIDGE_CFG.feeBps / 100).toFixed(2);
  return (
    `## ${sourceChainOf(direction)} → ${destChainOf(direction)} Rate\n\n` +
    `**Exchange rate:** ${rate}\n` +
    `**Fee:** ${fee}%\n\n` +
    `Ready to bridge? Try: *"Bridge 0.5 ${sourceTokenOf(direction)} to ${destChainOf(direction)}"*`
  );
}

// ══════════════════════════════════════════════════════════════════════
// GRAPH
// ══════════════════════════════════════════════════════════════════════

let compiledGraph: ReturnType<typeof buildGraph> | null = null;

function buildGraph() {
  return new StateGraph(BridgeAgentState)
    .addNode("parseIntent", parseIntentNode)
    .addNode("validate", validateNode)
    .addNode("buildTx", buildTxNode)
    .addNode("respond", respondNode)
    .addEdge("__start__", "parseIntent")
    .addEdge("parseIntent", "validate")
    .addEdge("validate", "buildTx")
    .addEdge("buildTx", "respond")
    .addEdge("respond", "__end__")
    .compile();
}

function getCompiledGraph() {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}

// ══════════════════════════════════════════════════════════════════════
// AGENT HANDLER  (matches AgentHandler interface from agentTypes.ts)
// ══════════════════════════════════════════════════════════════════════

export class BridgeAgent {
  async handle(
    req: ChatRequest,
    sse: ReturnType<typeof createSSEWriter>,
  ): Promise<string> {
    console.log(`[BRIDGE] Request from ${req.userId.substring(0, 10)}...`);

    let fullResponse = "";
    const wrappedSSE = {
      ...sse,
      chunk: (text: string) => {
        fullResponse += text;
        sse.chunk(text);
      },
      status: sse.status,
      action: sse.action,
      done: sse.done,
      conversation: sse.conversation,
      error: sse.error,
    };

    try {
      const graph = getCompiledGraph();
      await graph.invoke({
        userId: req.userId,
        message: req.message,
        sse: wrappedSSE,
        intent: null,
        validationError: null,
        responseText: "",
        actionEvent: null,
        clientTime: req.clientTime || new Date().toISOString(),
      });

      console.log(`[BRIDGE] Completed for ${req.userId.substring(0, 10)}...`);
      return fullResponse;
    } catch (err) {
      console.error("[BRIDGE] Error:", err);
      sse.error("Bridge agent encountered an error. Please try again.");
      return "Error";
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let bridgeAgentInstance: BridgeAgent | null = null;

export function getBridgeAgent(): BridgeAgent {
  if (!bridgeAgentInstance) bridgeAgentInstance = new BridgeAgent();
  return bridgeAgentInstance;
}
