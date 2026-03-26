import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { ChatRequest, createSSEWriter } from "./agentTypes";
import { getBlockVisionService } from "../blockVisionService";
import { getSupabaseClient } from "../../config/supabase";

export const BRIDGE_CFG = {
  rateSuiToSolLamportsPerMist: BigInt(
    process.env.RATE_SUI_TO_SOL || "10590000",
  ),
  rateSuiToEthWeiPerMist: BigInt(process.env.RATE_SUI_TO_ETH || ""),
  feeBps: parseInt(process.env.BRIDGE_FEE_BPS || ""),
  minAmountSui: BigInt(process.env.MIN_BRIDGE_AMOUNT_SUI || ""),
  minAmountSol: BigInt(process.env.MIN_BRIDGE_AMOUNT_SOL || ""),
  minAmountEth: BigInt(process.env.MIN_BRIDGE_AMOUNT_ETH || ""),
  maxAmountSui: BigInt(process.env.MAX_BRIDGE_AMOUNT_SUI || ""),
  maxAmountSol: BigInt(process.env.MAX_BRIDGE_AMOUNT_SOL || ""),
  maxAmountEth: BigInt(process.env.MAX_BRIDGE_AMOUNT_ETH || ""),
  suiPackageId: process.env.SUI_BRIDGE_PACKAGE_ID || "",
  suiPoolObjectId: process.env.SUI_BRIDGE_POOL_ID || "",
  solanaVaultAddress: process.env.SOLANA_BRIDGE_VAULT || "",
  ethereumVaultAddress: (process.env.ETH_BRIDGE_VAULT || "") as `0x${string}`,
  solanaMemoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  estimatedSuiGasMist: BigInt(10_000_000),
  gasReserveMist: BigInt(20_000_000),
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

interface WalletContext {
  suiBalance: string;
  suiBalanceMist: bigint;
  bridgeableMaxSui: string;
  bridgeableMaxMist: bigint;
}

interface RecentBridgeTx {
  direction: string;
  source_chain: string;
  dest_chain: string;
  amount_in: string;
  amount_out: string;
  status: string;
  created_at: string;
}

const BridgeIntentSchema = z.object({
  intent: z.enum([
    "bridge",
    "quote",
    "balance",
    "history",
    "status",
    "help",
    "cancel",
    "unrelated",
  ]),
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

const BridgeAgentState = Annotation.Root({
  userId: Annotation<string>,
  message: Annotation<string>,
  sse: Annotation<ReturnType<typeof createSSEWriter>>,
  walletContext: Annotation<WalletContext | null>,
  recentTxs: Annotation<RecentBridgeTx[]>,
  conversationHistory: Annotation<
    Array<{ role: "user" | "assistant"; content: string }>
  >,
  intent: Annotation<BridgeIntent | null>,
  validationError: Annotation<string | null>,
  responseText: Annotation<string>,
  actionEvent: Annotation<Record<string, unknown> | null>,
  clientTime: Annotation<string>,
});

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
  maxRetries: 1,
  maxOutputTokens: 512,
});
const structuredLlm = llm.withStructuredOutput(BridgeIntentSchema);

const conversationalLlm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.4,
  maxRetries: 1,
  maxOutputTokens: 600,
});

