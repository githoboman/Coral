import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { sileo } from "sileo";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAccount, useSendTransaction, usePublicClient } from "wagmi";
import { FaInfinity } from "react-icons/fa6";
import { Connection as SolanaConnection } from "@solana/web3.js";

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
  History,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { RecentChatsModal } from "@/components/RecentChatsModal";
import { ChatSkeleton } from "@/components/ui/SkeletonLoader";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

type AgentPromptStatus = {
  used: number;
  limit: number;
  remaining: number;
  tier: number;
  resetInSeconds?: number;
  godmode?: boolean;
};

/** When godmode is true, daily prompt limits do not apply (server-enforced). */
function promptsExhausted(status: AgentPromptStatus | null | undefined): boolean {
  return !!status && !status.godmode && status.remaining === 0;
}

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

interface Agent {
  id: string;
  name: string;
  icon: string;
  cost: string;
  isWip?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId?: string;
  bridgePayload?: BridgeActionPayload;
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

export interface BridgeTx {
  id: number;
  direction: string;
  source_chain: string;
  dest_chain: string;
  amount_in: string;
  amount_out: string;
  source_tx: string;
  dest_tx: string | null;
  status: "submitted" | "delivered" | "failed";
  created_at: string;
}

type DeliveryPhase =
  | "submitted"
  | "relayer_detected"
  | "signing"
  | "confirming"
  | "delivered"
  | "timed_out";

export const DELIVERY_PHASES: Record<
  DeliveryPhase,
  { label: string; progress: number }
> = {
  submitted: { label: "Transaction confirmed on-chain", progress: 20 },
  relayer_detected: { label: "Relayer picked it up", progress: 40 },
  signing: { label: "Signing via Ika MPC", progress: 65 },
  confirming: { label: "Broadcasting to destination", progress: 85 },
  delivered: { label: "Delivered", progress: 100 },
  timed_out: { label: "Timed out — check explorer", progress: 0 },
};

// ══════════════════════════════════════════════════════════════════════
// STATIC DATA
// ══════════════════════════════════════════════════════════════════════

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
    isWip: true,
  },
  {
    id: "bridge",
    name: "Eva",
    icon: "/assets/images/agents/eva.svg",
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
  bridge: [
    "Reading your request...",
    "Checking your balance...",
    "Locking in the route...",
    "Building your transaction...",
    "Almost ready...",
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

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function getAgent(id: string): Agent {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
let msgCounter = 100;
function nextId() {
  return `m-${++msgCounter}`;
}

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
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return (
        <em key={i} className="text-white/70 italic">
          {part.slice(1, -1)}
        </em>
      );
    return <span key={i}>{part}</span>;
  });
}

// ══════════════════════════════════════════════════════════════════════
// ThinkingIndicator
// ══════════════════════════════════════════════════════════════════════

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
    const interval = setInterval(
      () => setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev)),
      1800,
    );
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
// BridgeTransactionsModal
// ══════════════════════════════════════════════════════════════════════

