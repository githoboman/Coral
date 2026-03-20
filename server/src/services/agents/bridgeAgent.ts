// server/src/services/agents/bridgeAgent.ts
// Eva — Tovira's bridge companion.
// Logic is identical to the previous version.
// Only the response voice has changed: warmer, more direct, less documentation.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { ChatRequest, createSSEWriter } from "./agentTypes";
import { getBlockVisionService } from "../blockVisionService";

// ══════════════════════════════════════════════════════════════════════
// BRIDGE CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

export const BRIDGE_CFG = {
  rateSuiToSolLamportsPerMist: BigInt(
    process.env.RATE_SUI_TO_SOL || "10590000",
  ),
  rateSuiToEthWeiPerMist: BigInt(
    process.env.RATE_SUI_TO_ETH || "449000000000000",
  ),
  feeBps: parseInt(process.env.BRIDGE_FEE_BPS || "30"),
  minAmountSui: BigInt(process.env.MIN_BRIDGE_AMOUNT_SUI || "10000000"),
  minAmountSol: BigInt(process.env.MIN_BRIDGE_AMOUNT_SOL || "100000"),
  minAmountEth: BigInt(process.env.MIN_BRIDGE_AMOUNT_ETH || "1000000000000"),
  maxAmountSui: BigInt(process.env.MAX_BRIDGE_AMOUNT_SUI || "1000000000"),
  maxAmountSol: BigInt(process.env.MAX_BRIDGE_AMOUNT_SOL || "2000000"),
  maxAmountEth: BigInt(process.env.MAX_BRIDGE_AMOUNT_ETH || "100000000000000"),
  suiPackageId:
    process.env.SUI_BRIDGE_PACKAGE_ID ||
    "0x4fa5caa2a56279b502ae4ee94f9a0e4ff13f5ec76670a6a628f6c3c26b84a21a",
  suiPoolObjectId:
    process.env.SUI_BRIDGE_POOL_ID ||
    "0x3a9ee2a78579db7fbbd9cb8a43208f94682f6724abe3351d20c4110dfdfc0371",
  solanaVaultAddress:
    process.env.SOLANA_BRIDGE_VAULT ||
    "61Tadihhy2J6MtjAubiz2qAGHSEhmmK7RH18wDRawzQP",
  ethereumVaultAddress: (process.env.ETH_BRIDGE_VAULT ||
    "0xb3eC343184311fA58F85f3f52027F27849472624") as `0x${string}`,
  solanaMemoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  estimatedSuiGasMist: BigInt(10_000_000),
} as const;

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

// ── Amount helpers ────────────────────────────────────────────────────

function calcSuiToSol(mist: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  return (
    (((mist * BRIDGE_CFG.rateSuiToSolLamportsPerMist) / 1_000_000_000n) *
      (10_000n - fee)) /
    10_000n
  );
}
function calcSolToSui(lamports: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  return (
    (((lamports * 1_000_000_000n) / BRIDGE_CFG.rateSuiToSolLamportsPerMist) *
      (10_000n - fee)) /
    10_000n
  );
}
function calcSuiToEth(mist: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  return (
    (((mist * BRIDGE_CFG.rateSuiToEthWeiPerMist) / 1_000_000_000n) *
      (10_000n - fee)) /
    10_000n
  );
}
function calcEthToSui(wei: bigint): bigint {
  const fee = BigInt(BRIDGE_CFG.feeBps);
  return (
    (((wei * 1_000_000_000n) / BRIDGE_CFG.rateSuiToEthWeiPerMist) *
      (10_000n - fee)) /
    10_000n
  );
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

// ── Intent schema ─────────────────────────────────────────────────────

const BridgeIntentSchema = z.object({
  intent: z.enum(["bridge", "quote", "status", "help", "cancel", "unrelated"]),
  direction: z
    .enum(["SUI_TO_SOL", "SOL_TO_SUI", "SUI_TO_ETH", "ETH_TO_SUI"])
    .optional(),
  amount: z.string().optional(),
  recipientAddress: z.string().optional(),
  amountMissing: z.boolean().optional(),
  directionMissing: z.boolean().optional(),
  recipientMissing: z.boolean().optional(),
});
type BridgeIntent = z.infer<typeof BridgeIntentSchema>;

// ── State ─────────────────────────────────────────────────────────────

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

// ── LLM ──────────────────────────────────────────────────────────────

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

async function parseIntentNode(state: typeof BridgeAgentState.State) {
  state.sse.status("On it...");

  const systemPrompt = `You are a bridge intent extractor for a cross-chain bridge supporting Sui, Solana, and Ethereum.

Extract the user's bridging intent from their message.

DIRECTION MAPPING:
- "SUI to SOL/Solana" → SUI_TO_SOL
- "SOL/Solana to SUI" → SOL_TO_SUI
- "SUI to ETH/Ethereum" → SUI_TO_ETH
- "ETH/Ethereum to SUI" → ETH_TO_SUI
- SOL↔ETH is NOT supported

AMOUNT: Extract the numeric amount as a string. If no amount, set amountMissing: true.
RECIPIENT: Only set recipientAddress if the user explicitly provides an address.
If user says "to my wallet" — leave recipientAddress empty and set recipientMissing: true.`;

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
    return { intent: { intent: "help" as const } };
  }
}

