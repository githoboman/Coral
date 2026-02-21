import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { useCurrentAccount } from "@mysten/dapp-kit";

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
} from "lucide-react";
import { RecentChatsModal } from "@/components/RecentChatsModal";
import { ChatSkeleton } from "@/components/ui/SkeletonLoader";

// ── Types ──────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  icon: string;
  cost: string; // "Free" or "$0.0008" etc
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId?: string;
}

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
  tempId?: string;
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
    cost: "Free", // Or set a cost if applicable
  },
];


// ── Agent Thinking Steps (zero LLM cost - purely frontend) ────────────

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
};

const CATEGORIES: Record<string, Category[]> = {
  research: [
    { label: "On-Chain Insights", value: "on-chain", icon: Activity, description: "Wallet holdings, portfolios, & NFT assets" },
    { label: "Simulations", value: "simulate", icon: Shield, description: "Preview transfers, swaps, & staking risk" },
    { label: "Token Research", value: "token", icon: PieChart, description: "Real-time pricing, stats, & performance" },
    { label: "Ecosystem Search", value: "search", icon: Search, description: "Protocol deep dives & market news" },
  ],
  tovira: [
    { label: "Wallet", value: "Wallet", icon: Wallet, description: "Balances and holdings" },
    { label: "Transactions", value: "Transactions", icon: Clock, description: "History and activity" },
    { label: "DeFi", value: "DeFi", icon: Repeat, description: "Swaps and liquidity" },
    { label: "NFTs", value: "NFTs", icon: Image, description: "Collections and galleries" },
  ],
  task: [
    { label: "Schedule", value: "Schedule", icon: Clock, description: "Daily plans and reminders" },
    { label: "Social", value: "Social", icon: MessageCircle, description: "Tweets, discord, and engagement" },
    { label: "Finance", value: "Finance", icon: Wallet, description: "Balances, gas, and portfolio" },
    { label: "Routine", value: "Routine", icon: Repeat, description: "Recurring tasks and habits" },
  ],
  alert: [
    { label: "Price", value: "Price Alert", icon: Bell, description: "Price targets and movements" },
    { label: "On-Chain", value: "On-Chain Alert", icon: Activity, description: "Whales, gas, and contracts" },
    { label: "Social", value: "Social Alert", icon: MessageCircle, description: "Sentiment and volume" },
    { label: "Listings", value: "New Listing", icon: Star, description: "New exchanges and tokens" },
  ],
};

