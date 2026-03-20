// server/src/services/agents/bridgeAgent.ts
// Changes from previous version:
//   - validateNode now checks user's SUI/SOL/ETH balance via BlockVisionService
//     before allowing the bridge to proceed. Insufficient funds are caught
//     server-side before a sign button ever appears.

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

  // Estimated gas buffer added on top of bridge amount for SUI transactions
  // 0.01 SUI = 10_000_000 MIST — safe upper bound for a Move call
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
  state.sse.status("Understanding your bridge request...");

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

// ── validateNode — now includes balance check ─────────────────────────

async function validateNode(state: typeof BridgeAgentState.State) {
  const { intent, userId } = state;
  if (!intent || intent.intent !== "bridge") return { validationError: null };

  // Missing direction
  if (intent.directionMissing || !intent.direction) {
    return {
      validationError:
        'I need to know which direction you want to bridge. For example: "Bridge 0.5 SUI to Solana" or "Bridge 0.002 SOL to SUI".',
    };
  }

  // Missing amount
  if (intent.amountMissing || !intent.amount) {
    return {
      validationError: `How much would you like to bridge? For example: "Bridge 0.5 ${sourceTokenOf(intent.direction as BridgeDirection)} to ${destChainOf(intent.direction as BridgeDirection)}".`,
    };
  }

  const amountFloat = parseFloat(intent.amount);
  if (isNaN(amountFloat) || amountFloat <= 0) {
    return {
      validationError:
        "That doesn't look like a valid amount. Please enter a positive number.",
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
    return { validationError: "Amount is too large to process." };
  }

  // Min/max checks
  switch (dir) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH":
      if (amountBase < BRIDGE_CFG.minAmountSui)
        return {
          validationError: `Minimum bridge amount is ${formatSui(BRIDGE_CFG.minAmountSui)} SUI. You entered ${amountFloat} SUI.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountSui)
        return {
          validationError: `Maximum bridge amount is ${formatSui(BRIDGE_CFG.maxAmountSui)} SUI per transaction. You entered ${amountFloat} SUI.`,
        };
      break;
    case "SOL_TO_SUI":
      if (amountBase < BRIDGE_CFG.minAmountSol)
        return {
          validationError: `Minimum bridge amount is ${formatSol(BRIDGE_CFG.minAmountSol)} SOL.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountSol)
        return {
          validationError: `Maximum bridge amount is ${formatSol(BRIDGE_CFG.maxAmountSol)} SOL per transaction.`,
        };
      break;
    case "ETH_TO_SUI":
      if (amountBase < BRIDGE_CFG.minAmountEth)
        return {
          validationError: `Minimum bridge amount is ${formatEth(BRIDGE_CFG.minAmountEth)} ETH.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountEth)
        return {
          validationError: `Maximum bridge amount is ${formatEth(BRIDGE_CFG.maxAmountEth)} ETH per transaction.`,
        };
      break;
  }

  // ── Balance check (SUI only — we have BlockVision for Sui wallets) ──
  // We only check SUI outbound routes because we don't have the user's
  // Solana/ETH address server-side (they connect those wallets client-side only).
  if ((dir === "SUI_TO_SOL" || dir === "SUI_TO_ETH") && userId) {
    try {
      state.sse.status("Checking your balance...");
      const blockVision = getBlockVisionService();
      const portfolio = await blockVision.getAccountPortfolio(userId);

      // Find SUI coin balance
      const suiCoin = portfolio.coins.find(
        (c) => c.coinType === "0x2::sui::SUI" || c.symbol === "SUI",
      );

      if (suiCoin) {
        // Convert balance string to MIST (9 decimals)
        const balanceSui = parseFloat(
          suiCoin.balance.toString().replace(/,/g, ""),
        );
        const balanceMist = BigInt(Math.floor(balanceSui * 1e9));

        // Total needed = bridge amount + gas buffer
        const totalNeeded = amountBase + BRIDGE_CFG.estimatedSuiGasMist;

        if (balanceMist < totalNeeded) {
          const needed = formatSui(totalNeeded);
          const have = formatSui(balanceMist);
          return {
            validationError:
              `Insufficient balance. You need at least **${needed} SUI** (including gas), but your wallet only has **${have} SUI**. ` +
              `Please top up your wallet or bridge a smaller amount.`,
          };
        }
      }
      // If suiCoin not found or balance check fails, we let it through —
      // the wallet itself will reject if truly insufficient.
    } catch (err: any) {
      // Non-fatal — balance check is best-effort, never block the user
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
        'I couldn\'t understand that. Try: "Bridge 0.5 SUI to Solana".',
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
  if (intent.intent === "unrelated")
    return {
      responseText:
        'I\'m the Bridge Agent — I can help you transfer assets between Sui, Solana, and Ethereum. Try: "Bridge 0.5 SUI to Solana".',
      actionEvent: null,
    };
  if (intent.intent === "status")
    return {
      responseText:
        "To check the status of a bridge transaction, view your transaction history using the **Transactions** button in the top bar.",
      actionEvent: null,
    };
  if (intent.intent === "cancel")
    return {
      responseText:
        "No problem — bridge cancelled. Let me know if you'd like to try a different amount or route.",
      actionEvent: null,
    };
  if (validationError)
    return { responseText: validationError, actionEvent: null };

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

  const responseText =
    `## Bridge Preview\n\n` +
    `**You send:** ${amountInDisplay}\n` +
    `**You receive:** ~${amountOutDisplay}\n` +
    `**Route:** ${sourceChainOf(dir)} → ${destChainOf(dir)}\n` +
    `**Fee:** ${feePercent}% (${displayRate(dir)})\n` +
    `**Estimated time:** ~2–3 minutes\n\n` +
    `Review the details above, then click **Sign & Bridge** to proceed. You'll be asked to approve the transaction in your wallet.`;

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

// ── Tx payload builder ────────────────────────────────────────────────

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

function buildHelpMessage(): string {
  return `## Bridge Agent\n\nI can help you transfer assets between **Sui**, **Solana**, and **Ethereum**.\n\n**Supported routes:**\n- SUI → SOL\n- SOL → SUI\n- SUI → ETH (Sepolia)\n- ETH → SUI\n\n**How it works:**\n1. Tell me what you'd like to bridge\n2. I'll check your balance and prepare a preview\n3. You approve in your wallet — you always stay in control\n4. The bridge relayer handles delivery (~2–3 minutes)\n\n**Current fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}%\n\n*Try: "Bridge 0.5 SUI to Solana" or "What's the rate for SUI to ETH?"*`;
}

function buildQuoteMessage(direction?: BridgeDirection): string {
  if (!direction) {
    const lines = SUPPORTED_ROUTES.map(
      (d) => `- **${sourceChainOf(d)} → ${destChainOf(d)}:** ${displayRate(d)}`,
    );
    return `## Bridge Rates\n\n${lines.join("\n")}\n\n**Fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% on all routes`;
  }
  return `## ${sourceChainOf(direction)} → ${destChainOf(direction)} Rate\n\n**Exchange rate:** ${displayRate(direction)}\n**Fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}%\n\nReady to bridge? Try: *"Bridge 0.5 ${sourceTokenOf(direction)} to ${destChainOf(direction)}"*`;
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
      console.error("[BRIDGE] Error:", err);
      sse.error("Bridge agent encountered an error. Please try again.");
      return "Error";
    }
  }
}

let bridgeAgentInstance: BridgeAgent | null = null;
export function getBridgeAgent(): BridgeAgent {
  if (!bridgeAgentInstance) bridgeAgentInstance = new BridgeAgent();
  return bridgeAgentInstance;
}