// ── validateNode ──────────────────────────────────────────────────────

async function validateNode(state: typeof BridgeAgentState.State) {
  const { intent, userId } = state;
  if (!intent || intent.intent !== "bridge") return { validationError: null };

  if (intent.directionMissing || !intent.direction) {
    return {
      validationError:
        'Which direction are we moving? Just tell me something like *"Bridge 0.5 SUI to Solana"* or *"0.002 SOL to SUI"* and I\'ll take it from there.',
    };
  }

  if (intent.amountMissing || !intent.amount) {
    return {
      validationError: `How much ${sourceTokenOf(intent.direction as BridgeDirection)} do you want to move? Drop an amount and I'll put it together for you.`,
    };
  }

  const amountFloat = parseFloat(intent.amount);
  if (isNaN(amountFloat) || amountFloat <= 0) {
    return {
      validationError:
        "That amount doesn't look right — needs to be a positive number.",
    };
  }

  const dir = intent.direction as BridgeDirection;
  let amountBase: bigint;
  try {
    switch (dir) {
      case "SUI_TO_SOL":
      case "SUI_TO_ETH":
        amountBase = BigInt(Math.floor(amountFloat * 1e9));
        break;
      case "SOL_TO_SUI":
        amountBase = BigInt(Math.floor(amountFloat * 1e9));
        break;
      case "ETH_TO_SUI":
        amountBase = BigInt(Math.floor(amountFloat * 1e18));
        break;
    }
  } catch {
    return {
      validationError: "That amount is way too large for me to handle.",
    };
  }

  // Min/max checks — Eva keeps it plain
  switch (dir) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH":
      if (amountBase < BRIDGE_CFG.minAmountSui)
        return {
          validationError: `The minimum I can bridge is **${formatSui(BRIDGE_CFG.minAmountSui)} SUI**. You're a little short — bump it up and we're good.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountSui)
        return {
          validationError: `I can only move up to **${formatSui(BRIDGE_CFG.maxAmountSui)} SUI** per transaction right now. Want to split it into multiple bridges?`,
        };
      break;
    case "SOL_TO_SUI":
      if (amountBase < BRIDGE_CFG.minAmountSol)
        return {
          validationError: `Minimum for this route is **${formatSol(BRIDGE_CFG.minAmountSol)} SOL**. Try a slightly larger amount.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountSol)
        return {
          validationError: `I'm capped at **${formatSol(BRIDGE_CFG.maxAmountSol)} SOL** per transaction. Split it across two bridges if you need more.`,
        };
      break;
    case "ETH_TO_SUI":
      if (amountBase < BRIDGE_CFG.minAmountEth)
        return {
          validationError: `The minimum here is **${formatEth(BRIDGE_CFG.minAmountEth)} ETH**. Just a tiny bit more and we're set.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountEth)
        return {
          validationError: `I can only handle up to **${formatEth(BRIDGE_CFG.maxAmountEth)} ETH** at a time. Want to break it up?`,
        };
      break;
  }

  // Balance check for SUI outbound routes
  if ((dir === "SUI_TO_SOL" || dir === "SUI_TO_ETH") && userId) {
    try {
      state.sse.status("Checking your balance...");
      const blockVision = getBlockVisionService();
      const portfolio = await blockVision.getAccountPortfolio(userId);
      const suiCoin = portfolio.coins.find(
        (c) => c.coinType === "0x2::sui::SUI" || c.symbol === "SUI",
      );

      if (suiCoin) {
        const balanceSui = parseFloat(
          suiCoin.balance.toString().replace(/,/g, ""),
        );
        const balanceMist = BigInt(Math.floor(balanceSui * 1e9));
        const totalNeeded = amountBase + BRIDGE_CFG.estimatedSuiGasMist;

        if (balanceMist < totalNeeded) {
          const needed = formatSui(totalNeeded);
          const have = formatSui(balanceMist);
          return {
            validationError:
              `You're a bit short for this one. This bridge needs **${needed} SUI** (that includes gas), but I'm only seeing **${have} SUI** in your wallet. ` +
              `Top it up or try a smaller amount and we'll get it done.`,
          };
        }
      }
    } catch (err: any) {
      console.warn(
        `[BRIDGE] Balance check failed (non-fatal): ${err?.message}`,
      );
    }
  }

  return { validationError: null };
}