const PROMPTS: Record<string, Prompt[]> = {
  research: [
    { label: "Wallet Portfolio", prompt: "Show me the portfolio and top holdings of wallet: 0x...", keywords: ["on-chain", "wallet", "portfolio"], icon: Wallet },
    { label: "NFT Holdings", prompt: "Analyze the NFT assets held by wallet: 0x...", keywords: ["on-chain", "nfts", "wallet"], icon: Image },
    { label: "Transfer Simulation", prompt: "Simulate a transfer of 10 SUI to recipient: 0x...", keywords: ["simulate", "transfer", "send"], icon: Send },
    { label: "Swap Simulation", prompt: "Simulate swapping 50 SUI for USDC and check for risks", keywords: ["simulate", "swap", "defi"], icon: Repeat },
    { label: "Staking Simulation", prompt: "Simulate staking 100 SUI with validator: 0x...", keywords: ["simulate", "stake", "earn"], icon: Zap },
    { label: "Token Price", prompt: "Check the price and performance for token: 0x2::sui::SUI", keywords: ["token", "price", "stats"], icon: PieChart },
    { label: "Protocol Deep Dive", prompt: "Deep dive into the Aftermath Finance protocol on Sui", keywords: ["search", "protocol", "aftermath"], icon: Search },
    { label: "Latest Sui News", prompt: "Find the latest news about the Sui ecosystem expansion", keywords: ["search", "news", "sui"], icon: TrendingUp },
  ],
  tovira: [
    { label: "Check Balance", prompt: "What is my current SUI balance?", keywords: ["wallet", "balance"], icon: Wallet },
    { label: "Transaction History", prompt: "Show my last 5 transactions", keywords: ["transactions", "history"], icon: Clock },
    { label: "Swap Tokens", prompt: "I want to swap SUI for USDC", keywords: ["defi", "swap", "trade"], icon: Repeat },
    { label: "View NFTs", prompt: "Show my NFT gallery", keywords: ["nfts", "gallery", "collectibles"], icon: Image },
    { label: "Gas Fees", prompt: "Check current gas prices", keywords: ["wallet", "gas", "fees"], icon: Zap },
    { label: "Send Tokens", prompt: "Send 10 SUI to...", keywords: ["wallet", "send", "transfer"], icon: Send },
  ],
  task: [
    { label: "Daily Schedule", prompt: "I need to visit the spa by 2pm, check my crypto portfolio at 3pm, and attend a DAO meeting by 7pm today. Kindly remind me when due.", keywords: ["schedule", "plan", "remind"], icon: Clock },
    { label: "NFT Launch", prompt: "Remind me to make a tweet about my latest NFT drop for tomorrow at 10am and remind me to check the engagement at 2pm same day", keywords: ["nft", "social", "marketing"], icon: Image },
    { label: "Check Balance", prompt: "Remind me to check my ETH balance at 5pm", keywords: ["balance", "wallet", "check"], icon: Wallet },
    { label: "Gas Check", prompt: "Remind me to check gas fees before the mint starts at 8pm", keywords: ["gas", "mint", "fees"], icon: Zap },
    { label: "WL Grind", prompt: "Remind me to interact with the protocol discord every 6 hours for whitelist grinding", keywords: ["social", "discord", "whitelist"], icon: MessageCircle },
    { label: "Weekly Review", prompt: "Create a task to review my trading performance every Sunday at 9pm", keywords: ["review", "trading", "recurring"], icon: PieChart },
  ],
  alert: [
    { label: "Price Alert", prompt: "Alert me when SUI hits $2.50", keywords: ["price", "target", "market"], icon: Bell },
    { label: "Whale Watch", prompt: "Notify me of transfers > 100k SUI", keywords: ["on-chain", "whale", "movement"], icon: Eye },
    { label: "Gas Spike", prompt: "Alert if gas > 1000 MIST", keywords: ["on-chain", "gas", "fees"], icon: Zap },
    { label: "Social Sentiment", prompt: "Alert on negative social sentiment spike", keywords: ["social", "sentiment", "twitter"], icon: MessageCircle },
    { label: "New Listing", prompt: "Notify of new CEX listings", keywords: ["listings", "exchange", "new"], icon: Star },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────

function getAgent(id: string): Agent {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}

let msgCounter = 100;
function nextId() {
  return `m-${++msgCounter}`;
}

// ── Simple Markdown-like Renderer ──────────────────────────────────────

function renderMarkdown(text: string, cursor?: React.ReactNode) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    const suffix = isLastLine ? cursor : null;

    // Blank line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-3">{suffix}</div>);
      i++;
      continue;
    }

    // Heading
    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="text-base font-bold text-white mt-2 mb-1">
          {renderInline(line.slice(3))}{suffix}
        </h3>
      );
      i++;
      continue;
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line)) {
      elements.push(
        <div key={i} className="flex gap-2 pl-1 mb-1">
          <span className="text-white/40 flex-shrink-0">
            {line.match(/^\d+/)![0]}.
          </span>
          <span>{renderInline(line.replace(/^\d+\.\s*/, ""))}{suffix}</span>
        </div>
      );
      i++;
      continue;
    }

    // Bullet list item
    if (line.startsWith("- ")) {
      elements.push(
        <div key={i} className="flex gap-2 pl-1 mb-1">
          <span className="text-[#B7FC0D] flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-[#B7FC0D] inline-block" />
          <span>{renderInline(line.slice(2))}{suffix}</span>
        </div>
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="mb-1 leading-relaxed break-words">
        {renderInline(line)}{suffix}
      </p>
    );
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Bold + remaining
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Thinking Indicator Component ───────────────────────────────────────

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
      setStepIndex((prev) => {
        // Cycle through steps, but slow down on last one
        if (prev < steps.length - 1) return prev + 1;
        return prev; // Stay on last step
      });
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
          {/* Spinner */}
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
          {/* Status text with crossfade */}
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
                  <span className="animate-pulse" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="animate-pulse" style={{ animationDelay: "200ms" }}>.</span>
                  <span className="animate-pulse" style={{ animationDelay: "400ms" }}>.</span>
                </span>
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}



