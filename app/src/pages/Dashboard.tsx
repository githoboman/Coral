import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { sileo } from "sileo";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAccount, useSendTransaction } from "wagmi";

import {
  ArrowUp,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronDown,
  Clock,
  Plus,
  Check,
  Bell,
  Activity,
  TrendingUp,
  Search,
  Wallet,
  PieChart,
  Zap,
  Send,
  Eye,
  LucideIcon,
  Shield,
  Repeat,
  Image,
  Star,
  MessageCircle,
  Crown,
  AlertTriangle,
  X,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { RecentChatsModal } from "@/components/RecentChatsModal";
import { ChatSkeleton } from "@/components/ui/SkeletonLoader";

// ── Types ──────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  icon: string;
  cost: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId?: string;
  bridgePayload?: BridgeActionPayload; // attached when agent emits bridge_transaction_ready
}

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
  tempId?: string;
  createdAt?: string;
}

interface Prompt {
  label: string;
  prompt: string;
  keywords: string[];
  icon: LucideIcon;
}

interface Category {
  label: string;
  value: string;
  icon: LucideIcon;
  description: string;
}

export interface BridgeActionPayload {
  type: "bridge_transaction_ready";
  direction: "SUI_TO_SOL" | "SOL_TO_SUI" | "SUI_TO_ETH" | "ETH_TO_SUI";
  amountIn: string;
  amountOut: string;
  amountInDisplay: string;
  amountOutDisplay: string;
  sourceChain: string;
  destChain: string;
  sourceToken: string;
  destToken: string;
  feePercent: string;
  txPayload: {
    chain: "sui" | "solana" | "ethereum";
    type: string;
    amountMist?: string;
    amountLamports?: string;
    amountWei?: string;
    destChainId?: number;
    recipientAddress?: string | null;
    packageId?: string;
    poolObjectId?: string;
    vaultAddress?: string;
    memoProgramId?: string;
    suiRecipientAddress?: string | null;
  };
  recipientAddress: string | null;
  recipientMissing: boolean;
}

// ── Static Data ────────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  {
    id: "task",
    name: "Task Manager",
    icon: "/assets/images/agents/task-agent.svg",
    cost: "Free",
  },
  {
    id: "research",
    name: "Research Agent",
    icon: "/assets/images/agents/research-agent.svg",
    cost: "Free",
  },
  {
    id: "bridge",
    name: "Bridge Agent",
    icon: "/assets/images/agents/bridge-agent.svg",
    cost: "Free",
  },
];

const AGENT_THINKING_STEPS: Record<string, string[]> = {
  research: [
    "Understanding your request",
    "Searching knowledge base",
    "Analyzing blockchain data",
    "Cross-referencing sources",
    "Synthesizing findings",
    "Preparing response",
  ],
  tovira: [
    "Processing your request",
    "Checking wallet data",
    "Analyzing portfolio metrics",
    "Fetching market data",
    "Generating insights",
  ],
  task: [
    "Interpreting your request",
    "Evaluating task parameters",
    "Checking existing schedules",
    "Configuring automation",
    "Validating task setup",
    "Finalizing task",
  ],
  alert: [
    "Parsing alert conditions",
    "Checking monitoring channels",
    "Configuring thresholds",
    "Setting up notifications",
    "Activating monitors",
  ],
  // Bridge agent thinking steps
  bridge: [
    "Understanding your request",
    "Validating amounts and route",
    "Checking bridge rates",
    "Preparing transaction",
    "Ready for signing",
  ],
};

const CATEGORIES: Record<string, Category[]> = {
  research: [
    {
      label: "On-Chain Insights",
      value: "on-chain",
      icon: Activity,
      description: "Wallet holdings, portfolios, & NFT assets",
    },
    {
      label: "Risk Assessment",
      value: "risk",
      icon: Shield,
      description: "Security scans, rug detection, & sentiment",
    },
    {
      label: "Token Research",
      value: "token",
      icon: PieChart,
      description: "Real-time pricing, stats, & performance",
    },
    {
      label: "Ecosystem Search",
      value: "search",
      icon: Search,
      description: "Protocol deep dives & market news",
    },
  ],
  tovira: [
    {
      label: "Wallet",
      value: "Wallet",
      icon: Wallet,
      description: "Balances and holdings",
    },
    {
      label: "Transactions",
      value: "Transactions",
      icon: Clock,
      description: "History and activity",
    },
    {
      label: "DeFi",
      value: "DeFi",
      icon: Repeat,
      description: "Swaps and liquidity",
    },
    {
      label: "NFTs",
      value: "NFTs",
      icon: Image,
      description: "Collections and galleries",
    },
  ],
  task: [
    {
      label: "Schedule",
      value: "Schedule",
      icon: Clock,
      description: "Daily plans and reminders",
    },
    {
      label: "Social",
      value: "Social",
      icon: MessageCircle,
      description: "Tweets, discord, and engagement",
    },
    {
      label: "Finance",
      value: "Finance",
      icon: Wallet,
      description: "Balances, gas, and portfolio",
    },
    {
      label: "Routine",
      value: "Routine",
      icon: Repeat,
      description: "Recurring tasks and habits",
    },
  ],
  alert: [
    {
      label: "Price",
      value: "Price Alert",
      icon: Bell,
      description: "Price targets and movements",
    },
    {
      label: "On-Chain",
      value: "On-Chain Alert",
      icon: Activity,
      description: "Whales, gas, and contracts",
    },
    {
      label: "Social",
      value: "Social Alert",
      icon: MessageCircle,
      description: "Sentiment and volume",
    },
    {
      label: "Listings",
      value: "New Listing",
      icon: Star,
      description: "New exchanges and tokens",
    },
  ],
  // Bridge categories shown in empty state
  bridge: [
    {
      label: "SUI → SOL",
      value: "Bridge 0.5 SUI to Solana",
      icon: Repeat,
      description: "Bridge SUI tokens to Solana",
    },
    {
      label: "SOL → SUI",
      value: "Bridge 0.001 SOL to SUI",
      icon: Repeat,
      description: "Bridge SOL tokens to Sui",
    },
    {
      label: "SUI → ETH",
      value: "Bridge 0.5 SUI to Ethereum",
      icon: Repeat,
      description: "Bridge SUI to Ethereum Sepolia",
    },
    {
      label: "ETH → SUI",
      value: "Bridge 0.00005 ETH to SUI",
      icon: Repeat,
      description: "Bridge ETH to Sui",
    },
  ],
};