// ── buildTxNode ───────────────────────────────────────────────────────

async function buildTxNode(state: typeof BridgeAgentState.State) {
  const { intent, validationError } = state;

  if (!intent)
    return {
      responseText:
        "I didn't quite catch that. Try something like *\"Bridge 0.5 SUI to Solana\"* and I'll handle the rest.",
      actionEvent: null,
    };

  if (intent.intent === "help")
    return { responseText: buildHelpMessage(), actionEvent: null };
  if (intent.intent === "quote")
    return {
      responseText: buildQuoteMessage(
        intent.direction as BridgeDirection | undefined,
      ),
      actionEvent: null,
    };
  if (intent.intent === "status")
    return {
      responseText:
        "Hit the **Transactions** button up top — all your recent bridges are tracked there, including status and explorer links.",
      actionEvent: null,
    };
  if (intent.intent === "cancel")
    return {
      responseText:
        "Cancelled, no worries. Whenever you're ready, just tell me where you want to move your assets.",
      actionEvent: null,
    };

  if (intent.intent === "unrelated") {
    return {
      responseText:
        "I'm Eva, your bridge assistant. I move assets between Sui, Solana, and Ethereum — that's my thing.\n\nTry something like *\"Bridge 0.5 SUI to Solana\"* and I'll set it up for you.",
      actionEvent: null,
    };
  }

  if (validationError)
    return { responseText: validationError, actionEvent: null };

  if (intent.intent !== "bridge" || !intent.direction || !intent.amount) {
    return {
      responseText:
        'Tell me the amount and which direction — something like *"Bridge 0.5 SUI to Solana"* — and I\'ll get it ready.',
      actionEvent: null,
    };
  }

  state.sse.status("Getting your transaction ready...");

  const dir = intent.direction as BridgeDirection;
  const amountFloat = parseFloat(intent.amount);
  let amountIn: bigint,
    amountOut: bigint,
    amountInDisplay: string,
    amountOutDisplay: string,
    sourceToken: string,
    destToken: string;

  switch (dir) {
    case "SUI_TO_SOL":
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSuiToSol(amountIn);
      amountInDisplay = `${formatSui(amountIn)} SUI`;
      amountOutDisplay = `${formatSol(amountOut)} SOL`;
      sourceToken = "SUI";
      destToken = "SOL";
      break;
    case "SOL_TO_SUI":
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSolToSui(amountIn);
      amountInDisplay = `${formatSol(amountIn)} SOL`;
      amountOutDisplay = `${formatSui(amountOut)} SUI`;
      sourceToken = "SOL";
      destToken = "SUI";
      break;
    case "SUI_TO_ETH":
      amountIn = BigInt(Math.floor(amountFloat * 1e9));
      amountOut = calcSuiToEth(amountIn);
      amountInDisplay = `${formatSui(amountIn)} SUI`;
      amountOutDisplay = `${formatEth(amountOut)} ETH`;
      sourceToken = "SUI";
      destToken = "ETH";
      break;
    case "ETH_TO_SUI":
      amountIn = BigInt(Math.floor(amountFloat * 1e18));
      amountOut = calcEthToSui(amountIn);
      amountInDisplay = `${formatEth(amountIn)} ETH`;
      amountOutDisplay = `${formatSui(amountOut)} SUI`;
      sourceToken = "ETH";
      destToken = "SUI";
      break;
  }

  const feePercent = (BRIDGE_CFG.feeBps / 100).toFixed(2);
  const txPayload = buildTxPayload(dir, amountIn, intent.recipientAddress);

  // Eva's bridge preview — same data, different tone
  const responseText =
    `Here's what this bridge looks like:\n\n` +
    `**Sending:** ${amountInDisplay}\n` +
    `**Arriving:** ~${amountOutDisplay}\n` +
    `**Route:** ${sourceChainOf(dir)} → ${destChainOf(dir)}\n` +
    `**Fee:** ${feePercent}%  ·  **Rate:** ${displayRate(dir)}\n` +
    `**ETA:** ~1–2 minutes after you sign\n\n` +
    `Looks good? Hit **Sign & Bridge** and approve it in your wallet. I'll watch the delivery from there.`;

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
    recipientAddress: intent.recipientAddress || null,
    recipientMissing: intent.recipientMissing || false,
  };

  return { responseText, actionEvent };
}

async function respondNode(state: typeof BridgeAgentState.State) {
  state.sse.chunk(state.responseText);
  if (state.actionEvent)
    state.sse.action(state.actionEvent as Record<string, unknown>);
  state.sse.done();
  return {};
}

// ── Tx payload builder (unchanged) ───────────────────────────────────