const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  const { setMobileActions } = useOutletContext<any>();

  // ── State ────────────────────────────────────────────────────────────
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [conversations, setConversations] =
    useState<Conversation[]>([]);
  // activeConvId is now derived from URL, or null if new/root
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

  // Rate Limit State
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
  const [researchCountdown, setResearchCountdown] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Robust active conversation lookup: checks ID or tempId to handle transitions
  const activeConv = conversations.find((c) => c.id === activeConvId || c.tempId === activeConvId);
  const activeAgent = getAgent(selectedAgentId);

  // ── Formatters ──────────────────────────────────────────────────────
  const formatCountdown = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // ── Effects ─────────────────────────────────────────────────────────

  // Fetch prompt status with caching
  useEffect(() => {
    if (!currentAccount?.address) return;
    if (selectedAgentId !== "task" && selectedAgentId !== "research") return;

    const CACHE_KEY = `${selectedAgentId}PromptStatus-${currentAccount.address}`;
    const endpoint = selectedAgentId === "task" ? "task-prompts" : "research-prompts";
    const setter = selectedAgentId === "task" ? setTaskPromptStatus : setResearchPromptStatus;
    const countdownSetter = selectedAgentId === "task" ? setTaskCountdown : setResearchCountdown;
    const currentCountdown = selectedAgentId === "task" ? taskCountdown : researchCountdown;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat/${endpoint}/${currentAccount.address}`);
        if (res.ok) {
          const status = await res.json();
          setter(status);
          if (status.resetInSeconds) {
            countdownSetter(status.resetInSeconds);
          }
          // Update cache
          localStorage.setItem(CACHE_KEY, JSON.stringify(status));
        }
      } catch (e) {
        console.error(`Failed to fetch ${selectedAgentId} prompts:`, e);
      }
    };

    // 1. Load from cache immediately
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setter((prev: any) => prev || parsed);
        if (parsed.resetInSeconds && currentCountdown === null) {
          countdownSetter(parsed.resetInSeconds);
        }
      } catch (e) {
        console.error("Failed to parse cached status", e);
      }
    }

    // 2. Fetch fresh data
    fetchStatus();

    // Refresh every minute to keep countdown loosely synced
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [selectedAgentId, currentAccount?.address]);

  // Countdown timer for Task Agent
  useEffect(() => {
    if (taskCountdown === null || taskCountdown <= 0) return;
    const timer = setInterval(() => {
      setTaskCountdown((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [taskCountdown]);

  // Countdown timer for Research Agent
  useEffect(() => {
    if (researchCountdown === null || researchCountdown <= 0) return;
    const timer = setInterval(() => {
      setResearchCountdown((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [researchCountdown]);


  // Fetch Chats on Mount
  useEffect(() => {
    if (!currentAccount?.address) return;

    const fetchChats = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chats?userId=${currentAccount.address}`);
        if (res.ok) {
          const data = await res.json();
          const mapped: Conversation[] = data.map((c: any) => ({
            id: c.chat_id,
            title: c.name,
            agentId: c.agent_id,
            messages: [], // messages loaded on demand
          }));
          setConversations(mapped);
        }
      } catch (err) {
        console.error("Failed to fetch chats:", err);
      }
    };

    fetchChats();
  }, [currentAccount?.address]);

  // Fetch Messages when Chat Selected
  useEffect(() => {
    if (!activeConvId || activeConvId.startsWith("conv-")) return;

    const conv = conversations.find(c => c.id === activeConvId);

    // We can allow re-fetching to ensure sync.
    // But we avoid overwriting if we are currently streaming.
    if (isStreaming) return;

    const fetchMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/chats/${activeConvId}`);
        if (res.ok) {
          const msgs: any[] = await res.json();
          const mappedMessages: Message[] = msgs.map((m) => ({
            id: m.id,
            role: m.sender as "user" | "assistant",
            content: m.query,
            agentId: conv?.agentId // or from m.agent_id if we stored it per message
          }));

          setConversations(prev => prev.map(c => {
            if (c.id === activeConvId) {
              return { ...c, messages: mappedMessages };
            }
            return c;
          }));
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    if (conv && conv.messages.length === 0) {
      fetchMessages();
    }
  }, [activeConvId, isStreaming]); // conversations in dep array causes loops if not careful



  // Close dropdown on outside click
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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages, streamedText, isThinking]);

  // Cleanup streaming on unmount
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



  // Stream from real server SSE endpoint
  const streamFromServer = useCallback(
    async (message: string, agentId: string, convId: string) => {
      const userId = currentAccount?.address;
      if (!userId) {
        console.warn("No wallet connected, falling back to demo");
        return false; // signal caller to use demo fallback
      }

      setIsThinking(true);
      setThinkingStatus(null);

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
            client_time: new Date().toISOString(), // Send local time
          }),
        });

        if (response.status === 429) {
          const err = await response.json();
          // Check if this is the task agent specific limit
          if (err.requiresUpgrade) {
            setShowUpgradeModal(true);
            setIsThinking(false);

            // Refresh status
            if (currentAccount?.address) {
              const endpoint = agentId === "task" ? "task-prompts" : "research-prompts";
              const setter = agentId === "task" ? setTaskPromptStatus : setResearchPromptStatus;
              const countdownSetter = agentId === "task" ? setTaskCountdown : setResearchCountdown;

              fetch(`${API_BASE_URL}/api/chat/${endpoint}/${currentAccount.address}`)
                .then(r => r.json())
                .then(s => {
                  setter(s);
                  if (s.resetInSeconds) countdownSetter(s.resetInSeconds);
                });
            }
            return false;
          }

          // General rate limit
          console.error("Rate limit exceeded:", err);
          setIsThinking(false);
          // Show error as message
          const errorMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: `⏱️ **Rate Limit Reached**\n\n${err.message}\n\nYou can send ${err.limit} messages every 6 hours.`
          };

          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== currentConvId && c.tempId !== currentConvId) return c;
              return { ...c, messages: [...c.messages, errorMsg] };
            })
          );

          return false;
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.error("Chat API error:", err);
          return false;
        }

        // Refresh prompt usage if successful start
        if (agentId === "task" || agentId === "research") {
          const endpoint = agentId === "task" ? "task-prompts" : "research-prompts";
          const setter = agentId === "task" ? setTaskPromptStatus : setResearchPromptStatus;
          fetch(`${API_BASE_URL}/api/chat/${endpoint}/${userId}`)
            .then(r => r.json())
            .then(s => setter(s));
        }

        const reader = response.body?.getReader();
        if (!reader) return false;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep the incomplete last line

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
                  // Update thinking indicator with server status
                  if (!aborted) {
                    setThinkingStatus(parsed.text || parsed);
                  }
                  break;

                case "conversation":
                  // Update conversation ID if it changed (e.g. from temporary to persistent)
                  if (!aborted && parsed.id && parsed.id !== convId) {

                    currentConvId = parsed.id;

                    if (chatId === convId) {
                      navigate(`/chat/${parsed.id}`, { replace: true });
                    }

                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === convId ? { ...c, id: parsed.id, tempId: convId } : c
                      )
                    );
                  }
                  break;

                case "chunk":
                  // First chunk transitions from thinking to streaming
                  if (!aborted) {
                    setIsThinking(false);
                    setThinkingStatus(null);
                    setIsStreaming(true);
                    fullText += parsed.text || "";
                    setStreamedText(fullText);
                  }
                  break;

                case "action":
                  // Side-effect actions (task_created, etc.)

                  break;

                case "error":
                  console.error("[CHAT] Server error:", parsed.message);
                  if (!aborted) {
                    setIsThinking(false);
                    setThinkingStatus(null);
                    setIsStreaming(true);
                    fullText = parsed.message || "An error occurred.";
                    setStreamedText(fullText);
                  }
                  break;

                case "done":
                  aborted = true; // stop processing
                  break;
              }
            }
          }
        }

        // Commit the full message
        setIsStreaming(false);
        setStreamedText("");

        if (fullText) {
          const assistantMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: fullText,
            agentId,
          };

          setConversations((prev) =>
            prev.map((c) => {
              // Use currentConvId which might have been updated from convId
              if (c.id !== currentConvId && c.tempId !== currentConvId) return c;
              return { ...c, messages: [...c.messages, assistantMsg] };
            })
          );
        }

        return true; // success
      } catch (error) {
        console.error("[CHAT] Stream error:", error);
        setIsThinking(false);
        setThinkingStatus(null);
        setIsStreaming(false);
        setStreamedText("");
        return false;
      }
    },
    [currentAccount?.address, selectedAgentId, chatId]
  );

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride || input).trim();
    if (!text || isStreaming || isThinking) return;

    // Client-side check for limits
    if (selectedAgentId === "task" && taskPromptStatus) {
      if (taskPromptStatus.remaining <= 0) {
        setShowUpgradeModal(true);
        return;
      }
    }
    if (selectedAgentId === "research" && researchPromptStatus) {
      if (researchPromptStatus.remaining <= 0) {
        setShowUpgradeModal(true);
        return;
      }
    }

    const userMsg: Message = { id: nextId(), role: "user", content: text };

    let currentId = activeConvId;
    // Find conversation by either ID or tempId
    const existingConv = conversations.find(c => c.id === activeConvId || c.tempId === activeConvId);

    if (!existingConv) {
      // Create new conversation
      const newId = `conv-${Date.now()}`;
      currentId = newId;

      const newConv: Conversation = {
        id: newId,
        title: text.length > 40 ? text.slice(0, 40) + "..." : text,
        agentId: selectedAgentId,
        messages: [userMsg],
      };

      setConversations((prev) => [newConv, ...prev]);
      navigate(`/chat/${newId}`, { replace: true });
    } else {
      // Use the actual ID (which might differ from URL activeConvId if it was a tempId)
      currentId = existingConv.id;

      // Add user message to existing conversation
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== existingConv.id) return c;

          return {
            ...c,
            messages: [...c.messages, userMsg],
            title:
              c.title === "New conversation"
                ? text.length > 40
                  ? text.slice(0, 40) + "..."
                  : text
                : c.title,
          };
        })
      );
    }

    setInput("");

    // ── Route to backend or demo ──────────────────────────────────
    if (selectedAgentId === "task") {
      // Real backend call
      const success = await streamFromServer(text, selectedAgentId, currentId);
      if (!success) {
        console.error("Failed to connect to backend");
        // Optional: show error toast or UI state
      }
    } else {
      // Try backend for all agents now, or show not implemented
      const success = await streamFromServer(text, selectedAgentId, currentId);
      if (!success) {
        console.error("Failed to connect to backend for agent:", selectedAgentId);
      }
    }
  }, [input, isStreaming, isThinking, activeConvId, selectedAgentId, streamFromServer, conversations, taskPromptStatus]);

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

    // Remove last assistant message
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConvId) return c;
        const msgs = [...c.messages];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
          msgs.pop();
        }
        return { ...c, messages: msgs };
      })
    );

    // Get the last user message for re-sending
    const lastUserMsg = activeConv.messages
      .filter((m) => m.role === "user")
      .pop();

    if (selectedAgentId === "task" && lastUserMsg) {
      const success = await streamFromServer(lastUserMsg.content, selectedAgentId, activeConvId);
      if (!success) {
        console.error("Failed to regenerate response");
      }
    } else if (lastUserMsg) {
      const success = await streamFromServer(lastUserMsg.content, selectedAgentId, activeConvId);
      if (!success) {
        console.error("Failed to regenerate response");
      }
    }
  }, [isStreaming, isThinking, activeConv, activeConvId, selectedAgentId, streamFromServer]);

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

  const handleDeleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistic delete
    setConversations((prev) => prev.filter((c) => c.id !== id));

    // Call API
    try {
      await fetch(`${API_BASE_URL}/api/chats/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }

    // If current, navigate home
    if (id === activeConvId) {
      navigate("/chat");
    }
  }, [activeConvId, navigate]);

  // ── Mobile actions hookup ────────────────────────────────────────────
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
                className="absolute top-full right-0 mt-2 w-56 bg-[#111318] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                {AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      selectAgent(agent.id);
                      setShowAgentDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 transition-colors cursor-pointer ${selectedAgentId === agent.id
                      ? "bg-white/[0.06]"
                      : "hover:bg-white/[0.04]"
                      }`}
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
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agent.cost === "Free"
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
      )
    });
    return () => setMobileActions?.(null);
  }, [setMobileActions, handleNewChat, activeAgent, showAgentDropdown, selectedAgentId]);

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
              {/* Close Button */}
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 z-10"
              >
                <X size={20} />
              </button>

              {/* Header Icon */}
              <div className="w-12 h-12 rounded-full bg-[#B7FC0D] flex items-center justify-center mb-4 shadow-lg shadow-[#B7FC0D]/20 mx-auto md:mx-0">
                <Crown size={24} className="text-black fill-current" />
              </div>

              <h2 className="text-lg font-bold text-white mb-2 text-center md:text-left">Upgrade to Premium</h2>
              <p className="text-white/60 mb-4 text-sm leading-relaxed text-center md:text-left">
                You need to upgrade to premium to continue. {selectedAgentId === "task" ? "Task Manager" : "Research Agent"} free tier only gets {selectedAgentId === "task" ? "2" : "3"} prompts per day.
              </p>

              {/* Usage Warning Card */}
              <div className="bg-[#27272A] rounded-2xl p-3 mb-4 border border-amber-500/20 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle size={14} className="text-amber-500 fill-amber-500/20" />
                  <span className="text-white font-medium text-xs">Limit Reached</span>
                </div>
                <p className="text-white/60 text-xs mb-2 pl-6">
                  Used <span className="text-white font-bold">
                    {selectedAgentId === "task" ? taskPromptStatus?.used : researchPromptStatus?.used}/
                    {selectedAgentId === "task" ? taskPromptStatus?.limit : researchPromptStatus?.limit}
                  </span> prompts.
                </p>
                {(selectedAgentId === "task" ? taskCountdown : researchCountdown) !== null && (
                  <div className="flex items-center gap-1.5 text-[10px] text-white/40 pl-6 bg-black/20 w-fit px-2 py-1 rounded-md border border-white/5">
                    <Clock size={10} />
                    <span>Resets in <span className="text-white font-medium font-mono tracking-wide">
                      {formatCountdown((selectedAgentId === "task" ? taskCountdown : researchCountdown)!)}
                    </span></span>
                  </div>
                )}
              </div>

              {/* Benefits Card */}
              <div className="bg-[#27272A]/50 rounded-2xl p-3 mb-5 border border-white/5">
                <h3 className="text-white font-medium text-xs mb-2 flex items-center gap-1.5">
                  <Star size={12} className="text-[#B7FC0D] fill-[#B7FC0D]" /> Premium Benefits
                </h3>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2.5 text-xs text-white/80">
                    <div className="w-4 h-4 rounded-full bg-[#B7FC0D]/10 flex items-center justify-center flex-shrink-0">
                      <Check size={8} className="text-[#B7FC0D]" strokeWidth={3} />
                    </div>
                    <span>{selectedAgentId === "task" ? "5 daily task prompts" : "6 daily research prompts"}</span>
                  </li>
                  <li className="flex items-center gap-2.5 text-xs text-white/80">
                    <div className="w-4 h-4 rounded-full bg-[#B7FC0D]/10 flex items-center justify-center flex-shrink-0">
                      <Check size={8} className="text-[#B7FC0D]" strokeWidth={3} />
                    </div>
                    <span>Priority agent access</span>
                  </li>
                  <li className="flex items-center gap-2.5 text-xs text-white/80">
                    <div className="w-4 h-4 rounded-full bg-[#B7FC0D]/10 flex items-center justify-center flex-shrink-0">
                      <Check size={8} className="text-[#B7FC0D]" strokeWidth={3} />
                    </div>
                    <span>Advanced features</span>
                  </li>
                </ul>
              </div>

              {/* Footer Actions */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { setShowUpgradeModal(false); navigate('/subscription'); }}
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

      {/* ── Desktop Header ─────────────────────────────────────────── */}
      <div className="absolute hidden md:flex items-center justify-between px-10 w-full mx-auto pt-6 flex-shrink-0 z-20">
        <div className="w-full max-w-[1000px] mx-auto flex items-center gap-3">
          {/* Recents Button */}
          <button
            onClick={() => setShowRecents((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${showRecents
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
                      onClick={() => selectAgent(agent.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors cursor-pointer ${selectedAgentId === agent.id
                        ? "bg-white/[0.06]"
                        : "hover:bg-white/[0.04]"
                        }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selectedAgentId === agent.id
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
                      <span className="text-sm font-medium text-white flex-1 text-left">
                        {agent.name}
                      </span>
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${agent.cost === "Free"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-[#B7FC0D]/15 text-[#B7FC0D]"
                          }`}
                      >
                        {agent.cost}
                      </span>
                    </button>
                  ))}

                  {/* Upgrade CTA inside dropdown */}
                  <div className="pt-2 mt-2 border-t border-white/5 px-2 pb-2">
                    <button
                      onClick={() => { setShowAgentDropdown(false); navigate('/subscription'); }}
                      className="w-full py-2 text-xs font-medium text-center text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      Upgrade Plan
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* New Chat Button */}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md hover:bg-white/10 active:scale-95 transition-all cursor-pointer text-white/60 hover:text-white"
          >
            <Plus size={14} />
            <span className="text-sm font-medium">New Chat</span>
          </button>
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Messages Area ─────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable messages */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16 pt-32 pb-36">
            <div className="max-w-[880px] mx-auto space-y-16">
              {/* Loading State */}
              {isLoadingMessages && <ChatSkeleton />}

              {/* Empty state */}
              {!isLoadingMessages && (!activeConv || activeConv.messages.length === 0) &&
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
                      {(CATEGORIES[selectedAgentId] || CATEGORIES.research).map((category, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const currentStatus = selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus;
                            if (currentStatus?.remaining === 0) {
                              setShowUpgradeModal(true);
                              return;
                            }
                            setInput(category.value);
                            inputRef.current?.focus();
                          }}
                          disabled={isStreaming || isThinking}
                          className={`flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-left transition-all duration-200 backdrop-blur-md group
                            ${((selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)?.remaining === 0)
                              ? "opacity-50 cursor-not-allowed"
                              : "hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                            }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-colors">
                            <category.icon size={20} className="text-white/80 group-hover:text-white" />
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
                      ))}
                    </div>
                  </div>
                )}

              {/* Messages */}
              {!isLoadingMessages && activeConv?.messages.map((msg) => (
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
                        <span className="inline-block w-0.5 h-4 bg-[#B7FC0D] ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Thinking indicator */}
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

          {/* Focus Overlay */}
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

          {/* ── Input Area ───────────────────────────────────────── */}
          <div className="absolute bottom-0 w-full flex-shrink-0 px-4 md:px-8 lg:px-16 pb-4 md:pb-6 pt-2 z-50">
            <div className="relative max-w-[900px] mx-auto">
              {/* Rate Limit Notice */}
              {(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus) && (
                <div className="flex justify-between items-center px-4 mb-2 text-xs font-medium">
                  <span className={`${(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)!.remaining === 0 ? "text-red-400" : "text-white/40"}`}>
                    {(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)!.used} / {(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)!.limit} prompts used
                  </span>
                  {(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)!.remaining === 0 && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                    >
                      Upgrade Limit
                    </button>
                  )}
                </div>
              )}

              {/* Autocomplete Suggestions */}
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
                        .filter(p =>
                          p.label.toLowerCase().includes(input.toLowerCase()) ||
                          p.prompt.toLowerCase().includes(input.toLowerCase()) ||
                          p.keywords.some(k => k.toLowerCase().includes(input.toLowerCase()))
                        )
                        .slice(0, 4)
                        .map((prompt, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              const currentStatus = selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus;
                              if (currentStatus?.remaining === 0) {
                                setShowUpgradeModal(true);
                                return;
                              }

                              // Check if prompt has placeholders that need user input
                              const hasPlaceholder = prompt.prompt.includes("0x...") ||
                                prompt.prompt.includes("[...]") ||
                                prompt.prompt.includes("...") ||
                                prompt.prompt.includes("[payload]");

                              if (hasPlaceholder) {
                                setInput(prompt.prompt);
                                inputRef.current?.focus();
                              } else {
                                handleSend(prompt.prompt);
                              }
                            }}
                            disabled={isStreaming || isThinking}
                            className={`w-full flex items-center gap-3 p-4 transition-colors text-left group border-b border-white/5 last:border-0
                              ${taskPromptStatus?.remaining === 0 && selectedAgentId === "task"
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
                      // Auto-resize
                      e.target.style.height = "auto";
                      e.target.style.height =
                        Math.min(e.target.scrollHeight, 120) + "px";
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={(selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)?.remaining === 0 ? "Daily limit reached. Upgrade to continue." : `Message ${activeAgent.name}...`}
                    rows={1}
                    disabled={isStreaming || isThinking || (selectedAgentId === "task" ? taskPromptStatus : researchPromptStatus)?.remaining === 0}
                    className="flex-1 bg-transparent text-white text-sm placeholder:text-white/30 px-5 py-4 pr-14 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed w-full max-h-[120px] overflow-y-auto"
                    style={{ minHeight: "52px" }}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isStreaming || isThinking || (taskPromptStatus?.remaining === 0 && selectedAgentId === "task")}
                    className={`absolute right-2 bottom-2 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${input.trim() && !isStreaming && !isThinking
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

// ── Message Bubble Sub-component ─────────────────────────────────────

function MessageBubble({
  message,
  copiedId,
  feedback,
  onCopy,
  onFeedback,
  onRegenerate,
  isLast,
}: {
  message: Message;
  copiedId: string | null;
  feedback: Record<string, "up" | "down">;
  onCopy: (text: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: () => void;
  isLast: boolean;
}) {
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

  // Assistant message
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

        {/* Actions */}
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={() => onCopy(message.content, message.id)}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
            title="Copy"
          >
            {isCopied ? (
              <Check
                size={14}
                className="text-emerald-400"
              />
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

export default Dashboard;