async function fetchWalletContextNode(state: typeof BridgeAgentState.State) {
  const { userId } = state;
  let walletContext: WalletContext | null = null;
  let recentTxs: RecentBridgeTx[] = [];

  if (userId) {
    try {
      const blockVision = getBlockVisionService();
      const portfolio = await blockVision.getAccountPortfolio(userId);
      const suiCoin = portfolio.coins.find(
        (c: any) => c.coinType === "0x2::sui::SUI" || c.symbol === "SUI",
      );

      if (suiCoin) {
        const balanceSui = parseFloat(
          suiCoin.balance.toString().replace(/,/g, ""),
        );
        const balanceMist = BigInt(Math.floor(balanceSui * 1e9));
        const bridgeableMist =
          balanceMist > BRIDGE_CFG.gasReserveMist
            ? balanceMist - BRIDGE_CFG.gasReserveMist
            : 0n;

        walletContext = {
          suiBalance: balanceSui.toFixed(4),
          suiBalanceMist: balanceMist,
          bridgeableMaxSui: formatSui(bridgeableMist),
          bridgeableMaxMist: bridgeableMist,
        };
      }
    } catch (err: any) {
      console.warn(
        "[BRIDGE] Wallet context fetch failed (non-fatal):",
        err?.message,
      );
    }

    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("bridge_transactions")
        .select(
          "direction, source_chain, dest_chain, amount_in, amount_out, status, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (data) recentTxs = data as RecentBridgeTx[];
    } catch (err: any) {
      console.warn(
        "[BRIDGE] Recent tx fetch failed (non-fatal):",
        err?.message,
      );
    }
    console.log(
      `[BRIDGE] Fetched ${recentTxs.length} recent txs for ${userId.substring(0, 10)}`,
    );
  }

  return { walletContext, recentTxs };
}