function buildTxPayload(
  direction: BridgeDirection,
  amountIn: bigint,
  recipientAddress?: string,
): Record<string, unknown> {
  switch (direction) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH":
      return {
        chain: "sui",
        type: "lock_sui",
        amountMist: amountIn.toString(),
        destChainId: direction === "SUI_TO_SOL" ? 1 : 0,
        recipientAddress: recipientAddress || null,
        packageId: BRIDGE_CFG.suiPackageId,
        poolObjectId: BRIDGE_CFG.suiPoolObjectId,
      };
    case "SOL_TO_SUI":
      return {
        chain: "solana",
        type: "send_sol",
        amountLamports: amountIn.toString(),
        vaultAddress: BRIDGE_CFG.solanaVaultAddress,
        memoProgramId: BRIDGE_CFG.solanaMemoProgramId,
        suiRecipientAddress: recipientAddress || null,
      };
    case "ETH_TO_SUI":
      return {
        chain: "ethereum",
        type: "send_eth",
        amountWei: amountIn.toString(),
        vaultAddress: BRIDGE_CFG.ethereumVaultAddress,
        suiRecipientAddress: recipientAddress || null,
      };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function sourceTokenOf(dir: BridgeDirection) {
  return dir.startsWith("SUI") ? "SUI" : dir.startsWith("SOL") ? "SOL" : "ETH";
}
function sourceChainOf(dir: BridgeDirection) {
  return dir.startsWith("SUI")
    ? "Sui"
    : dir.startsWith("SOL")
      ? "Solana"
      : "Ethereum";
}
function destChainOf(dir: BridgeDirection) {
  return dir.endsWith("SOL")
    ? "Solana"
    : dir.endsWith("ETH")
      ? "Ethereum"
      : "Sui";
}

// ── Eva's voice ───────────────────────────────────────────────────────

function buildHelpMessage(): string {
  return (
    `Hey, I'm **Eva** — I move your assets between chains so you don't have to think about the plumbing.\n\n` +
    `**What I can do:**\n` +
    `- SUI → SOL  ·  SOL → SUI\n` +
    `- SUI → ETH  ·  ETH → SUI\n\n` +
    `**How it goes:**\n` +
    `Just tell me what you want to move and I'll check your balance, calculate what arrives on the other side, and set up the transaction. ` +
    `You approve it in your wallet — I never touch your keys — and I'll track the delivery until it lands.\n\n` +
    `**Current fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% · Delivery is usually 1–2 minutes.\n\n` +
    `*Try: "Bridge 0.5 SUI to Solana" or "What's the rate for ETH to SUI?"*`
  );
}

function buildQuoteMessage(direction?: BridgeDirection): string {
  if (!direction) {
    const lines = SUPPORTED_ROUTES.map(
      (d) => `- **${sourceChainOf(d)} → ${destChainOf(d)}:** ${displayRate(d)}`,
    );
    return (
      `Current rates (${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% fee already baked in):\n\n` +
      lines.join("\n") +
      `\n\nRates move with the market, but they're updated regularly. Ready to move something? Just tell me the amount.`
    );
  }

  return (
    `**${sourceChainOf(direction)} → ${destChainOf(direction)}**\n\n` +
    `Rate: ${displayRate(direction)}\n` +
    `Fee: ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}%\n\n` +
    `Want to go ahead? Try *"Bridge 0.5 ${sourceTokenOf(direction)} to ${destChainOf(direction)}"* and I'll get it ready.`
  );
}

// ── Graph ─────────────────────────────────────────────────────────────

let compiledGraph: any = null;

function getCompiledGraph() {
  if (!compiledGraph) {
    compiledGraph = new StateGraph(BridgeAgentState)
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
  return compiledGraph;
}

// ── Agent handler ─────────────────────────────────────────────────────

export class BridgeAgent {
  async handle(
    req: ChatRequest,
    sse: ReturnType<typeof createSSEWriter>,
  ): Promise<string> {
    console.log(
      `[BRIDGE] Eva handling request from ${req.userId.substring(0, 10)}...`,
    );
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
      await getCompiledGraph().invoke({
        userId: req.userId,
        message: req.message,
        sse: wrappedSSE,
        intent: null,
        validationError: null,
        responseText: "",
        actionEvent: null,
        clientTime: req.clientTime || new Date().toISOString(),
      });
      return fullResponse;
    } catch (err) {
      console.error("[BRIDGE] Eva error:", err);
      sse.error("Something went wrong on my end. Give it another shot.");
      return "Error";
    }
  }
}

let bridgeAgentInstance: BridgeAgent | null = null;
export function getBridgeAgent(): BridgeAgent {
  if (!bridgeAgentInstance) bridgeAgentInstance = new BridgeAgent();
  return bridgeAgentInstance;
}