const PROMPTS: Record<string, Prompt[]> = {
  research: [
    {
      label: "Wallet Portfolio",
      prompt: "Show me the portfolio and top holdings of wallet: 0x...",
      keywords: ["on-chain", "wallet", "portfolio"],
      icon: Wallet,
    },
    {
      label: "NFT Holdings",
      prompt: "Analyze the NFT assets held by wallet: 0x...",
      keywords: ["on-chain", "nfts", "wallet"],
      icon: Image,
    },
    {
      label: "Security Scan",
      prompt: "Perform a risk and security audit for token: 0x...",
      keywords: ["risk", "security", "token"],
      icon: Shield,
    },
    {
      label: "Market Sentiment",
      prompt: "What is the current market sentiment for the SUI ecosystem?",
      keywords: ["search", "sentiment", "market"],
      icon: MessageCircle,
    },
    {
      label: "Token Price",
      prompt: "Check the price and performance for token: 0x2::sui::SUI",
      keywords: ["token", "price", "stats"],
      icon: PieChart,
    },
    {
      label: "Protocol Deep Dive",
      prompt: "Deep dive into the Aftermath Finance protocol on Sui",
      keywords: ["search", "protocol", "aftermath"],
      icon: Search,
    },
    {
      label: "Latest Sui News",
      prompt: "Find the latest news about the Sui ecosystem expansion",
      keywords: ["search", "news", "sui"],
      icon: TrendingUp,
    },
  ],
  tovira: [
    {
      label: "Check Balance",
      prompt: "What is my current SUI balance?",
      keywords: ["wallet", "balance"],
      icon: Wallet,
    },
    {
      label: "Transaction History",
      prompt: "Show my last 5 transactions",
      keywords: ["transactions", "history"],
      icon: Clock,
    },
    {
      label: "Swap Tokens",
      prompt: "I want to swap SUI for USDC",
      keywords: ["defi", "swap", "trade"],
      icon: Repeat,
    },
    {
      label: "View NFTs",
      prompt: "Show my NFT gallery",
      keywords: ["nfts", "gallery", "collectibles"],
      icon: Image,
    },
    {
      label: "Gas Fees",
      prompt: "Check current gas prices",
      keywords: ["wallet", "gas", "fees"],
      icon: Zap,
    },
    {
      label: "Send Tokens",
      prompt: "Send 10 SUI to...",
      keywords: ["wallet", "send", "transfer"],
      icon: Send,
    },
  ],
  task: [
    {
      label: "Daily Schedule",
      prompt:
        "I need to visit the spa by 2pm, check my crypto portfolio at 3pm, and attend a DAO meeting by 7pm today. Kindly remind me when due.",
      keywords: ["schedule", "plan", "remind"],
      icon: Clock,
    },
    {
      label: "NFT Launch",
      prompt:
        "Remind me to make a tweet about my latest NFT drop for tomorrow at 10am and remind me to check the engagement at 2pm same day",
      keywords: ["nft", "social", "marketing"],
      icon: Image,
    },
    {
      label: "Check Balance",
      prompt: "Remind me to check my ETH balance at 5pm",
      keywords: ["balance", "wallet", "check"],
      icon: Wallet,
    },
    {
      label: "Gas Check",
      prompt: "Remind me to check gas fees before the mint starts at 8pm",
      keywords: ["gas", "mint", "fees"],
      icon: Zap,
    },
    {
      label: "WL Grind",
      prompt:
        "Remind me to interact with the protocol discord every 6 hours for whitelist grinding",
      keywords: ["social", "discord", "whitelist"],
      icon: MessageCircle,
    },
    {
      label: "Weekly Review",
      prompt:
        "Create a task to review my trading performance every Sunday at 9pm",
      keywords: ["review", "trading", "recurring"],
      icon: PieChart,
    },
  ],
  alert: [
    {
      label: "Price Alert",
      prompt: "Alert me when SUI hits $2.50",
      keywords: ["price", "target", "market"],
      icon: Bell,
    },
    {
      label: "Whale Watch",
      prompt: "Notify me of transfers > 100k SUI",
      keywords: ["on-chain", "whale", "movement"],
      icon: Eye,
    },
    {
      label: "Gas Spike",
      prompt: "Alert if gas > 1000 MIST",
      keywords: ["on-chain", "gas", "fees"],
      icon: Zap,
    },
    {
      label: "Social Sentiment",
      prompt: "Alert on negative social sentiment spike",
      keywords: ["social", "sentiment", "twitter"],
      icon: MessageCircle,
    },
    {
      label: "New Listing",
      prompt: "Notify of new CEX listings",
      keywords: ["listings", "exchange", "new"],
      icon: Star,
    },
  ],
  // Bridge prompts for autocomplete
  bridge: [
    {
      label: "Bridge SUI to Solana",
      prompt: "Bridge 0.5 SUI to Solana",
      keywords: ["bridge", "sui", "sol", "solana"],
      icon: Repeat,
    },
    {
      label: "Bridge SUI to Ethereum",
      prompt: "Bridge 0.5 SUI to Ethereum",
      keywords: ["bridge", "sui", "eth", "ethereum"],
      icon: Repeat,
    },
    {
      label: "Bridge SOL to Sui",
      prompt: "Bridge 0.001 SOL to SUI",
      keywords: ["bridge", "sol", "sui", "solana"],
      icon: Repeat,
    },
    {
      label: "Bridge ETH to Sui",
      prompt: "Bridge 0.00005 ETH to SUI",
      keywords: ["bridge", "eth", "sui", "ethereum"],
      icon: Repeat,
    },
    {
      label: "Bridge Rate",
      prompt: "What's the current rate for bridging SUI to Solana?",
      keywords: ["rate", "fee", "quote", "bridge"],
      icon: TrendingUp,
    },
    {
      label: "How it works",
      prompt: "How does the bridge work?",
      keywords: ["help", "how", "bridge", "explain"],
      icon: MessageCircle,
    },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────

function getAgent(id: string): Agent {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}

let msgCounter = 100;
function nextId() {
  return `m-${++msgCounter}`;
}

// ── Simple Markdown Renderer ──────────────────────────────────────────

function renderMarkdown(text: string, cursor?: React.ReactNode) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    const suffix = isLastLine ? cursor : null;

    if (line.trim() === "") {
      elements.push(
        <div key={i} className="h-3">
          {suffix}
        </div>,
      );
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-white/10 my-2" />);
      i++;
      continue;
    }
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-lg font-bold text-white mt-3 mb-1">
          {renderInline(line.slice(2))}
          {suffix}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-base font-bold text-white mt-2 mb-1">
          {renderInline(line.slice(3))}
          {suffix}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="text-sm font-semibold text-white/90 mt-2 mb-0.5">
          {renderInline(line.slice(4))}
          {suffix}
        </h4>,
      );
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      elements.push(
        <div
          key={i}
          className="border-l-2 border-[#B7FC0D]/50 pl-3 my-1 text-white/60 text-sm italic"
        >
          {renderInline(line.slice(2))}
          {suffix}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      elements.push(
        <div key={i} className="flex gap-2 pl-1 mb-1">
          <span className="text-white/40 flex-shrink-0">
            {line.match(/^\d+/)![0]}.
          </span>
          <span>
            {renderInline(line.replace(/^\d+\.\s*/, ""))}
            {suffix}
          </span>
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 pl-1 mb-1">
          <span className="text-[#B7FC0D] flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-[#B7FC0D] inline-block" />
          <span>
            {renderInline(line.slice(2))}
            {suffix}
          </span>
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      let codeContent = "";
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeContent += lines[i] + "\n";
        i++;
      }
      elements.push(
        <pre
          key={i}
          className="bg-white/5 border border-white/10 rounded-xl p-3 my-2 font-mono text-xs text-white/90 overflow-x-auto whitespace-pre-wrap"
        >
          {codeContent.trim()}
          {suffix}
        </pre>,
      );
      i++;
      continue;
    }
    elements.push(
      <p key={i} className="mb-1 leading-relaxed break-words">
        {renderInline(line)}
        {suffix}
      </p>,
    );
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={i} className="text-white/70 italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── ThinkingIndicator ─────────────────────────────────────────────────

function ThinkingIndicator({
  agentId,
  agentIcon,
  agentName,
  statusOverride,
}: {
  agentId: string;
  agentIcon: string;
  agentName: string;
  statusOverride?: string | null;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = AGENT_THINKING_STEPS[agentId] || AGENT_THINKING_STEPS.research;

  useEffect(() => {
    setStepIndex(0);
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 1800);
    return () => clearInterval(interval);
  }, [agentId, steps.length]);

  const currentStep = statusOverride || steps[stepIndex];

  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1">
        <img src={agentIcon} alt="" className="w-6 h-6 object-contain" />
      </div>
      <div className="flex-1">
        <span className="text-xs font-medium text-white/40 mb-2 block">
          {agentName}
        </span>
        <div className="flex items-center gap-3 py-2">
          <div className="relative w-4 h-4 flex-shrink-0">
            <div
              className="absolute inset-0 rounded-full border-2 border-transparent"
              style={{
                borderTopColor: "#B7FC0D",
                borderRightColor: "rgba(183, 252, 13, 0.3)",
                animation: "spin 0.8s linear infinite",
              }}
            />
          </div>
          <div className="relative h-5 flex items-center overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={currentStep}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="text-sm text-white/50 font-medium whitespace-nowrap"
              >
                {currentStep}
                <span className="inline-flex ml-0.5 tracking-widest">
                  <span
                    className="animate-pulse"
                    style={{ animationDelay: "0ms" }}
                  >
                    .
                  </span>
                  <span
                    className="animate-pulse"
                    style={{ animationDelay: "200ms" }}
                  >
                    .
                  </span>
                  <span
                    className="animate-pulse"
                    style={{ animationDelay: "400ms" }}
                  >
                    .
                  </span>
                </span>
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// BridgeActionCard — standalone component, NOT nested inside anything
// ══════════════════════════════════════════════════════════════════════

function BridgeActionCard({
  payload,
  suiAddress,
  signAndExecuteSui,
  solanaPublicKey,
  solanaConnection,
  sendSolTx,
  ethAddress,
  sendEthTx,
  onDismiss,
}: {
  payload: BridgeActionPayload;
  suiAddress?: string;
  signAndExecuteSui?: (args: any, callbacks: any) => void;
  solanaPublicKey?: any;
  solanaConnection?: any;
  sendSolTx?: (tx: any, connection: any) => Promise<string>;
  ethAddress?: `0x${string}`;
  sendEthTx?: (params: any) => Promise<`0x${string}`>;
  onDismiss: () => void;
}) {
  const [status, setStatus] = useState<
    "idle" | "signing" | "submitted" | "complete" | "failed"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chain = payload.txPayload.chain;

  function resolveRecipient(): string | null {
    if (payload.recipientAddress) return payload.recipientAddress;
    if (
      payload.direction === "SOL_TO_SUI" ||
      payload.direction === "ETH_TO_SUI"
    ) {
      return suiAddress || null;
    }
    if (payload.direction === "SUI_TO_SOL") {
      return solanaPublicKey?.toBase58() || null;
    }
    if (payload.direction === "SUI_TO_ETH") {
      return ethAddress || null;
    }
    return null;
  }

  async function handleSign() {
    setStatus("signing");
    setError(null);

    const recipient = resolveRecipient();
    if (!recipient) {
      setError(
        `Please connect your ${payload.destChain} wallet first to receive funds.`,
      );
      setStatus("failed");
      return;
    }

    try {
      if (chain === "sui") {
        if (!signAndExecuteSui) throw new Error("Sui wallet not ready");

        // Dynamic imports keep bundle small — these are already installed
        const { Transaction } = await import("@mysten/sui/transactions");
        const { bcs } = await import("@mysten/sui/bcs");

        const tx = new Transaction();
        const amountMist = BigInt(payload.txPayload.amountMist!);
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
        const recipientBytes = Array.from(new TextEncoder().encode(recipient));
        tx.moveCall({
          target: `${payload.txPayload.packageId}::bridge::lock_sui`,
          arguments: [
            tx.object(payload.txPayload.poolObjectId!),
            coin,
            tx.pure.u8(payload.txPayload.destChainId!),
            tx.pure(bcs.vector(bcs.u8()).serialize(recipientBytes)),
          ],
        });

        const txBytes = await tx.toJSON();

        // signAndExecuteSui is callback-based, not promise-based
        signAndExecuteSui(
          { transaction: txBytes },
          {
            onSuccess: (result: any) => {
              setTxHash(result.digest);
              setStatus("complete");
            },
            onError: (err: any) => {
              setError(err.message || "Transaction rejected");
              setStatus("failed");
            },
          },
        );
        setStatus("submitted");
      } else if (chain === "solana") {
        if (!solanaPublicKey || !solanaConnection || !sendSolTx) {
          throw new Error("Solana wallet not connected");
        }

        const {
          SystemProgram,
          Transaction: SolTx,
          PublicKey,
          TransactionInstruction,
        } = await import("@solana/web3.js");

        const MEMO_PROGRAM_ID = new PublicKey(payload.txPayload.memoProgramId!);
        const vaultPubkey = new PublicKey(payload.txPayload.vaultAddress!);
        const amountLamports = BigInt(payload.txPayload.amountLamports!);

        const { blockhash, lastValidBlockHeight } =
          await solanaConnection.getLatestBlockhash("confirmed");

        const tx = new SolTx({
          feePayer: solanaPublicKey,
          blockhash,
          lastValidBlockHeight,
        });
        tx.add(
          SystemProgram.transfer({
            fromPubkey: solanaPublicKey,
            toPubkey: vaultPubkey,
            lamports: amountLamports,
          }),
        );
        tx.add(
          new TransactionInstruction({
            keys: [],
            programId: MEMO_PROGRAM_ID,
            data: new TextEncoder().encode(`sui:${recipient}`),
          }),
        );

        const sig = await sendSolTx(tx, solanaConnection);
        setTxHash(sig);
        setStatus("complete");
      } else if (chain === "ethereum") {
        if (!sendEthTx) throw new Error("Ethereum wallet not connected");

        const amountWei = BigInt(payload.txPayload.amountWei!);
        const bytes = new TextEncoder().encode(recipient);
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const data = `0x${hex}` as `0x${string}`;

        const hash = await sendEthTx({
          to: payload.txPayload.vaultAddress as `0x${string}`,
          value: amountWei,
          data,
        });
        setTxHash(hash);
        setStatus("complete");
      }
    } catch (err: any) {
      console.error("[BridgeActionCard] Sign error:", err);
      setError(err.message || "Transaction failed");
      setStatus("failed");
    }
  }

  function explorerUrl(): string | null {
    if (!txHash) return null;
    if (chain === "sui") return `https://suiscan.xyz/testnet/tx/${txHash}`;
    if (chain === "solana")
      return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
    if (chain === "ethereum")
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    return null;
  }

  const isLoading = status === "signing" || status === "submitted";

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-w-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/50 uppercase tracking-widest">
            Bridge Preview
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-[#B7FC0D]/10 text-[#B7FC0D] rounded-full font-bold border border-[#B7FC0D]/20">
            Testnet
          </span>
        </div>
        {status === "idle" && (
          <button
            onClick={onDismiss}
            className="text-white/20 hover:text-white/50 transition-colors text-xs"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Amount row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 bg-white/5 rounded-xl p-3 text-center">
          <div className="text-white font-bold text-sm">
            {payload.amountInDisplay}
          </div>
          <div className="text-white/40 text-[10px] mt-0.5">
            {payload.sourceChain}
          </div>
        </div>
        <ArrowRight size={16} className="text-white/30 flex-shrink-0" />
        <div className="flex-1 bg-white/5 rounded-xl p-3 text-center">
          <div className="text-[#B7FC0D] font-bold text-sm">
            ~{payload.amountOutDisplay}
          </div>
          <div className="text-white/40 text-[10px] mt-0.5">
            {payload.destChain}
          </div>
        </div>
      </div>

      {/* Fee */}
      <div className="flex justify-between items-center px-1 mb-4">
        <span className="text-white/30 text-xs">Fee</span>
        <span className="text-white/50 text-xs font-mono">
          {payload.feePercent}%
        </span>
      </div>

      {/* Recipient missing warning */}
      {payload.recipientMissing && !resolveRecipient() && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-3 text-xs text-amber-400">
          ⚠ Connect your {payload.destChain} wallet to receive funds, then click
          Sign & Bridge.
        </div>
      )}

      {/* Error */}
      {status === "failed" && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-3 flex items-start gap-2">
          <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-red-400 text-xs">{error}</span>
        </div>
      )}

      {/* Success */}
      {status === "complete" && txHash && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-3 flex items-start gap-2">
          <CheckCircle2
            size={14}
            className="text-emerald-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <div className="text-emerald-400 text-xs font-bold mb-1">
              Transaction submitted!
            </div>
            <div className="text-white/40 text-[10px]">
              Delivery takes ~2–3 minutes. The relayer is processing your
              bridge.
            </div>
            {explorerUrl() && (
              <a
                href={explorerUrl()!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[#B7FC0D] text-[10px] mt-1 hover:underline"
              >
                View on explorer <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* CTA */}
      {status !== "complete" && (
        <button
          onClick={handleSign}
          disabled={isLoading}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2
            ${
              isLoading
                ? "bg-white/5 text-white/30 cursor-not-allowed"
                : status === "failed"
                  ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/20"
                  : "bg-gradient-to-r from-[#246AFC] to-[#326AFD] text-white hover:brightness-110 active:scale-[0.98]"
            }`}
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {status === "signing"
                ? "Waiting for approval..."
                : "Submitting..."}
            </>
          ) : status === "failed" ? (
            "Try Again"
          ) : (
            <>
              Sign & Bridge <ArrowRight size={16} />
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MessageBubble — receives bridge payload and renders BridgeActionCard
// ══════════════════════════════════════════════════════════════════════

function MessageBubble({
  message,
  copiedId,
  feedback,
  onCopy,
  onFeedback,
  onRegenerate,
  isLast,
  // Bridge props — only used when message.bridgePayload is set
  suiAddress,
  signAndExecuteSui,
  solanaPublicKey,
  solanaConnection,
  sendSolTx,
  ethAddress,
  sendEthTx,
}: {
  message: Message;
  copiedId: string | null;
  feedback: Record<string, "up" | "down">;
  onCopy: (text: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: () => void;
  isLast: boolean;
  suiAddress?: string;
  signAndExecuteSui?: (args: any, callbacks: any) => void;
  solanaPublicKey?: any;
  solanaConnection?: any;
  sendSolTx?: (tx: any, connection: any) => Promise<string>;
  ethAddress?: `0x${string}`;
  sendEthTx?: (params: any) => Promise<`0x${string}`>;
}) {
  // Track whether the bridge card has been dismissed for THIS message
  const [bridgeDismissed, setBridgeDismissed] = useState(false);

  if (message.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[80%] md:max-w-md bg-[#326AFD] text-white px-5 py-3 rounded-[24px] rounded-br-lg text-[14px] leading-relaxed shadow-lg shadow-[#326AFD]/10 break-words">
          {message.content}
        </div>
      </motion.div>
    );
  }

  const agent = getAgent(message.agentId || "research");
  const isCopied = copiedId === message.id;
  const fb = feedback[message.id];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 max-w-3xl"
    >
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1">
        <img src={agent.icon} alt="" className="w-6 h-6 object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-white/40 mb-2 block">
          {agent.name}
        </span>
        <div className="text-[14px] leading-relaxed text-white/80 break-words">
          {renderMarkdown(message.content)}
        </div>

        {/* Bridge action card — renders beneath the message text when payload is attached */}
        {message.bridgePayload && !bridgeDismissed && (
          <BridgeActionCard
            payload={message.bridgePayload}
            suiAddress={suiAddress}
            signAndExecuteSui={signAndExecuteSui}
            solanaPublicKey={solanaPublicKey}
            solanaConnection={solanaConnection}
            sendSolTx={sendSolTx}
            ethAddress={ethAddress}
            sendEthTx={sendEthTx}
            onDismiss={() => setBridgeDismissed(true)}
          />
        )}

        {/* Message action buttons */}
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={() => onCopy(message.content, message.id)}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
            title="Copy"
          >
            {isCopied ? (
              <Check size={14} className="text-emerald-400" />
            ) : (
              <Copy
                size={14}
                className="text-white/25 group-hover:text-white/50"
              />
            )}
          </button>
          <button
            onClick={() => onFeedback(message.id, "up")}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
            title="Good response"
          >
            <ThumbsUp
              size={14}
              className={
                fb === "up"
                  ? "text-[#B7FC0D]"
                  : "text-white/25 group-hover:text-white/50"
              }
              fill={fb === "up" ? "currentColor" : "none"}
            />
          </button>
          <button
            onClick={() => onFeedback(message.id, "down")}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
            title="Bad response"
          >
            <ThumbsDown
              size={14}
              className={
                fb === "down"
                  ? "text-red-400"
                  : "text-white/25 group-hover:text-white/50"
              }
              fill={fb === "down" ? "currentColor" : "none"}
            />
          </button>
          {isLast && (
            <button
              onClick={onRegenerate}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
              title="Regenerate"
            >
              <RefreshCw
                size={14}
                className="text-white/25 group-hover:text-white/50"
              />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Dashboard
// ══════════════════════════════════════════════════════════════════════

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  const { setMobileActions } = useOutletContext<any>();

  // ── Wallet hooks ────────────────────────────────────────────────────
  const { mutate: signAndExecuteSui } = useSignAndExecuteTransaction();
  const { publicKey: solanaPublicKey, sendTransaction: sendSolTx } =
    useWallet();
  const { connection: solanaConnection } = useConnection();
  const { address: ethAddress } = useAccount();
  const { sendTransactionAsync: sendEthTx } = useSendTransaction();

  // ── Chat state ──────────────────────────────────────────────────────
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const activeConvId = chatId || "";
  const [selectedAgentId, setSelectedAgentId] = useState("task");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [streamedText, setStreamedText] = useState("");
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [showRecents, setShowRecents] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Pending bridge payload — attached to the assistant message once streaming completes
  const pendingBridgePayloadRef = useRef<BridgeActionPayload | null>(null);

  // ── Rate limit state ────────────────────────────────────────────────
  const [taskPromptStatus, setTaskPromptStatus] = useState<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
    resetInSeconds?: number;
  } | null>(null);
  const [researchPromptStatus, setResearchPromptStatus] = useState<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
    resetInSeconds?: number;
  } | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [taskCountdown, setTaskCountdown] = useState<number | null>(null);
  const [researchCountdown, setResearchCountdown] = useState<number | null>(
    null,
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find(
    (c) => c.id === activeConvId || c.tempId === activeConvId,
  );
  const activeAgent = getAgent(selectedAgentId);

  const formatCountdown = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // ── Effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!currentAccount?.address) return;
    if (selectedAgentId !== "task" && selectedAgentId !== "research") return;

    const CACHE_KEY = `${selectedAgentId}PromptStatus-${currentAccount.address}`;
    const endpoint =
      selectedAgentId === "task" ? "task-prompts" : "research-prompts";
    const setter =
      selectedAgentId === "task"
        ? setTaskPromptStatus
        : setResearchPromptStatus;
    const countdownSetter =
      selectedAgentId === "task" ? setTaskCountdown : setResearchCountdown;
    const currentCountdown =
      selectedAgentId === "task" ? taskCountdown : researchCountdown;

    const fetchStatus = async (force = false) => {
      try {
        const url = new URL(
          `${API_BASE_URL}/api/chat/${endpoint}/${currentAccount.address}`,
        );
        if (force) url.searchParams.append("force", "true");
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (res.ok) {
          const status = await res.json();
          setter(status);
          if (status.resetInSeconds) countdownSetter(status.resetInSeconds);
          localStorage.setItem(CACHE_KEY, JSON.stringify(status));
        }
      } catch (e) {
        console.error(`Failed to fetch ${selectedAgentId} prompts:`, e);
      }
    };

    (window as any).refreshPromptStatus = () => fetchStatus(true);

    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setter((prev: any) => prev || parsed);
        if (parsed.resetInSeconds && currentCountdown === null)
          countdownSetter(parsed.resetInSeconds);
      } catch (e) {
        /* ignore */
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [selectedAgentId, currentAccount?.address]);

  useEffect(() => {
    if (taskCountdown === null || taskCountdown <= 0) return;
    const timer = setInterval(
      () =>
        setTaskCountdown((prev) =>
          prev === null || prev <= 1 ? null : prev - 1,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [taskCountdown]);

  useEffect(() => {
    if (researchCountdown === null || researchCountdown <= 0) return;
    const timer = setInterval(
      () =>
        setResearchCountdown((prev) =>
          prev === null || prev <= 1 ? null : prev - 1,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [researchCountdown]);

  useEffect(() => {
    if (!currentAccount?.address) return;
    const fetchChats = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/chats?userId=${currentAccount.address}`,
        );
        if (res.ok) {
          const data = await res.json();
          setConversations(
            data.map((c: any) => ({
              id: c.chat_id,
              title: c.name,
              agentId: c.agent_id,
              createdAt: c.created_at,
              messages: [],
            })),
          );
        }
      } catch (err) {
        console.error("Failed to fetch chats:", err);
      }
    };
    fetchChats();
  }, [currentAccount?.address]);

  useEffect(() => {
    if (!activeConvId || activeConvId.startsWith("conv-")) return;
    if (isStreaming) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv || conv.messages.length > 0) return;

    const fetchMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/chats/${activeConvId}`);
        if (res.ok) {
          const msgs: any[] = await res.json();
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConvId
                ? {
                    ...c,
                    messages: msgs.map((m) => ({
                      id: m.id,
                      role: m.sender as "user" | "assistant",
                      content: m.query,
                      agentId: conv?.agentId,
                    })),
                  }
                : c,
            ),
          );
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        setIsLoadingMessages(false);
      }
    };
    fetchMessages();
  }, [activeConvId, isStreaming]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowAgentDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamedText, isThinking]);

  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleNewChat = useCallback(() => {
    navigate("/chat");
    setShowRecents(false);
  }, [navigate]);

  const streamFromServer = useCallback(
    async (message: string, agentId: string, convId: string) => {
      const userId = currentAccount?.address;
      if (!userId) return false;

      setIsThinking(true);
      setThinkingStatus(null);

      // Clear any previous bridge payload before starting a new stream
      pendingBridgePayloadRef.current = null;

      let fullText = "";
      let aborted = false;
      let currentConvId = convId;

      try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            agentId,
            message,
            chatId: convId,
            client_time: (() => {
              const now = new Date();
              const off = -now.getTimezoneOffset();
              const sign = off >= 0 ? "+" : "-";
              const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
              const hh = pad(Math.floor(off / 60));
              const mm = pad(off % 60);
              return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${hh}:${mm}`;
            })(),
          }),
        });

        if (response.status === 429) {
          const err = await response.json();
          if (err.requiresUpgrade) {
            setShowUpgradeModal(true);
            setIsThinking(false);
            if (currentAccount?.address) {
              const endpoint =
                agentId === "task" ? "task-prompts" : "research-prompts";
              const setter =
                agentId === "task"
                  ? setTaskPromptStatus
                  : setResearchPromptStatus;
              const countdownSetter =
                agentId === "task" ? setTaskCountdown : setResearchCountdown;
              fetch(
                `${API_BASE_URL}/api/chat/${endpoint}/${currentAccount.address}`,
              )
                .then((r) => r.json())
                .then((s) => {
                  setter(s);
                  if (s.resetInSeconds) countdownSetter(s.resetInSeconds);
                });
            }
            return false;
          }
          setIsThinking(false);
          const errorMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: `⏱️ **Rate Limit Reached**\n\n${err.message}`,
          };
          setConversations((prev) =>
            prev.map((c) =>
              c.id !== currentConvId && c.tempId !== currentConvId
                ? c
                : { ...c, messages: [...c.messages, errorMsg] },
            ),
          );
          return false;
        }

        if (!response.ok) return false;

        if (agentId === "task" || agentId === "research") {
          const endpoint =
            agentId === "task" ? "task-prompts" : "research-prompts";
          const setter =
            agentId === "task" ? setTaskPromptStatus : setResearchPromptStatus;
          fetch(`${API_BASE_URL}/api/chat/${endpoint}/${userId}`)
            .then((r) => r.json())
            .then((s) => setter(s));
        }

        const reader = response.body?.getReader();
        if (!reader) return false;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const raw = line.slice(6);
              let parsed: any;
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = { text: raw };
              }

              switch (currentEvent) {
                case "status":
                  if (!aborted) setThinkingStatus(parsed.text || parsed);
                  break;

                case "conversation":
                  if (!aborted && parsed.id && parsed.id !== convId) {
                    currentConvId = parsed.id;
                    if (chatId === convId)
                      navigate(`/chat/${parsed.id}`, { replace: true });
                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === convId
                          ? {
                              ...c,
                              id: parsed.id,
                              tempId: convId,
                              createdAt:
                                parsed.created_at ||
                                c.createdAt ||
                                new Date().toISOString(),
                            }
                          : c,
                      ),
                    );
                  }
                  break;

                case "chunk":
                  if (!aborted) {
                    setIsThinking(false);
                    setThinkingStatus(null);
                    setIsStreaming(true);
                    fullText += parsed.text || "";
                    setStreamedText(fullText);
                  }
                  break;

                case "action":
                  // ── Bridge agent action ──────────────────────────────
                  if (parsed?.type === "bridge_transaction_ready") {
                    // Store in ref — we attach it to the message when streaming completes
                    pendingBridgePayloadRef.current =
                      parsed as BridgeActionPayload;
                  }
                  // ── Task / research actions ──────────────────────────
                  else if (
                    parsed?.type === "task_created" ||
                    parsed?.type === "research_completed"
                  ) {
                    const isTask = parsed.type === "task_created";
                    sileo.success({
                      title: isTask ? "Task Created" : "Research Complete",
                      description: isTask
                        ? "Your task was created successfully."
                        : "Research report is ready.",
                    });
                    if (userId) {
                      fetch(
                        `${API_BASE_URL}/api/task-points/claimable?user_id=${userId}`,
                      )
                        .then((r) => r.json())
                        .then((data) => {
                          if (data.total_activities > 0) {
                            setTimeout(
                              () =>
                                sileo.info({
                                  title: "Activity Points Available",
                                  description: `You have ${data.total_claimable_points} points from ${data.total_activities} activit${data.total_activities !== 1 ? "ies" : "y"} ready to claim.`,
                                }),
                              1500,
                            );
                          }
                        })
                        .catch(() => {});
                    }
                  } else if (parsed?.type === "task_completed") {
                    sileo.success({
                      title: "Task Completed",
                      description: "Nice work!",
                    });
                  } else if (parsed?.type === "task_deleted") {
                    sileo.success({
                      title: "Task Deleted",
                      description: "Task has been removed.",
                    });
                  }
                  break;

                case "error":
                  if (!aborted) {
                    setIsThinking(false);
                    setThinkingStatus(null);
                    setIsStreaming(true);
                    fullText = parsed.message || "An error occurred.";
                    setStreamedText(fullText);
                  }
                  break;

                case "done":
                  aborted = true;
                  break;
              }
            }
          }
        }

        // Commit the streamed message, attaching bridge payload if one arrived
        setIsStreaming(false);
        setStreamedText("");

        if (fullText) {
          const assistantMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: fullText,
            agentId,
            // Attach the bridge payload so BridgeActionCard renders inside this message
            bridgePayload: pendingBridgePayloadRef.current || undefined,
          };
          pendingBridgePayloadRef.current = null;

          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== currentConvId && c.tempId !== currentConvId)
                return c;
              return { ...c, messages: [...c.messages, assistantMsg] };
            }),
          );
        }

        return true;
      } catch (error) {
        console.error("[CHAT] Stream error:", error);
        setIsThinking(false);
        setThinkingStatus(null);
        setIsStreaming(false);
        setStreamedText("");
        return false;
      }
    },
    [currentAccount?.address, selectedAgentId, chatId],
  );

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride || input).trim();
      if (!text || isStreaming || isThinking) return;

      if (selectedAgentId === "task" && taskPromptStatus?.remaining === 0) {
        setShowUpgradeModal(true);
        return;
      }
      if (
        selectedAgentId === "research" &&
        researchPromptStatus?.remaining === 0
      ) {
        setShowUpgradeModal(true);
        return;
      }

      const userMsg: Message = { id: nextId(), role: "user", content: text };
      let currentId = activeConvId;
      const existingConv = conversations.find(
        (c) => c.id === activeConvId || c.tempId === activeConvId,
      );

      if (!existingConv) {
        const newId = `conv-${Date.now()}`;
        currentId = newId;
        setConversations((prev) => [
          {
            id: newId,
            title: text.length > 40 ? text.slice(0, 40) + "..." : text,
            agentId: selectedAgentId,
            messages: [userMsg],
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        navigate(`/chat/${newId}`, { replace: true });
      } else {
        currentId = existingConv.id;
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== existingConv.id
              ? c
              : {
                  ...c,
                  messages: [...c.messages, userMsg],
                  title:
                    c.title === "New conversation"
                      ? text.length > 40
                        ? text.slice(0, 40) + "..."
                        : text
                      : c.title,
                },
          ),
        );
      }

      setInput("");
      const success = await streamFromServer(text, selectedAgentId, currentId);
      if (!success)
        console.error(
          "Failed to connect to backend for agent:",
          selectedAgentId,
        );
    },
    [
      input,
      isStreaming,
      isThinking,
      activeConvId,
      selectedAgentId,
      streamFromServer,
      conversations,
      taskPromptStatus,
      researchPromptStatus,
    ],
  );

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* noop */
    }
  }, []);

  const handleFeedback = useCallback((msgId: string, type: "up" | "down") => {
    setFeedback((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === type ? undefined! : type,
    }));
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || isThinking || !activeConv) return;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConvId) return c;
        const msgs = [...c.messages];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant")
          msgs.pop();
        return { ...c, messages: msgs };
      }),
    );
    const lastUserMsg = activeConv.messages
      .filter((m) => m.role === "user")
      .pop();
    if (lastUserMsg)
      await streamFromServer(
        lastUserMsg.content,
        selectedAgentId,
        activeConvId,
      );
  }, [
    isStreaming,
    isThinking,
    activeConv,
    activeConvId,
    selectedAgentId,
    streamFromServer,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isThinking) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectConversation = (convId: string) => {
    if (isStreaming || isThinking) return;
    navigate(`/chat/${convId}`);
    const conv = conversations.find((c) => c.id === convId);
    if (conv) setSelectedAgentId(conv.agentId);
    setShowRecents(false);
  };

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setShowAgentDropdown(false);
  };

  const handleDeleteConversation = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      try {
        await fetch(`${API_BASE_URL}/api/chats/${id}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to delete chat:", err);
      }
      if (id === activeConvId) navigate("/chat");
    },
    [activeConvId, navigate],
  );

  useEffect(() => {
    setMobileActions?.({
      onRecentClick: () => setShowRecents((p) => !p),
      onNewClick: handleNewChat,
      customAction: (
        <div className="relative pointer-events-auto" ref={dropdownRef}>
          <button
            onClick={() => setShowAgentDropdown((p) => !p)}
            className="w-10 h-10 rounded-full bg-white/[0.03] border border-white/10 flex items-center justify-center cursor-pointer transition-all hover:bg-white/5"
          >
            <img
              src={activeAgent.icon}
              alt={activeAgent.name}
              className="w-6 h-6 object-contain"
            />
          </button>
          <AnimatePresence>
            {showAgentDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full right-[-30px] mt-2 w-56 bg-[#111318] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                {AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      selectAgent(agent.id);
                      setShowAgentDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 transition-colors cursor-pointer ${selectedAgentId === agent.id ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
                  >
                    <img
                      src={agent.icon}
                      alt=""
                      className="w-7 h-7 object-contain"
                    />
                    <span className="text-sm font-medium text-white flex-1 text-left">
                      {agent.name}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agent.cost === "Free" ? "bg-emerald-500/15 text-emerald-400" : "bg-[#B7FC0D]/15 text-[#B7FC0D]"}`}
                    >
                      {agent.cost}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ),
    });
    return () => setMobileActions?.(null);
  }, [
    setMobileActions,
    handleNewChat,
    activeAgent,
    showAgentDropdown,
    selectedAgentId,
  ]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh md:h-[calc(100dvh)] text-white overflow-hidden relative">
      <RecentChatsModal
        isOpen={showRecents}
        onClose={() => setShowRecents(false)}
        conversations={conversations}
        activeId={activeConvId}
        onSelect={selectConversation}
        onDelete={handleDeleteConversation}
      />

      {/* Upgrade Modal */}
      <AnimatePresence>
        {showUpgradeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#18181B] border border-white/10 rounded-3xl shadow-2xl p-5 relative overflow-hidden max-h-[90vh] custom-scrollbar"
            >
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 z-10"
              >
                <X size={20} />
              </button>
              <div className="w-12 h-12 rounded-full bg-[#B7FC0D] flex items-center justify-center mb-4 shadow-lg shadow-[#B7FC0D]/20 mx-auto md:mx-0">
                <Crown size={24} className="text-black fill-current" />
              </div>
              <h2 className="text-lg font-bold text-white mb-2 text-center md:text-left">
                Upgrade to Premium
              </h2>
              <p className="text-white/60 mb-4 text-sm leading-relaxed text-center md:text-left">
                You need to upgrade to premium to continue. The free tier only
                allows 2 prompts per day for this agent.
              </p>
              <div className="bg-[#27272A] rounded-2xl p-3 mb-4 border border-amber-500/20 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle
                    size={14}
                    className="text-amber-500 fill-amber-500/20"
                  />
                  <span className="text-white font-medium text-xs">
                    Limit Reached
                  </span>
                </div>
                <p className="text-white/60 text-xs mb-2 pl-6">
                  Used{" "}
                  <span className="text-white font-bold">
                    {selectedAgentId === "task"
                      ? taskPromptStatus?.used
                      : researchPromptStatus?.used}
                    /
                    {selectedAgentId === "task"
                      ? taskPromptStatus?.limit
                      : researchPromptStatus?.limit}
                  </span>{" "}
                  prompts.
                </p>
                {(selectedAgentId === "task"
                  ? taskCountdown
                  : researchCountdown) !== null && (
                  <div className="flex items-center gap-1.5 text-[10px] text-white/40 pl-6 bg-black/20 w-fit px-2 py-1 rounded-md border border-white/5">
                    <Clock size={10} />
                    <span>
                      Resets in{" "}
                      <span className="text-white font-medium font-mono tracking-wide">
                        {formatCountdown(
                          (selectedAgentId === "task"
                            ? taskCountdown
                            : researchCountdown)!,
                        )}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              <div className="bg-[#27272A]/50 rounded-2xl p-3 mb-5 border border-white/5">
                <h3 className="text-white font-medium text-xs mb-2 flex items-center gap-1.5">
                  <Star size={12} className="text-[#B7FC0D] fill-[#B7FC0D]" />{" "}
                  Premium Benefits
                </h3>
                <ul className="space-y-2">
                  {[
                    "4 daily task prompts",
                    "Priority agent access",
                    "Advanced features",
                  ].map((b) => (
                    <li
                      key={b}
                      className="flex items-center gap-2.5 text-xs text-white/80"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#B7FC0D]/10 flex items-center justify-center flex-shrink-0">
                        <Check
                          size={8}
                          className="text-[#B7FC0D]"
                          strokeWidth={3}
                        />
                      </div>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowUpgradeModal(false);
                    navigate("/subscription");
                  }}
                  className="w-full py-3 px-4 btn btn-primary text-black rounded-full font-bold transition-all text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <Crown size={16} className="fill-black/20" />
                  Upgrade Now
                </button>
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="w-full py-3 px-4 btn btn-ghost font-medium transition-colors text-xs cursor-pointer"
                >
                  Maybe Later
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop Header */}
      <div className="absolute hidden md:flex items-center justify-between px-10 w-full mx-auto pt-6 flex-shrink-0 z-20">
        <div className="w-full max-w-[1000px] mx-auto flex items-center gap-3">
          <button
            onClick={() => setShowRecents((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${showRecents ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95"}`}
          >
            <Clock size={14} />
            <span className="text-sm font-medium">Recents</span>
          </button>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowAgentDropdown((p) => !p)}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            >
              <img
                src={activeAgent.icon}
                alt={activeAgent.name}
                className="w-5 h-5 object-contain"
              />
              <span className="text-sm font-medium text-white">
                {activeAgent.name}
              </span>
              <ChevronDown
                size={14}
                className={`text-white/40 transition-transform ${showAgentDropdown ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence>
              {showAgentDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 w-64 bg-[#111318] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
                >
                  {AGENTS.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => selectAgent(agent.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors cursor-pointer ${selectedAgentId === agent.id ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selectedAgentId === agent.id ? "ring-2 ring-[#B7FC0D]/50" : ""}`}
                      >
                        <img
                          src={agent.icon}
                          alt={agent.name}
                          className="w-7 h-7 object-contain"
                        />
                      </div>
                      <span className="text-sm font-medium text-white flex-1 text-left">
                        {agent.name}
                      </span>
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${agent.cost === "Free" ? "bg-emerald-500/15 text-emerald-400" : "bg-[#B7FC0D]/15 text-[#B7FC0D]"}`}
                      >
                        {agent.cost}
                      </span>
                    </button>
                  ))}
                  <div className="pt-2 mt-2 border-t border-white/5 px-2 pb-2">
                    <button
                      onClick={() => {
                        setShowAgentDropdown(false);
                        navigate("/subscription");
                      }}
                      className="w-full py-2 text-xs font-medium text-center text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      Upgrade Plan
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md hover:bg-white/10 active:scale-95 transition-all cursor-pointer text-white/60 hover:text-white"
          >
            <Plus size={14} />
            <span className="text-sm font-medium">New Chat</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16 pt-32 pb-36">
            <div className="max-w-[880px] mx-auto space-y-16">
              {isLoadingMessages && <ChatSkeleton />}

              {/* Empty state */}
              {!isLoadingMessages &&
                (!activeConv || activeConv.messages.length === 0) &&
                !isStreaming && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-10">
                    <div className="flex flex-col items-center gap-6">
                      <div className="relative">
                        <div className="w-24 h-24 rounded-[32px] bg-white/[0.03] border border-white/5 flex items-center justify-center shadow-2xl shadow-white/5 backdrop-blur-sm">
                          <img
                            src={activeAgent.icon}
                            alt=""
                            className="w-12 h-12 object-contain opacity-80"
                          />
                        </div>
                        <div className="absolute -inset-4 bg-white/5 blur-3xl -z-10 rounded-full opacity-50" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold text-white/90 tracking-tight">
                          {activeAgent.name}
                        </h2>
                        <p className="text-sm text-white/40 mt-2 font-medium">
                          Select a prompt below or type your own
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full px-4">
                      {(CATEGORIES[selectedAgentId] || CATEGORIES.research).map(
                        (category, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              const currentStatus =
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus;
                              if (currentStatus?.remaining === 0) {
                                setShowUpgradeModal(true);
                                return;
                              }
                              // For bridge agent, send directly; others just fill input
                              if (selectedAgentId === "bridge") {
                                handleSend(category.value);
                              } else {
                                setInput(category.value);
                                inputRef.current?.focus();
                              }
                            }}
                            disabled={isStreaming || isThinking}
                            className={`flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-left transition-all duration-200 backdrop-blur-md group ${(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)?.remaining === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"}`}
                          >
                            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-colors">
                              <category.icon
                                size={20}
                                className="text-white/80 group-hover:text-white"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-white/90 group-hover:text-white mb-0.5">
                                {category.label}
                              </span>
                              <span className="block text-xs text-white/50 truncate group-hover:text-white/70">
                                {category.description}
                              </span>
                            </div>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {/* Messages — pass wallet hooks down to MessageBubble */}
              {!isLoadingMessages &&
                activeConv?.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    copiedId={copiedId}
                    feedback={feedback}
                    onCopy={handleCopy}
                    onFeedback={handleFeedback}
                    onRegenerate={handleRegenerate}
                    isLast={
                      msg.id ===
                      activeConv.messages[activeConv.messages.length - 1]?.id
                    }
                    suiAddress={currentAccount?.address}
                    signAndExecuteSui={signAndExecuteSui}
                    solanaPublicKey={solanaPublicKey}
                    solanaConnection={solanaConnection}
                    sendSolTx={sendSolTx}
                    ethAddress={ethAddress}
                    sendEthTx={sendEthTx}
                  />
                ))}

              {/* Streaming message */}
              {isStreaming && streamedText && (
                <div className="flex gap-3 max-w-3xl">
                  <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-1">
                    <img
                      src={activeAgent.icon}
                      alt=""
                      className="w-6 h-6 object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-white/40 mb-2 block">
                      {activeAgent.name}
                    </span>
                    <div className="text-[14px] leading-relaxed text-white/80">
                      {renderMarkdown(
                        streamedText,
                        <span className="inline-block w-0.5 h-4 bg-[#B7FC0D] ml-0.5 animate-pulse align-middle" />,
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isThinking && (
                <ThinkingIndicator
                  agentId={selectedAgentId}
                  agentIcon={activeAgent.icon}
                  agentName={activeAgent.name}
                  statusOverride={thinkingStatus}
                />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <AnimatePresence>
            {input.trim().length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-md z-40"
              />
            )}
          </AnimatePresence>

          {/* Input Area */}
          <div className="absolute bottom-0 w-full flex-shrink-0 px-4 md:px-8 lg:px-16 pb-4 md:pb-6 pt-2 z-50">
            <div className="relative max-w-[900px] mx-auto">
              {(selectedAgentId === "task"
                ? taskPromptStatus
                : researchPromptStatus) && (
                <div className="flex justify-between items-center px-4 mb-2 text-xs font-medium">
                  <span
                    className={`${(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)!.remaining === 0 ? "text-red-400" : "text-white/40"}`}
                  >
                    {
                      (selectedAgentId === "task"
                        ? taskPromptStatus
                        : researchPromptStatus)!.used
                    }{" "}
                    /{" "}
                    {
                      (selectedAgentId === "task"
                        ? taskPromptStatus
                        : researchPromptStatus)!.limit
                    }{" "}
                    prompts used
                  </span>
                  {(selectedAgentId === "task"
                    ? taskPromptStatus
                    : researchPromptStatus)!.remaining === 0 && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                    >
                      Upgrade Limit
                    </button>
                  )}
                </div>
              )}

              <AnimatePresence>
                {input.trim().length > 0 && (
                  <div className="absolute bottom-full left-0 w-full mb-2 z-10 px-1">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="bg-transparent overflow-hidden"
                    >
                      {(PROMPTS[selectedAgentId] || PROMPTS.research)
                        .filter(
                          (p) =>
                            p.label
                              .toLowerCase()
                              .includes(input.toLowerCase()) ||
                            p.prompt
                              .toLowerCase()
                              .includes(input.toLowerCase()) ||
                            p.keywords.some((k) =>
                              k.toLowerCase().includes(input.toLowerCase()),
                            ),
                        )
                        .slice(0, 4)
                        .map((prompt, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              const currentStatus =
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus;
                              if (currentStatus?.remaining === 0) {
                                setShowUpgradeModal(true);
                                return;
                              }
                              const hasPlaceholder =
                                prompt.prompt.includes("0x...") ||
                                prompt.prompt.includes("[...]") ||
                                prompt.prompt.includes("...");
                              if (hasPlaceholder) {
                                setInput(prompt.prompt);
                                inputRef.current?.focus();
                              } else handleSend(prompt.prompt);
                            }}
                            disabled={isStreaming || isThinking}
                            className={`w-full flex items-center gap-3 p-4 transition-colors text-left group border-b border-white/5 last:border-0 ${taskPromptStatus?.remaining === 0 && selectedAgentId === "task" ? "opacity-50 cursor-not-allowed bg-white/5" : "hover:bg-white/5 cursor-pointer"}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/70 group-hover:text-white group-hover:bg-white/20 transition-all">
                              <prompt.icon size={16} />
                            </div>
                            <div>
                              <span className="block text-sm font-medium text-white/90 group-hover:text-white">
                                {prompt.label}
                              </span>
                              <span className="block text-xs text-white/50 group-hover:text-white/70 line-clamp-1">
                                {prompt.prompt}
                              </span>
                            </div>
                          </button>
                        ))}
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              <div className="p-[1px] bg-white/5 rounded-[30px] backdrop-blur-md border border-white/10">
                <div className="relative bg-[#000]/40 rounded-[29px] flex items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height =
                        Math.min(e.target.scrollHeight, 120) + "px";
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      (selectedAgentId === "task"
                        ? taskPromptStatus
                        : researchPromptStatus
                      )?.remaining === 0
                        ? "Daily limit reached. Upgrade to continue."
                        : `Message ${activeAgent.name}...`
                    }
                    rows={1}
                    disabled={
                      isStreaming ||
                      isThinking ||
                      (selectedAgentId === "task"
                        ? taskPromptStatus
                        : researchPromptStatus
                      )?.remaining === 0
                    }
                    className="flex-1 bg-transparent text-white text-sm placeholder:text-white/30 px-5 py-4 pr-14 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed w-full max-h-[120px] overflow-y-auto"
                    style={{ minHeight: "52px" }}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={
                      !input.trim() ||
                      isStreaming ||
                      isThinking ||
                      (taskPromptStatus?.remaining === 0 &&
                        selectedAgentId === "task")
                    }
                    className={`absolute right-2 bottom-2 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${input.trim() && !isStreaming && !isThinking ? "bg-[#326AFD] hover:bg-[#2959D6] text-white shadow-lg shadow-[#326AFD]/25" : "bg-white/5 text-white/20"} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