async function parseIntentNode(state: typeof BridgeAgentState.State) {
  state.sse.status("On it...");

  const { walletContext, recentTxs, conversationHistory } = state;

  let walletBlock = "";
  if (walletContext) {
    const half = (parseFloat(walletContext.suiBalance) / 2).toFixed(4);
    const quarter = (parseFloat(walletContext.suiBalance) / 4).toFixed(4);
    walletBlock = `
USER WALLET (Sui):
- Balance: ${walletContext.suiBalance} SUI
- Max bridgeable (after gas reserve): ${walletContext.bridgeableMaxSui} SUI

RELATIVE AMOUNT RESOLUTION — resolve these before extracting amount:
- "half" / "50%" → ${half} SUI
- "quarter" / "25%" → ${quarter} SUI
- "all" / "everything" / "max" → ${walletContext.bridgeableMaxSui} SUI
- "most of it" → ${(parseFloat(walletContext.bridgeableMaxSui) * 0.9).toFixed(4)} SUI
Use the resolved numeric value as the amount field.`;
  }

  let historyBlock = "";
  if (recentTxs.length > 0) {
    const txLines = recentTxs
      .map((tx) => {
        const ago = Math.round(
          (Date.now() - new Date(tx.created_at).getTime()) / 60000,
        );
        return `- ${tx.source_chain}→${tx.dest_chain} ${tx.amount_in} (${tx.status}, ${ago}m ago)`;
      })
      .join("\n");
    historyBlock = `\nRECENT BRIDGES:\n${txLines}`;
  }

  const systemPrompt = `You are a bridge intent extractor for Eva, a cross-chain bridge AI supporting Sui, Solana, and Ethereum.

Extract the user's intent from their message and conversation history.

INTENT TYPES:
- bridge: user wants to move assets between chains
- quote: asking for exchange rate or fee
- balance: asking about their wallet balance or holdings
- history: asking about past bridges ("did my last bridge go through?", "show my transactions")
- status: asking about a specific in-progress bridge
- help: asking how Eva works
- cancel: wants to cancel a pending bridge
- unrelated: not about bridging or this wallet

DIRECTION MAPPING:
- "SUI to SOL/Solana" → SUI_TO_SOL
- "SOL/Solana to SUI" → SOL_TO_SUI
- "SUI to ETH/Ethereum" → SUI_TO_ETH
- "ETH/Ethereum to SUI" → ETH_TO_SUI
- SOL↔ETH is NOT supported
${walletBlock}${historyBlock}

AMOUNT: Extract as resolved numeric string. If wallet context is available, resolve relative amounts.
If truly no amount and cannot be resolved, set amountMissing: true.
RECIPIENT: Only set if user explicitly provides an address. "to my wallet" → recipientMissing: true.

CONVERSATION HISTORY: Use prior messages to resolve references like "make it 0.8 instead", "cancel that", "same route again".`;

  const messages: Array<{
    role: "system" | "human" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  for (const turn of (conversationHistory || []).slice(-4)) {
    messages.push({
      role: turn.role === "user" ? "human" : "assistant",
      content: turn.content,
    });
  }
  messages.push({ role: "human", content: state.message });

  try {
    const result = (await Promise.race([
      structuredLlm.invoke(messages),
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

async function validateNode(state: typeof BridgeAgentState.State) {
  const { intent, walletContext } = state;
  if (!intent || intent.intent !== "bridge") return { validationError: null };

  if (intent.directionMissing || !intent.direction) {
    return {
      validationError:
        'Which direction are we moving? Try something like *"Bridge 0.5 SUI to Solana"* or *"0.002 SOL to SUI"*.',
    };
  }

  if (intent.amountMissing || !intent.amount) {
    const hint = walletContext
      ? ` You have ${walletContext.suiBalance} SUI available.`
      : "";
    return {
      validationError: `How much ${sourceTokenOf(intent.direction as BridgeDirection)} do you want to move?${hint} Drop an amount and I'll get it ready.`,
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
    return { validationError: "That amount is too large for me to handle." };
  }

  switch (dir) {
    case "SUI_TO_SOL":
    case "SUI_TO_ETH":
      if (amountBase < BRIDGE_CFG.minAmountSui)
        return {
          validationError: `The minimum I can bridge is **${formatSui(BRIDGE_CFG.minAmountSui)} SUI**. Bump it up a little and we're good.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountSui)
        return {
          validationError: `I can only move up to **${formatSui(BRIDGE_CFG.maxAmountSui)} SUI** per transaction. Want to split it?`,
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
          validationError: `Minimum here is **${formatEth(BRIDGE_CFG.minAmountEth)} ETH**. Just a bit more and we're set.`,
        };
      if (amountBase > BRIDGE_CFG.maxAmountEth)
        return {
          validationError: `I can only handle up to **${formatEth(BRIDGE_CFG.maxAmountEth)} ETH** at a time.`,
        };
      break;
  }

  if (dir === "SUI_TO_SOL" || dir === "SUI_TO_ETH") {
    const balanceMist = walletContext?.suiBalanceMist ?? null;

    if (balanceMist !== null) {
      const totalNeeded = amountBase + BRIDGE_CFG.estimatedSuiGasMist;
      if (balanceMist < totalNeeded) {
        const needed = formatSui(totalNeeded);
        const have = formatSui(balanceMist);
        return {
          validationError:
            `You're a bit short for this one. This bridge needs **${needed} SUI** (including gas), but I'm seeing **${have} SUI** in your wallet. ` +
            `Top it up or try a smaller amount.`,
        };
      }
    } else if (state.userId) {
      try {
        state.sse.status("Checking your balance...");
        const blockVision = getBlockVisionService();
        const portfolio = await blockVision.getAccountPortfolio(state.userId);
        const suiCoin = portfolio.coins.find(
          (c: any) => c.coinType === "0x2::sui::SUI" || c.symbol === "SUI",
        );
        if (suiCoin) {
          const balSui = parseFloat(
            suiCoin.balance.toString().replace(/,/g, ""),
          );
          const balMist = BigInt(Math.floor(balSui * 1e9));
          const totalNeeded = amountBase + BRIDGE_CFG.estimatedSuiGasMist;
          if (balMist < totalNeeded) {
            return {
              validationError: `You're a bit short. Need **${formatSui(totalNeeded)} SUI** (including gas), have **${formatSui(balMist)} SUI**. Top it up or try less.`,
            };
          }
        }
      } catch (err: any) {
        console.warn("[BRIDGE] Balance check fallback failed:", err?.message);
      }
    }
  }

  return { validationError: null };
}

async function buildTxNode(state: typeof BridgeAgentState.State) {
  const {
    intent,
    validationError,
    walletContext,
    recentTxs,
    conversationHistory,
  } = state;

  if (!intent) {
    return {
      responseText:
        'I didn\'t quite catch that. Try something like *"Bridge 0.5 SUI to Solana"*.',
      actionEvent: null,
    };
  }

  if (intent.intent === "balance") {
    if (walletContext) {
      const half = (parseFloat(walletContext.suiBalance) / 2).toFixed(4);
      return {
        responseText:
          `You've got **${walletContext.suiBalance} SUI** in your wallet.\n\n` +
          `Max you can bridge right now is **${walletContext.bridgeableMaxSui} SUI** (reserving a little for gas).\n\n` +
          `Want to move some? Try *"Bridge ${half} SUI to Solana"* or tell me the amount.`,
        actionEvent: null,
      };
    }
    return {
      responseText:
        "I couldn't reach your wallet right now — BlockVision may be slow. Try again in a moment.",
      actionEvent: null,
    };
  }

  if (intent.intent === "history") {
    state.sse.status("Checking your bridge history...");
    if (recentTxs.length === 0) {
      return {
        responseText:
          "You haven't bridged anything yet — or at least nothing I can see. Start one and I'll track it for you.",
        actionEvent: null,
      };
    }

    const txSummary = recentTxs
      .map((tx, i) => {
        const ago = Math.round(
          (Date.now() - new Date(tx.created_at).getTime()) / 60000,
        );
        return `${i + 1}. ${tx.source_chain}→${tx.dest_chain}: ${tx.amount_in} → ~${tx.amount_out} | ${tx.status} | ${ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`}`;
      })
      .join("\n");

    try {
      const response = await conversationalLlm.invoke([
        {
          role: "system",
          content: `You are Eva, a warm and direct bridge AI companion. The user asked about their recent bridge transactions.
Summarise the following transactions naturally in Eva's voice — conversational, not a table.
Highlight the most recent one first. Note if anything is still pending.
Keep it brief (3–5 sentences max). End with a helpful offer.`,
        },
        {
          role: "human",
          content: `Recent bridges:\n${txSummary}\n\nUser asked: "${state.message}"`,
        },
      ]);
      return {
        responseText: (response as any).content as string,
        actionEvent: null,
      };
    } catch {
      return {
        responseText: `Here's what I see from your recent bridges:\n\n${txSummary}\n\nYou can also check the **Transactions** button at the top for full details and explorer links.`,
        actionEvent: null,
      };
    }
  }

  if (intent.intent === "status") {
    state.sse.status("Looking up your bridges...");

    const pending = recentTxs.find((tx) => tx.status === "submitted");
    if (pending) {
      const ago = Math.round(
        (Date.now() - new Date(pending.created_at).getTime()) / 60000,
      );
      return {
        responseText: `Your most recent bridge (${pending.source_chain}→${pending.dest_chain}, ${pending.amount_in}) is still **pending** — started ${ago} minutes ago. Delivery usually takes 1–3 minutes. Check the **Transactions** button for the full status.`,
        actionEvent: null,
      };
    }
    return {
      responseText:
        "Hit the **Transactions** button up top — all your bridges are tracked there with status and explorer links.",
      actionEvent: null,
    };
  }

  if (intent.intent === "help")
    return { responseText: buildHelpMessage(walletContext), actionEvent: null };
  if (intent.intent === "quote")
    return {
      responseText: buildQuoteMessage(
        intent.direction as BridgeDirection | undefined,
        walletContext,
      ),
      actionEvent: null,
    };
  if (intent.intent === "cancel")
    return {
      responseText:
        "Cancelled. Whenever you're ready, just tell me where you want to move your assets.",
      actionEvent: null,
    };
  if (intent.intent === "unrelated") {
    return {
      responseText:
        "I'm Eva — I move assets between Sui, Solana, and Ethereum. That's my thing.\n\nTry *\"Bridge 0.5 SUI to Solana\"* and I'll set it up.",
      actionEvent: null,
    };
  }

  if (validationError)
    return { responseText: validationError, actionEvent: null };

  if (intent.intent !== "bridge" || !intent.direction || !intent.amount) {
    return {
      responseText: walletContext
        ? `Tell me the amount and direction. You have **${walletContext.suiBalance} SUI** available — want to bridge some of it?`
        : 'Tell me the amount and which direction — something like *"Bridge 0.5 SUI to Solana"*.',
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

  const balanceNote =
    walletContext && (dir === "SUI_TO_SOL" || dir === "SUI_TO_ETH")
      ? `\n*Remaining after bridge: ~${formatSui(walletContext.suiBalanceMist - amountIn - BRIDGE_CFG.estimatedSuiGasMist)} SUI*`
      : "";

  const responseText =
    `Here's what this bridge looks like:\n\n` +
    `**Sending:** ${amountInDisplay}\n` +
    `**Arriving:** ~${amountOutDisplay}\n` +
    `**Route:** ${sourceChainOf(dir)} → ${destChainOf(dir)}\n` +
    `**Fee:** ${feePercent}%  ·  **Rate:** ${displayRate(dir)}\n` +
    `**ETA:** ~1–2 minutes after you sign` +
    `${balanceNote}\n\n` +
    `Looks good? Hit **Confirm** and approve it in your wallet. I'll watch the delivery from there.`;

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

function buildHelpMessage(walletContext: WalletContext | null): string {
  const balanceLine = walletContext
    ? `\n**Your SUI balance:** ${walletContext.suiBalance} SUI (${walletContext.bridgeableMaxSui} SUI bridgeable)\n`
    : "";
  return (
    `Hey, I'm **Eva** — I move your assets between chains so you don't have to think about the plumbing.\n\n` +
    `**What I can do:**\n` +
    `- SUI → SOL  ·  SOL → SUI\n` +
    `- SUI → ETH  ·  ETH → SUI\n` +
    balanceLine +
    `\n` +
    `**How it goes:**\n` +
    `Tell me what you want to move — including relative amounts like "half my SUI" or "bridge everything to Solana". ` +
    `I'll check your balance, calculate what arrives on the other side, and set up the transaction. ` +
    `You approve it in your wallet — I never touch your keys — and I'll track delivery until it lands.\n\n` +
    `**Current fee:** ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% · Delivery is usually 1–2 minutes.\n\n` +
    `*Try: "How much SUI do I have?", "Bridge half my SUI to Solana", or "What's the rate for ETH to SUI?"*`
  );
}

function buildQuoteMessage(
  direction?: BridgeDirection,
  walletContext?: WalletContext | null,
): string {
  const balanceLine = walletContext
    ? `\n*You have ${walletContext.suiBalance} SUI available.*`
    : "";

  if (!direction) {
    const lines = SUPPORTED_ROUTES.map(
      (d) => `- **${sourceChainOf(d)} → ${destChainOf(d)}:** ${displayRate(d)}`,
    );
    return (
      `Current rates (${(BRIDGE_CFG.feeBps / 100).toFixed(2)}% fee baked in):\n\n` +
      lines.join("\n") +
      balanceLine +
      `\n\nRates update with the market. Ready to move something? Just tell me the amount.`
    );
  }

  return (
    `**${sourceChainOf(direction)} → ${destChainOf(direction)}**\n\n` +
    `Rate: ${displayRate(direction)}\n` +
    `Fee: ${(BRIDGE_CFG.feeBps / 100).toFixed(2)}%` +
    balanceLine +
    `\n\n` +
    `Want to go? Try *"Bridge 0.5 ${sourceTokenOf(direction)} to ${destChainOf(direction)}"* and I'll get it ready.`
  );
}

let compiledGraph: any = null;

function getCompiledGraph() {
  if (!compiledGraph) {
    compiledGraph = new StateGraph(BridgeAgentState)
      .addNode("fetchWalletContext", fetchWalletContextNode)
      .addNode("parseIntent", parseIntentNode)
      .addNode("validate", validateNode)
      .addNode("buildTx", buildTxNode)
      .addNode("respond", respondNode)
      .addEdge("__start__", "fetchWalletContext")
      .addEdge("fetchWalletContext", "parseIntent")
      .addEdge("parseIntent", "validate")
      .addEdge("validate", "buildTx")
      .addEdge("buildTx", "respond")
      .addEdge("respond", "__end__")
      .compile();
  }
  return compiledGraph;
}

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
        conversationHistory: (req as any).conversationHistory || [],
        walletContext: null,
        recentTxs: [],
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