function BridgeTransactionsModal({
  isOpen,
  onClose,
  userId,
}: {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}) {
  const [txs, setTxs] = useState<BridgeTx[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/bridge/transactions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setTxs(Array.isArray(data) ? data : []))
      .catch(() => setTxs([]))
      .finally(() => setLoading(false));
  }, [isOpen, userId]);

  function explorerUrl(tx: BridgeTx, type: "source" | "dest"): string {
    const hash = type === "source" ? tx.source_tx : tx.dest_tx;
    if (!hash) return "#";
    if (tx.source_chain === "Sui" && type === "source")
      return `https://suiscan.xyz/testnet/tx/${hash}`;
    if (tx.source_chain === "Solana" && type === "source")
      return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
    if (tx.source_chain === "Ethereum" && type === "source")
      return `https://sepolia.etherscan.io/tx/${hash}`;
    if (tx.dest_chain === "Solana" && type === "dest")
      return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
    if (tx.dest_chain === "Ethereum" && type === "dest")
      return `https://sepolia.etherscan.io/tx/${hash}`;
    return `https://suiscan.xyz/testnet/tx/${hash}`;
  }

  const statusConfig = {
    submitted: {
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      border: "border-amber-400/20",
      label: "Pending",
    },
    delivered: {
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20",
      label: "Delivered",
    },
    failed: {
      color: "text-red-400",
      bg: "bg-red-400/10",
      border: "border-red-400/20",
      label: "Failed",
    },
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg bg-[#111318] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[#B7FC0D]" />
            <span className="text-sm font-semibold text-white">
              Bridge Transactions
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/30 hover:text-white transition-colors rounded-lg hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[480px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-white/30" />
            </div>
          ) : txs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <History size={28} className="text-white/10" />
              <p className="text-white/30 text-sm">
                No bridge transactions yet
              </p>
              <p className="text-white/20 text-xs">
                Your bridges will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {txs.map((tx) => {
                const cfg = statusConfig[tx.status] || statusConfig.submitted;
                const isOutbound =
                  tx.direction.startsWith("SUI_TO") ||
                  tx.direction === "SOL_TO_SUI" ||
                  tx.direction === "ETH_TO_SUI";
                const date = new Date(tx.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                return (
                  <div
                    key={tx.id}
                    className="px-5 py-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                          {isOutbound ? (
                            <ArrowUpRight
                              size={14}
                              className="text-[#B7FC0D]"
                            />
                          ) : (
                            <ArrowDownLeft
                              size={14}
                              className="text-emerald-400"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-white/80 text-sm font-medium">
                              {tx.source_chain} → {tx.dest_chain}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}
                            >
                              {cfg.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-white/40">
                            <span>{tx.amount_in}</span>
                            <ArrowRight size={10} />
                            <span className="text-[#B7FC0D]">
                              ~{tx.amount_out}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/30 flex-shrink-0 mt-1">
                        {date}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 ml-11">
                      <a
                        href={explorerUrl(tx, "source")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                      >
                        Source <ExternalLink size={9} />
                      </a>
                      {tx.dest_tx && (
                        <a
                          href={explorerUrl(tx, "dest")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-emerald-400/60 hover:text-emerald-400 transition-colors"
                        >
                          Delivery <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

const EVA_DELIVERY_VOICE: Record<
  DeliveryPhase,
  { primary: string; messages: string[] }
> = {
  submitted: {
    primary: "Your transaction is on-chain. I'm watching for the relayer now.",
    messages: [
      "The relayer monitors the chain in real-time — it'll catch this any second.",
      "Your funds are locked and safe. Nothing moves until the other side is ready.",
      "This is the secure part of the process — on-chain, verifiable, immutable.",
      "I've seen this route plenty of times. Give it a moment.",
    ],
  },
  relayer_detected: {
    primary: "Relayer's on it. Handing off to Ika for signing.",
    messages: [
      "Ika's MPC network is about to co-sign the release. No single key, no single point of failure.",
      "The relayer verified your deposit. Now it's queuing up the signing round.",
      "This handoff is what makes the bridge trustless — the relayer can't move funds without Ika.",
      "Almost into the signing phase. Usually under 90 seconds from here.",
    ],
  },
  signing: {
    primary: "Ika's MPC network is signing the release.",
    messages: [
      "Ika uses distributed key signing — multiple nodes cooperate to authorise this. Takes 60–90 seconds.",
      "No one holds the full private key. The signing is split across Ika's validator network on Sui.",
      "This is the most secure step. Slower by design — decentralised signing takes coordination.",
      "Powered by Ika dWallets on Sui — backed by cryptographic consensus, not trust.",
      "The signing round is live. Each Ika node is casting its partial signature right now.",
      "Once the threshold of signatures is reached, the release fires automatically.",
    ],
  },
  confirming: {
    primary: "Signed. Broadcasting to the destination chain now.",
    messages: [
      "The release transaction is signed and on its way. Final confirmation takes a few seconds.",
      "This is the last step — the destination chain is processing the incoming transfer.",
      "Your funds are leaving the bridge. The destination wallet is about to receive them.",
    ],
  },
  delivered: {
    primary: "Done. Your funds arrived.",
    messages: ["Bridge complete. Powered by Ika dWallets on Sui."],
  },
  timed_out: {
    primary: "I lost track of the delivery — but your funds are likely fine.",
    messages: [
      "The relayer may still be processing. If your source tx is confirmed on the explorer, the bridge will complete.",
      "Timeouts can happen when the network is congested. Your deposit is on-chain and safe.",
    ],
  },
};

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
  onSuggest,
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
  onSuggest?: (text: string) => void;
}) {
  const cardNavigate = useNavigate();
  const [signStatus, setSignStatus] = useState<
    "idle" | "signing" | "submitted" | "failed"
  >("idle");
  const [deliveryPhase, setDeliveryPhase] = useState<DeliveryPhase | null>(
    null,
  );
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null);
  const [destTxHash, setDestTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evaMessageIndex, setEvaMessageIndex] = useState(0);
  const [displayElapsedMs, setDisplayElapsedMs] = useState(0);

  const publicClient = usePublicClient();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const initialEthBalanceRef = useRef<bigint | null>(null);

  const POLL_INTERVAL = 5_000;
  const TIMEOUT_MS = 3 * 60 * 1000;

  const chain = payload.txPayload.chain;
  const isComplete = deliveryPhase === "delivered";
  const isTimedOut = deliveryPhase === "timed_out";

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!deliveryPhase || isComplete || isTimedOut) return;
    setEvaMessageIndex(0);
    const msgs = EVA_DELIVERY_VOICE[deliveryPhase]?.messages || [];
    if (msgs.length <= 1) return;
    const interval = setInterval(() => {
      setEvaMessageIndex((i) => (i + 1) % msgs.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [deliveryPhase, isComplete, isTimedOut]);

  function resolveRecipient(): string | null {
    if (payload.recipientAddress) return payload.recipientAddress;
    if (
      payload.direction === "SOL_TO_SUI" ||
      payload.direction === "ETH_TO_SUI"
    )
      return suiAddress || null;
    if (payload.direction === "SUI_TO_SOL")
      return solanaPublicKey?.toBase58() || null;
    if (payload.direction === "SUI_TO_ETH") return ethAddress || null;
    return null;
  }

  async function saveBridgeTx(sourceTx: string): Promise<number | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/bridge/transactions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: payload.direction,
          source_chain: payload.sourceChain,
          dest_chain: payload.destChain,
          amount_in: payload.amountInDisplay,
          amount_out: payload.amountOutDisplay,
          source_tx: sourceTx,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.id || null;
      }
    } catch (e) {
      console.warn("[BRIDGE] Failed to save tx:", e);
    }
    return null;
  }

  async function markDelivered(id: number, destTx?: string) {
    try {
      await fetch(`${API_BASE_URL}/api/bridge/transactions/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered", dest_tx: destTx || null }),
      });
    } catch (e) {
      console.warn("[BRIDGE] Failed to mark delivered:", e);
    }
  }

  async function startDeliveryPolling(
    _sourceTx: string,
    savedDbId: number | null,
  ) {
    setDeliveryPhase("submitted");
    elapsedRef.current = 0;
    setDisplayElapsedMs(0);
    initialEthBalanceRef.current = null;

    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setDisplayElapsedMs((prev) => prev + 1000);
    }, 1000);

    if (payload.direction === "SUI_TO_ETH") {
      const recipient = resolveRecipient();
      if (recipient && publicClient) {
        try {
          initialEthBalanceRef.current = await publicClient.getBalance({
            address: recipient as `0x${string}`,
          });
        } catch {}
      }
    }

    pollRef.current = setInterval(async () => {
      elapsedRef.current += POLL_INTERVAL;

      if (elapsedRef.current > 15_000)
        setDeliveryPhase((p) => (p === "submitted" ? "relayer_detected" : p));
      if (elapsedRef.current > 40_000)
        setDeliveryPhase((p) => (p === "relayer_detected" ? "signing" : p));
      if (elapsedRef.current > 90_000)
        setDeliveryPhase((p) => (p === "signing" ? "confirming" : p));

      if (elapsedRef.current >= TIMEOUT_MS) {
        clearInterval(pollRef.current!);
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        setDeliveryPhase("timed_out");
        return;
      }

      try {
        const recipient = resolveRecipient();
        if (!recipient) return;

        if (payload.direction === "SUI_TO_SOL" && solanaConnection) {
          const { PublicKey: SPK } = await import("@solana/web3.js");
          const pubkey = new SPK(recipient);
          const sigs = await (
            solanaConnection as SolanaConnection
          ).getSignaturesForAddress(pubkey, { limit: 3 });
          if (sigs.length > 0) {
            const latestTs = (sigs[0].blockTime || 0) * 1000;
            if (Date.now() - latestTs < POLL_INTERVAL * 4) {
              clearInterval(pollRef.current!);
              if (elapsedTimerRef.current)
                clearInterval(elapsedTimerRef.current);
              setDeliveryPhase("delivered");
              setDestTxHash(sigs[0].signature);
              if (savedDbId) await markDelivered(savedDbId, sigs[0].signature);
              sileo.success({
                title: "Bridge Complete!",
                description: "Your SOL has arrived.",
              });
              return;
            }
          }
        } else if (
          payload.direction === "SOL_TO_SUI" ||
          payload.direction === "ETH_TO_SUI"
        ) {
          const { SuiClient, getFullnodeUrl } =
            await import("@mysten/sui/client");
          const client = new SuiClient({ url: getFullnodeUrl("testnet") });
          const txs = await client.queryTransactionBlocks({
            filter: { ToAddress: recipient },
            options: { showEffects: false },
            limit: 3,
            order: "descending",
          });
          if (txs.data.length > 0) {
            const recentDigest = txs.data[0].digest;
            clearInterval(pollRef.current!);
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
            setDeliveryPhase("delivered");
            setDestTxHash(recentDigest);
            if (savedDbId) await markDelivered(savedDbId, recentDigest);
            sileo.success({
              title: "Bridge Complete!",
              description: "Your SUI has arrived.",
            });
            return;
          }
        } else if (payload.direction === "SUI_TO_ETH" && recipient) {
          if (publicClient) {
            const currentBalance = await publicClient.getBalance({
              address: recipient as `0x${string}`,
            });
            if (
              initialEthBalanceRef.current !== null &&
              currentBalance > initialEthBalanceRef.current
            ) {
              clearInterval(pollRef.current!);
              if (elapsedTimerRef.current)
                clearInterval(elapsedTimerRef.current);
              setDeliveryPhase("delivered");
              let ethDestTx: string | undefined;
              try {
                const latestBlock = await publicClient.getBlockNumber();
                for (let i = 0n; i < 5n; i++) {
                  const block = await publicClient.getBlock({
                    blockNumber: latestBlock - i,
                    includeTransactions: true,
                  });
                  const match = block.transactions.find(
                    (t) =>
                      typeof t === "object" &&
                      t.to?.toLowerCase() === recipient.toLowerCase() &&
                      (t as any).value > 0n,
                  );
                  if (match && typeof match === "object") {
                    ethDestTx = (match as any).hash;
                    break;
                  }
                }
              } catch {}
              if (ethDestTx) setDestTxHash(ethDestTx);
              if (savedDbId) await markDelivered(savedDbId, ethDestTx);
              sileo.success({
                title: "Bridge Complete!",
                description: "Your ETH has arrived.",
              });
              return;
            }
          }
        }
      } catch {}
    }, POLL_INTERVAL);
  }

  async function handleSign() {
    setSignStatus("signing");
    setError(null);

    const recipient = resolveRecipient();
    if (!recipient) {
      setError(
        `Please connect your ${payload.destChain} wallet first to receive funds.`,
      );
      setSignStatus("failed");
      return;
    }

    try {
      if (chain === "sui") {
        if (!signAndExecuteSui) throw new Error("Sui wallet not ready");
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
        setSignStatus("submitted");
        signAndExecuteSui(
          { transaction: txBytes },
          {
            onSuccess: async (result: any) => {
              const digest = result.digest;
              setSourceTxHash(digest);
              const dbId = await saveBridgeTx(digest);
              await startDeliveryPolling(digest, dbId);
            },
            onError: (err: any) => {
              setError(err.message || "Transaction rejected");
              setSignStatus("failed");
            },
          },
        );
      } else if (chain === "solana") {
        if (!solanaPublicKey || !solanaConnection || !sendSolTx)
          throw new Error("Solana wallet not connected");
        const {
          SystemProgram,
          Transaction: SolTx,
          PublicKey: SPK,
          TransactionInstruction,
        } = await import("@solana/web3.js");
        const MEMO_PROGRAM_ID = new SPK(payload.txPayload.memoProgramId!);
        const vaultPubkey = new SPK(payload.txPayload.vaultAddress!);
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
            data: Buffer.from(`sui:${recipient}`),
          }),
        );
        const sig = await sendSolTx(tx, solanaConnection);
        setSourceTxHash(sig);
        setSignStatus("submitted");
        const dbId = await saveBridgeTx(sig);
        await startDeliveryPolling(sig, dbId);
      } else if (chain === "ethereum") {
        if (!sendEthTx) throw new Error("Ethereum wallet not connected");
        const amountWei = BigInt(payload.txPayload.amountWei!);
        const bytes = new TextEncoder().encode(recipient);
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const hash = await sendEthTx({
          to: payload.txPayload.vaultAddress as `0x${string}`,
          value: amountWei,
          data: `0x${hex}` as `0x${string}`,
        });
        setSourceTxHash(hash);
        setSignStatus("submitted");
        const dbId = await saveBridgeTx(hash);
        await startDeliveryPolling(hash, dbId);
      }
    } catch (err: any) {
      console.error("[BridgeActionCard] Sign error:", err);
      setError(err.message || "Transaction failed");
      setSignStatus("failed");
    }
  }

  function sourceTxUrl(): string | null {
    if (!sourceTxHash) return null;
    if (chain === "sui")
      return `https://suiscan.xyz/testnet/tx/${sourceTxHash}`;
    if (chain === "solana")
      return `https://explorer.solana.com/tx/${sourceTxHash}?cluster=devnet`;
    if (chain === "ethereum")
      return `https://sepolia.etherscan.io/tx/${sourceTxHash}`;
    return null;
  }

  function destTxUrl(): string | null {
    if (!destTxHash) return null;
    if (payload.destChain === "Solana")
      return `https://explorer.solana.com/tx/${destTxHash}?cluster=devnet`;
    if (payload.destChain === "Ethereum")
      return `https://sepolia.etherscan.io/tx/${destTxHash}`;
    return `https://suiscan.xyz/testnet/tx/${destTxHash}`;
  }

  const isLoading = signStatus === "signing" || signStatus === "submitted";
  const walletMissing = payload.recipientMissing && !resolveRecipient();
  const showSignButton = !deliveryPhase && !isComplete;

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-w-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/50 uppercase tracking-widest">
            Bridge Preview
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-[#B7FC0D]/10 text-[#B7FC0D] rounded-full font-bold border border-[#B7FC0D]/20">
            Testnet
          </span>
        </div>
        {!deliveryPhase && signStatus === "idle" && (
          <button
            onClick={onDismiss}
            className="text-white/20 hover:text-white/50 transition-colors text-xs"
          >
            Cancel
          </button>
        )}
      </div>

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

      <div className="flex justify-between items-center px-1 mb-4">
        <span className="text-white/30 text-xs">Fee</span>
        <span className="text-white/50 text-xs font-mono">
          {payload.feePercent}%
        </span>
      </div>

      {payload.recipientMissing && !resolveRecipient() && !deliveryPhase && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-3">
          <p className="text-xs text-amber-400 mb-2">
            ⚠ Your {payload.destChain} wallet isn't connected — you need it to
            receive funds.
          </p>
          <button
            onClick={() => cardNavigate("/account")}
            className="flex items-center gap-1 text-xs font-semibold text-[#B7FC0D] hover:text-[#B7FC0D]/70 transition-colors cursor-pointer"
          >
            <ArrowRight size={11} />
            Connect in Account Settings
          </button>
        </div>
      )}

      {signStatus === "failed" && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-3 flex items-start gap-2">
          <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-red-400 text-xs">{error}</span>
        </div>
      )}

      {deliveryPhase &&
        (() => {
          const voice = EVA_DELIVERY_VOICE[deliveryPhase];
          const msgs = voice.messages;
          const rotatingMsg = msgs[evaMessageIndex % msgs.length];
          return (
            <div
              className={`rounded-xl p-3 mb-3 border transition-colors duration-500 ${
                isComplete
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : isTimedOut
                    ? "bg-red-500/10 border-red-500/20"
                    : "bg-white/[0.03] border-white/10"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {isComplete ? (
                  <CheckCircle2
                    size={13}
                    className="text-emerald-400 flex-shrink-0"
                  />
                ) : isTimedOut ? (
                  <XCircle size={13} className="text-red-400 flex-shrink-0" />
                ) : (
                  <Loader2
                    size={13}
                    className="text-[#B7FC0D] animate-spin flex-shrink-0"
                  />
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest flex-1 ${
                    isComplete
                      ? "text-emerald-400/70"
                      : isTimedOut
                        ? "text-red-400/70"
                        : "text-white/25"
                  }`}
                >
                  {DELIVERY_PHASES[deliveryPhase].label}
                </span>
                {!isComplete && !isTimedOut && displayElapsedMs > 0 && (
                  <span className="text-[10px] text-white/20 tabular-nums">
                    {Math.floor(displayElapsedMs / 60000) > 0
                      ? `${Math.floor(displayElapsedMs / 60000)}m ${Math.floor((displayElapsedMs % 60000) / 1000)}s`
                      : `${Math.floor(displayElapsedMs / 1000)}s`}
                  </span>
                )}
              </div>

              {!isTimedOut && (
                <div className="w-full bg-white/5 rounded-full h-0.5 mb-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      isComplete
                        ? "bg-emerald-400"
                        : "bg-gradient-to-r from-[#B7FC0D]/50 to-[#B7FC0D]"
                    }`}
                    style={{
                      width: isComplete
                        ? "100%"
                        : `${Math.min(Math.max((displayElapsedMs / 150_000) * 100, DELIVERY_PHASES[deliveryPhase].progress), 95)}%`,
                    }}
                  />
                </div>
              )}

              <p
                className={`text-sm font-medium leading-snug mb-2 ${
                  isComplete
                    ? "text-emerald-300"
                    : isTimedOut
                      ? "text-red-300"
                      : "text-white/85"
                }`}
              >
                {voice.primary}
              </p>

              {!isComplete && !isTimedOut && (
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`${deliveryPhase}-${evaMessageIndex}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.35 }}
                    className="text-[11px] text-white/35 leading-relaxed"
                  >
                    {rotatingMsg}
                  </motion.p>
                </AnimatePresence>
              )}

              {isTimedOut && (
                <AnimatePresence mode="wait">
                  <motion.p
                    key={evaMessageIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-red-400/60 leading-relaxed"
                  >
                    {rotatingMsg}
                  </motion.p>
                </AnimatePresence>
              )}

              {!isComplete && !isTimedOut && (
                <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-white/5">
                  <span className="text-[10px] text-white/20">Powered by</span>
                  <span className="text-[10px] font-semibold text-white/35">
                    Ika
                  </span>
                  <span className="text-[10px] text-white/15">·</span>
                  <span className="text-[10px] font-semibold text-white/35">
                    Sui
                  </span>
                </div>
              )}

              {sourceTxHash && sourceTxUrl() && (
                <div className="flex items-center gap-1 mt-2">
                  <span className="text-[10px] text-white/20">Source tx:</span>
                  <a
                    href={sourceTxUrl()!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-white/30 hover:text-white/55 transition-colors"
                  >
                    {sourceTxHash.slice(0, 8)}…{sourceTxHash.slice(-6)}
                    <ExternalLink size={8} />
                  </a>
                </div>
              )}

              {destTxHash && destTxUrl() && isComplete && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] text-white/20">
                    Delivery tx:
                  </span>
                  <a
                    href={destTxUrl()!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    {destTxHash.slice(0, 8)}…{destTxHash.slice(-6)}
                    <ExternalLink size={8} />
                  </a>
                </div>
              )}

              {isComplete && onSuggest && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
                  {["Bridge again", "Check my balance", "Show rates"].map(
                    (s) => (
                      <button
                        key={s}
                        onClick={() => onSuggest(s)}
                        className="px-2.5 py-1 text-[10px] font-medium bg-white/5 border border-white/10 rounded-full text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-95 cursor-pointer"
                      >
                        {s}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })()}

      {showSignButton && (
        <button
          onClick={walletMissing ? () => cardNavigate("/account") : handleSign}
          disabled={isLoading}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2
            ${
              isLoading
                ? "bg-white/5 text-white/30 cursor-not-allowed"
                : walletMissing
                  ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/20"
                  : signStatus === "failed"
                    ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/20"
                    : "bg-gradient-to-r from-[#246AFC] to-[#326AFD] text-white hover:brightness-110 active:scale-[0.98]"
            }`}
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {signStatus === "signing"
                ? "Waiting for approval..."
                : "Submitting..."}
            </>
          ) : walletMissing ? (
            <>
              Connect {payload.destChain} Wallet <ArrowRight size={16} />
            </>
          ) : signStatus === "failed" ? (
            "Try Again"
          ) : (
            <>
              Confirm <ArrowRight size={16} />
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MessageBubble
// ══════════════════════════════════════════════════════════════════════

function MessageBubble({
  message,
  copiedId,
  feedback,
  onCopy,
  onFeedback,
  onRegenerate,
  isLast,
  suiAddress,
  signAndExecuteSui,
  solanaPublicKey,
  solanaConnection,
  sendSolTx,
  ethAddress,
  sendEthTx,
  onSuggest,
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
  onSuggest?: (text: string) => void;
}) {
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
            onSuggest={onSuggest}
          />
        )}

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

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  const { setMobileActions } = useOutletContext<any>();
  const { mutate: signAndExecuteSui } = useSignAndExecuteTransaction();
  const { publicKey: solanaPublicKey, sendTransaction: sendSolTx } =
    useWallet();
  const { connection: solanaConnection } = useConnection();
  const { address: ethAddress } = useAccount();
  const { sendTransactionAsync: sendEthTx } = useSendTransaction();

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
  const [showTransactions, setShowTransactions] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const pendingBridgePayloadRef = useRef<BridgeActionPayload | null>(null);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);

  const [taskPromptStatus, setTaskPromptStatus] = useState<AgentPromptStatus | null>(null);
  const [researchPromptStatus, setResearchPromptStatus] = useState<AgentPromptStatus | null>(null);
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
        const res = await fetch(url.toString(), {
          cache: "no-store",
          credentials: "include",
        });
        if (res.ok) {
          const s = await res.json();
          setter(s);
          if (s.resetInSeconds) countdownSetter(s.resetInSeconds);
          localStorage.setItem(CACHE_KEY, JSON.stringify(s));
        }
      } catch (e) {
        /* ignore */
      }
    };

    (window as any).refreshPromptStatus = () => fetchStatus(true);
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const p = JSON.parse(cached);
        setter((prev: any) => prev || p);
        if (p.resetInSeconds && currentCountdown === null)
          countdownSetter(p.resetInSeconds);
      } catch {
        /* ignore */
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [selectedAgentId, currentAccount?.address]);

  useEffect(() => {
    if (taskCountdown === null || taskCountdown <= 0) return;
    const t = setInterval(
      () => setTaskCountdown((p) => (p === null || p <= 1 ? null : p - 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [taskCountdown]);

  useEffect(() => {
    if (researchCountdown === null || researchCountdown <= 0) return;
    const t = setInterval(
      () => setResearchCountdown((p) => (p === null || p <= 1 ? null : p - 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [researchCountdown]);

  useEffect(() => {
    if (!currentAccount?.address) return;
    const fetchChats = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/chats?userId=${currentAccount.address}`,
          { credentials: "include" },
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
    if (!activeConvId || activeConvId.startsWith("conv-") || isStreaming)
      return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv || conv.messages.length > 0) return;

    const fetchMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/chats/${activeConvId}`, {
          credentials: "include",
        });
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
      )
        setShowAgentDropdown(false);
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
      pendingBridgePayloadRef.current = null;
      setSuggestedReplies([]);
      let fullText = "",
        aborted = false,
        currentConvId = convId;

      try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          credentials: "include",
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
              return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`;
            })(),
            ...(agentId === "bridge" && (activeConv?.messages?.length ?? 0) > 0
              ? {
                  conversationHistory: activeConv?.messages
                    .slice(-6)
                    .map((m) => ({ role: m.role, content: m.content })),
                }
              : {}),
            ...(agentId === "bridge"
              ? {
                  solanaAddress: solanaPublicKey?.toBase58() || undefined,
                  ethAddress: ethAddress || undefined,
                }
              : {}),
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
                {
                  credentials: "include",
                },
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
          setConversations((prev) =>
            prev.map((c) =>
              c.id !== currentConvId && c.tempId !== currentConvId
                ? c
                : {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: nextId(),
                        role: "assistant" as const,
                        content: `⏱️ **Rate Limit Reached**\n\n${err.message}`,
                      },
                    ],
                  },
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
          fetch(`${API_BASE_URL}/api/chat/${endpoint}/${userId}`, {
            credentials: "include",
          })
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
                  if (parsed?.type === "suggested_replies") {
                    setSuggestedReplies((parsed.replies as string[]) || []);
                  } else if (parsed?.type === "bridge_transaction_ready") {
                    pendingBridgePayloadRef.current =
                      parsed as BridgeActionPayload;
                  } else if (
                    parsed?.type === "task_created" ||
                    parsed?.type === "research_completed"
                  ) {
                    sileo.success({
                      title:
                        parsed.type === "task_created"
                          ? "Task Created"
                          : "Research Complete",
                      description:
                        parsed.type === "task_created"
                          ? "Your task was created successfully."
                          : "Research report is ready.",
                    });
                    if (userId) {
                      fetch(
                        `${API_BASE_URL}/api/task-points/claimable?user_id=${userId}`,
                        { credentials: "include" },
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

        setIsStreaming(false);
        setStreamedText("");
        if (fullText) {
          const assistantMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: fullText,
            agentId,
            bridgePayload: pendingBridgePayloadRef.current || undefined,
          };
          pendingBridgePayloadRef.current = null;
          setConversations((prev) =>
            prev.map((c) =>
              c.id !== currentConvId && c.tempId !== currentConvId
                ? c
                : { ...c, messages: [...c.messages, assistantMsg] },
            ),
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
      if (selectedAgentId === "task" && promptsExhausted(taskPromptStatus)) {
        setShowUpgradeModal(true);
        return;
      }
      if (selectedAgentId === "research" && promptsExhausted(researchPromptStatus)) {
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
      await streamFromServer(text, selectedAgentId, currentId);
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
        await fetch(`${API_BASE_URL}/api/chats/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        /* ignore */
      }
      if (id === activeConvId) navigate("/chat");
    },
    [activeConvId, navigate],
  );

  // ── Mobile actions ────────────────────────────────────────────────────
  useEffect(() => {
    setMobileActions?.({
      onRecentClick: () => setShowRecents((p) => !p),
      onTransactionsClick: () => setShowTransactions((p) => !p),
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
                      if (agent.isWip) return;
                      selectAgent(agent.id);
                      setShowAgentDropdown(false);
                    }}
                    disabled={agent.isWip}
                    className={`w-full flex items-center gap-3 px-3 py-3 transition-colors ${
                      agent.isWip
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer"
                    } ${
                      selectedAgentId === agent.id
                        ? "bg-white/[0.06]"
                        : agent.isWip
                          ? ""
                          : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <img
                      src={agent.icon}
                      alt=""
                      className="w-7 h-7 object-contain"
                    />
                    <span className="text-sm font-medium text-white flex-1 text-left flex items-center gap-2">
                      {agent.name}
                      {agent.isWip && (
                        <span className="text-[9px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded flex-shrink-0 font-bold tracking-wider">
                          WIP
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        agent.cost === "Free"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-[#B7FC0D]/15 text-[#B7FC0D]"
                      }`}
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

      <AnimatePresence>
        {showTransactions && (
          <BridgeTransactionsModal
            isOpen={showTransactions}
            onClose={() => setShowTransactions(false)}
            userId={currentAccount?.address}
          />
        )}
      </AnimatePresence>

      {/* Upgrade Modal */}
      <AnimatePresence>
        {showUpgradeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#18181B] border border-white/10 rounded-3xl shadow-2xl p-5 relative overflow-hidden max-h-[90vh]"
            >
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 z-10"
              >
                <X size={20} />
              </button>
              <div className="w-12 h-12 rounded-full bg-[#B7FC0D] flex items-center justify-center mb-4 mx-auto md:mx-0">
                <Crown size={24} className="text-black fill-current" />
              </div>
              <h2 className="text-lg font-bold text-white mb-2 text-center md:text-left">
                Upgrade to Premium
              </h2>
              <p className="text-white/60 mb-4 text-sm text-center md:text-left">
                You need to upgrade to premium to continue. The free tier only
                allows 2 prompts per day for this agent.
              </p>
              <div className="bg-[#27272A] rounded-2xl p-3 mb-4 border border-amber-500/20 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <span className="text-white font-medium text-xs">
                    Limit Reached
                  </span>
                </div>
                <p className="text-white/60 text-xs pl-6">
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
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowUpgradeModal(false);
                    navigate("/subscription");
                  }}
                  className="w-full py-3 px-4 btn btn-primary text-black rounded-full font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Crown size={16} />
                  Upgrade Now
                </button>
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="w-full py-3 px-4 btn btn-ghost font-medium text-xs"
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
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${
              showRecents
                ? "bg-white/10 border-white/20 text-white"
                : "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95"
            }`}
          >
            <Clock size={14} />
            <span className="text-sm font-medium">Recents</span>
          </button>

          {/* Agent Selector */}
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
                      onClick={() => {
                        if (agent.isWip) return;
                        selectAgent(agent.id);
                      }}
                      disabled={agent.isWip}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors ${
                        agent.isWip
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer"
                      } ${
                        selectedAgentId === agent.id
                          ? "bg-white/[0.06]"
                          : agent.isWip
                            ? ""
                            : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          selectedAgentId === agent.id
                            ? "ring-2 ring-[#B7FC0D]/50"
                            : ""
                        }`}
                      >
                        <img
                          src={agent.icon}
                          alt={agent.name}
                          className="w-7 h-7 object-contain"
                        />
                      </div>
                      <span className="text-sm font-medium text-white flex-1 text-left flex items-center gap-2">
                        {agent.name}
                        {agent.isWip && (
                          <span className="text-[9px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded flex-shrink-0 font-bold tracking-wider">
                            WIP
                          </span>
                        )}
                      </span>
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          agent.cost === "Free"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-[#B7FC0D]/15 text-[#B7FC0D]"
                        }`}
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

          <button
            onClick={() => setShowTransactions((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${
              showTransactions
                ? "bg-white/10 border-white/20 text-white"
                : "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95"
            }`}
          >
            <History size={14} />
            <span className="text-sm font-medium">Transactions</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16 pt-32 pb-36">
            <div className="max-w-[880px] mx-auto space-y-16">
              {isLoadingMessages && <ChatSkeleton />}

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
                          {selectedAgentId === "bridge"
                            ? "Hey, I'm Eva"
                            : activeAgent.name}
                        </h2>
                        <p className="text-sm text-white/40 mt-2 font-medium">
                          {selectedAgentId === "bridge"
                            ? "I move assets between Sui, Solana, and Ethereum — powered by Ika MPC"
                            : "Select a prompt below or type your own"}
                        </p>
                      </div>

                      {selectedAgentId === "bridge" && (
                        <div className="flex items-center gap-3 flex-wrap justify-center">
                          <div
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${currentAccount?.address ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-white/5 border-white/10 text-white/30"}`}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${currentAccount?.address ? "bg-emerald-400" : "bg-white/20"}`}
                            />
                            Sui{" "}
                            {currentAccount?.address
                              ? "Connected"
                              : "Not connected"}
                          </div>
                          <div
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${solanaPublicKey ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400/70"}`}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${solanaPublicKey ? "bg-emerald-400" : "bg-amber-400/50"}`}
                            />
                            Solana{" "}
                            {solanaPublicKey ? "Connected" : "Not connected"}
                          </div>
                          <div
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${ethAddress ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400/70"}`}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${ethAddress ? "bg-emerald-400" : "bg-amber-400/50"}`}
                            />
                            Ethereum{" "}
                            {ethAddress ? "Connected" : "Not connected"}
                          </div>
                          {(!solanaPublicKey || !ethAddress) && (
                            <button
                              onClick={() => navigate("/account")}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#B7FC0D] hover:text-[#B7FC0D]/70 transition-colors cursor-pointer"
                            >
                              <ArrowRight size={11} /> Connect wallets
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full px-4">
                      {(CATEGORIES[selectedAgentId] || CATEGORIES.research).map(
                        (category, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              if (activeAgent.isWip) return;
                              const currentStatus =
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus;
                              if (promptsExhausted(currentStatus)) {
                                setShowUpgradeModal(true);
                                return;
                              }
                              if (selectedAgentId === "bridge")
                                handleSend(category.value);
                              else {
                                setInput(category.value);
                                inputRef.current?.focus();
                              }
                            }}
                            disabled={
                              isStreaming || isThinking || activeAgent.isWip
                            }
                            className={`flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-left transition-all duration-200 backdrop-blur-md group ${
                              promptsExhausted(
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus,
                              ) || activeAgent.isWip
                                ? "opacity-50 cursor-not-allowed"
                                : "hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                            }`}
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
                    onSuggest={
                      selectedAgentId === "bridge" ? handleSend : undefined
                    }
                  />
                ))}

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

              {selectedAgentId === "bridge" &&
                suggestedReplies.length > 0 &&
                !isStreaming &&
                !isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-wrap gap-2 pl-10"
                  >
                    {suggestedReplies.map((reply, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(reply)}
                        className="px-3 py-1.5 text-xs font-medium bg-white/5 border border-white/10 rounded-full text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-95 cursor-pointer"
                      >
                        {reply}
                      </button>
                    ))}
                  </motion.div>
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

          {/* Input */}
          <div className="absolute bottom-0 w-full flex-shrink-0 px-4 md:px-8 lg:px-16 pb-4 md:pb-6 pt-2 z-50">
            <div className="relative max-w-[900px] mx-auto">
              {(selectedAgentId === "task"
                ? taskPromptStatus
                : researchPromptStatus) && (
                <div className="flex justify-between items-center px-4 mb-2 text-xs font-medium">
                  {(() => {
                    const bar =
                      selectedAgentId === "task"
                        ? taskPromptStatus!
                        : researchPromptStatus!;
                    return (
                      <>
                  <span
                    className={`${
                      promptsExhausted(bar)
                        ? "text-red-400"
                        : "text-white/40"
                    }`}
                  >
                    {bar.godmode ? (
                      <span className="tabular-nums text-white/50">
                        <FaInfinity className="w-4 h-4"/>
                      </span>
                    ) : (
                      <>
                    {bar.used}{" "}
                    /{" "}
                    {bar.limit}{" "}
                    prompts used
                      </>
                    )}
                  </span>
                  {promptsExhausted(bar) && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                    >
                      Upgrade Limit
                    </button>
                  )}
                      </>
                    );
                  })()}
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
                              if (activeAgent.isWip) return;
                              const currentStatus =
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus;
                              if (promptsExhausted(currentStatus)) {
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
                            disabled={
                              isStreaming || isThinking || activeAgent.isWip
                            }
                            className={`w-full flex items-center gap-3 p-4 transition-colors text-left group border-b border-white/5 last:border-0 ${
                              promptsExhausted(
                                selectedAgentId === "task"
                                  ? taskPromptStatus
                                  : researchPromptStatus,
                              ) || activeAgent.isWip
                                ? "opacity-50 cursor-not-allowed bg-white/5"
                                : "hover:bg-white/5 cursor-pointer"
                            }`}
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
                      activeAgent.isWip
                        ? "Agent is WIP: New chats disabled"
                        : promptsExhausted(
                              selectedAgentId === "task"
                                ? taskPromptStatus
                                : researchPromptStatus,
                            )
                          ? "Daily limit reached. Upgrade to continue."
                          : `Message ${activeAgent.name}...`
                    }
                    rows={1}
                    disabled={
                      isStreaming ||
                      isThinking ||
                      activeAgent.isWip ||
                      promptsExhausted(
                        selectedAgentId === "task"
                          ? taskPromptStatus
                          : researchPromptStatus,
                      )
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
                      activeAgent.isWip ||
                      promptsExhausted(
                        selectedAgentId === "task"
                          ? taskPromptStatus
                          : researchPromptStatus,
                      )
                    }
                    className={`absolute right-2 bottom-2 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                      input.trim() &&
                      !isStreaming &&
                      !isThinking &&
                      !activeAgent.isWip
                        ? "bg-[#326AFD] hover:bg-[#2959D6] text-white shadow-lg shadow-[#326AFD]/25"
                        : "bg-white/5 text-white/20"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
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
