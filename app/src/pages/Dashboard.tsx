import {
  useCurrentAccount,
  useSignPersonalMessage,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import {
  Plus,
  Fuel,
  X,
  ArrowUp,
  Square,
  Layout,
  ChevronDown,
  Crown,
  AlertCircle,
} from "lucide-react";
import WorkflowSteps from "@/components/WorkflowSteps";
import AgentSelector from "@/components/AgentSelector";
import RecentChatsModal from "@/components/RecentChatsModal";
import ArtifactPanel from "@/components/ArtifactPanel";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";
import { LayoutContextType } from "./Layout";

// Define custom Sui Move language for rehype-highlight
const moveLanguage = (hljs: any) => {
  return {
    name: "Move",
    case_insensitive: false,
    keywords: {
      keyword:
        "public native friend entry fun struct use module const script has as mut copy drop store key if else return abort break continue loop while let move",
      literal: "true false",
      type: "u8 u16 u32 u64 u128 u256 bool address vector signer UID TxContext Coin Balance Option String",
      built_in:
        "transfer public_transfer object new share_object freeze_object delete init mint burn",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.NUMBER_MODE,
      {
        className: "title.function",
        begin: /public\s+(entry\s+)?fun\s+/,
        end: /\s*\(/,
        excludeBegin: true,
        excludeEnd: true,
        relevance: 0,
      },
      {
        className: "type",
        begin: /:\s*/,
        end: /\s*(=|;|\)|,)/,
        excludeBegin: true,
        excludeEnd: true,
        keywords:
          "u8 u16 u32 u64 u128 u256 bool address vector signer UID TxContext Coin Balance Option String",
      },
    ],
  };
};
// hljs core import removed
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import rust from "highlight.js/lib/languages/rust";

// (Manual hljs registration removed - passing directly to rehype-highlight)

// Define custom Sui Move language

import { ModalPortal } from "@/components/ui/ModalPortal";
import { Tooltip } from "@/components/ui/Tooltip";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchChats,
  fetchChatHistory,
  setCurrentChat,
  addMessage,
  setMessages,
  setActiveArtifact,
  deleteChat,
  type Message,
} from "@/store/slices/chatsSlice";
import { getAgentConfig } from "@/config/agents";
import { type Command } from "@/config/commands";
import {
  sendChatMessage,
  getRateLimitStatus,
  RateLimitStatus,
  getTaskPromptStatus,
} from "@/services/chatService";
import LinkPreview from "@/components/LinkPreview";

// Custom Markdown Components (Gemini Style)
const MarkdownComponents = (handleOpenArtifact: any) => ({
  h1: ({ node, ...props }: any) => (
    <h1
      className="text-2xl font-semibold mb-4 mt-6 text-white pb-2"
      {...props}
    />
  ),
  h2: ({ node, ...props }: any) => (
    <h2 className="text-lg font-semibold mb-3 mt-5 text-white" {...props} />
  ),
  h3: ({ node, ...props }: any) => (
    <h3
      className="text-base font-semibold mb-2 mt-4 text-white/90"
      {...props}
    />
  ),
  h4: ({ node, ...props }: any) => (
    <h4 className="text-sm font-semibold mb-2 mt-3 text-white/80" {...props} />
  ),
  p: ({ node, ...props }: any) => (
    <p
      className="leading-7 mb-4 text-gray-300 last:mb-0 break-words"
      {...props}
    />
  ),
  ul: ({ node, ...props }: any) => (
    <ul
      className="list-disc list-outside ml-5 mb-4 space-y-1 text-gray-300"
      {...props}
    />
  ),
  ol: ({ node, ...props }: any) => (
    <ol
      className="list-decimal list-outside ml-5 mb-4 space-y-1 text-gray-300"
      {...props}
    />
  ),
  li: ({ node, ...props }: any) => (
    <li className="pl-1 break-words" {...props} />
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote
      className="border-l-2 border-white/20 pl-4 py-1 my-4 text-gray-400 italic break-words"
      {...props}
    />
  ),
  a: ({ node, ...props }: any) => (
    <a
      className="text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors break-words"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  pre: ({ children }: any) => <>{children}</>,
  code: ({ node, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !String(children).includes("\n");
    return isInline ? (
      <code
        className="bg-white/10 text-white/90 px-1.5 py-0.5 rounded text-[13px] font-mono border border-white/5 break-all"
        {...props}
      >
        {children}
      </code>
    ) : (
      <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 my-4 w-full max-w-full">
        {match && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/5">
            <span className="text-xs text-gray-400 font-medium font-sans">
              {match[1].charAt(0).toUpperCase() + match[1].slice(1)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleOpenArtifact(String(children), "code", match[1])
                }
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white cursor-pointer"
                title="Open as Artifact"
              >
                <Layout size={14} />
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(String(children))}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white cursor-pointer"
                title="Copy code"
              >
                <span className="sr-only">Copy</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto w-full">
          <code
            className={`${className} block text-sm p-4 font-mono leading-relaxed min-w-0`}
            {...props}
          >
            {children}
          </code>
        </div>
      </div>
    );
  },
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-6 rounded-lg border border-white/10 w-full">
      <table
        className="w-full text-left border-collapse bg-white/5"
        {...props}
      />
    </div>
  ),
  th: ({ node, ...props }: any) => (
    <th
      className="bg-white/10 p-3 font-semibold text-white/90 border-b border-white/10 text-sm whitespace-nowrap"
      {...props}
    />
  ),
  td: ({ node, ...props }: any) => (
    <td
      className="p-3 border-b border-white/5 text-gray-300 text-sm whitespace-nowrap"
      {...props}
    />
  ),
  hr: ({ node, ...props }: any) => (
    <hr className="border-white/10 my-8" {...props} />
  ),
  img: ({ node, ...props }: any) => (
    <img
      className="rounded-lg my-4 max-w-full h-auto border border-white/10"
      {...props}
      alt={props.alt || ""}
    />
  ),
});

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();
  const { chatId } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  useOutletContext<LayoutContextType>();

  // Redux state
  const dispatch = useAppDispatch();
  const chats = useAppSelector((state) => state.chats.chats);
  const currentChatId = useAppSelector((state) => state.chats.currentChatId);
  const messagesMap = useAppSelector((state) => state.chats.messages);
  const activeArtifact = useAppSelector((state) => state.chats.activeArtifact);

  // Local state
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isProcessingPrompt, setIsProcessingPrompt] = useState(false);

  const [streamingText, setStreamingText] = useState("");
  const [agentUsed, setAgentUsed] = useState<string>("");
  const [tempMessages, setTempMessages] = useState<Message[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("task_agent");
  const [autoOpenAgentSelector, setAutoOpenAgentSelector] = useState(false);
  const [feeModalDetail, setFeeModalDetail] = useState<{
    agent: string;
    cost: number;
    reason: string;
  } | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [isPayingGas, setIsPayingGas] = useState(false);
  const [isRecentModalOpen, setIsRecentModalOpen] = useState(false);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [filteredCommands] = useState<Command[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "like" | "dislike">>(
    {},
  );

  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);

  // Rate limit state
  const [rateLimitStatus, setRateLimitStatus] =
    useState<RateLimitStatus | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Task prompt limit state
  const [taskPromptStatus, setTaskPromptStatus] = useState<{
    used: number;
    limit: number;
    remaining: number;
    tier: number;
  } | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Pending transaction action state (for immediate token transfers)
  interface PendingTxAction {
    taskId: string;
    actionType: string;
    recipientAddress?: string;
    amount?: string;
    coinType?: string;
    fromCoin?: string;
    toCoin?: string;
    amountToSwap?: string;
  }
  const [pendingTxAction, setPendingTxAction] =
    useState<PendingTxAction | null>(null);

  // Format countdown as HH:MM:SS
  const formatCountdown = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Get messages for current chat (include temp messages if no chat ID)
  const messages = currentChatId
    ? messagesMap[currentChatId] || []
    : tempMessages;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const user_id = currentAccount?.address || "";
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Regenerate the last AI message without resending user message
  const regenerateMessage = async (messageToRegenerate: Message) => {
    if (isLoading || !user_id) return;

    // Find the user message that prompted this AI response
    const messageIndex = messages.findIndex(
      (m) => m.id === messageToRegenerate.id,
    );
    const userMessage = messages
      .slice(0, messageIndex)
      .reverse()
      .find((m) => m.sender === "user");

    if (!userMessage) return;

    setIsLoading(true);
    setIsProcessingPrompt(true);

    try {
      const response = await sendChatMessage({
        user_id,
        message: userMessage.text,
        chat_id: currentChatId || chatId,
        agent_id: selectedAgentId !== "main" ? selectedAgentId : undefined,
      });

      setIsProcessingPrompt(false);
      setAgentUsed(response.agent_used);

      if (response.workflow_steps && response.workflow_steps.length > 0) {
        setWorkflowSteps(response.workflow_steps);
      }

      // Add the new response as a variation
      const updatedMessage: Message = {
        ...messageToRegenerate,
        variations: messageToRegenerate.variations
          ? [...messageToRegenerate.variations, response.response]
          : [messageToRegenerate.text, response.response],
        currentVariationIndex: messageToRegenerate.variations
          ? messageToRegenerate.variations.length
          : 1,
      };

      if (currentChatId) {
        // Update the message in Redux with the new variation
        const updatedMessages = messages.map((m) =>
          m.id === messageToRegenerate.id ? updatedMessage : m,
        );
        dispatch(
          setMessages({ chatId: currentChatId, messages: updatedMessages }),
        );
      } else {
        setTempMessages((prev) =>
          prev.map((m) =>
            m.id === messageToRegenerate.id ? updatedMessage : m,
          ),
        );
      }

      setIsLoading(false);
      setWorkflowSteps([]);
    } catch (error) {
      console.error("Error regenerating message:", error);
      setIsLoading(false);
      setIsProcessingPrompt(false);
    }
  };

  // Navigate between message variations
  const navigateVariation = (message: Message, direction: "prev" | "next") => {
    if (!message.variations) return;

    const currentIndex = message.currentVariationIndex ?? 0;
    const newIndex =
      direction === "next"
        ? Math.min(currentIndex + 1, message.variations.length - 1)
        : Math.max(currentIndex - 1, 0);

    const updatedMessage: Message = {
      ...message,
      currentVariationIndex: newIndex,
    };

    if (currentChatId) {
      const updatedMessages = messages.map((m) =>
        m.id === message.id ? updatedMessage : m,
      );
      dispatch(
        setMessages({ chatId: currentChatId, messages: updatedMessages }),
      );
    } else {
      setTempMessages((prev) =>
        prev.map((m) => (m.id === message.id ? updatedMessage : m)),
      );
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, workflowSteps]);

  useEffect(() => {
    dispatch(setCurrentChat(chatId || null));
  }, [chatId, dispatch]);

  // Persist current chat and its messages to localStorage for instant preloading
  useEffect(() => {
    if (currentChatId) {
      localStorage.setItem("tovira_last_chat_id", currentChatId);

      const chatMessages = messagesMap[currentChatId];
      if (chatMessages && chatMessages.length > 0) {
        localStorage.setItem(
          `tovira_chat_messages_${currentChatId}`,
          JSON.stringify(chatMessages),
        );
      }
    }
  }, [currentChatId, messagesMap]);

  // Restore last chat and messages on mount if no chatId in URL
  useEffect(() => {
    if (!chatId && user_id) {
      const lastChatId = localStorage.getItem("tovira_last_chat_id");
      if (lastChatId) {
        // Preload messages into Redux for instant display
        const cachedMessages = localStorage.getItem(
          `tovira_chat_messages_${lastChatId}`,
        );
        if (cachedMessages) {
          try {
            dispatch(
              setMessages({
                chatId: lastChatId,
                messages: JSON.parse(cachedMessages),
              }),
            );
          } catch (e) {
            console.warn("Failed to parse cached messages:", e);
          }
        }
        navigate(`/${lastChatId}`, { replace: true });
      }
    }
  }, [user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch chats from Redux
  useEffect(() => {
    if (!user_id) return;
    dispatch(
      fetchChats({
        userId: user_id,
        agentId: selectedAgentId !== "main" ? selectedAgentId : undefined,
      }),
    );
  }, [user_id, selectedAgentId, dispatch]);

  // Check rate limit status on load and after user_id changes
  useEffect(() => {
    if (!user_id) return;
    getRateLimitStatus(user_id).then((status) => {
      setRateLimitStatus(status);
      if (status.isLimited && status.resetInSeconds) {
        setCountdown(status.resetInSeconds);
      }
    });
  }, [user_id]);

  // Check task prompt status when task agent is selected
  useEffect(() => {
    if (selectedAgentId === "task_agent" && user_id) {
      getTaskPromptStatus(user_id).then((status) => {
        setTaskPromptStatus(status);
        console.log("[TASK PROMPTS] Status:", status);
      });
    }
  }, [selectedAgentId, user_id]);

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          // Timer expired, refresh rate limit status
          if (user_id) {
            getRateLimitStatus(user_id).then((status) => {
              setRateLimitStatus(status);
              if (!status.isLimited) {
                setCountdown(null);
              }
            });
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, user_id]);

  // Handle pending transaction execution (immediate token transfers)
  useEffect(() => {
    if (!pendingTxAction || !currentAccount) return;

    const toMist = (amount: string): bigint => {
      try {
        const cleanAmount = amount.replace(/,/g, "");
        const num = parseFloat(cleanAmount);
        if (isNaN(num)) return BigInt(0);
        return BigInt(Math.floor(num * 1e9));
      } catch {
        return BigInt(0);
      }
    };

    const executePendingTransaction = async () => {
      try {
        console.log(
          "[Dashboard] Executing pending transaction:",
          pendingTxAction,
        );

        // Build the transaction
        const tx = new Transaction();

        let description = "";
        if (pendingTxAction.actionType === "token_transfer") {
          // Split coin and transfer
          const amountMist = toMist(pendingTxAction.amount || "0");
          const [coin] = tx.splitCoins(tx.gas, [amountMist]);
          tx.transferObjects([coin], pendingTxAction.recipientAddress || "");

          const mistValue = amountMist;
          const whole = mistValue / BigInt(1e9);
          const frac = mistValue % BigInt(1e9);
          const amountSui =
            frac > 0
              ? `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`
              : whole.toString();

          description = `Transfer of ${amountSui} SUI to \`${(pendingTxAction.recipientAddress || "").slice(0, 10)}...${(pendingTxAction.recipientAddress || "").slice(-8)}\``;
        } else if (pendingTxAction.actionType === "token_swap") {
        }

        // Execute and sign the transaction
        const result = await signAndExecuteTransaction({
          transaction: tx,
        });

        console.log("[Dashboard] Transaction executed:", result.digest);

        // Update task status via API
        const API_BASE_URL =
          import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
        await fetch(
          `${API_BASE_URL}/api/tasks/${pendingTxAction.taskId}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: currentAccount.address,
              tx_digest: result.digest,
            }),
          },
        );

        // Add success message to chat
        const successMessage: Message = {
          id: Date.now() + Math.random(),
          text: `**Transaction Successful!**\n\n${description} completed.\n\n[View on Explorer](https://suiscan.xyz/${import.meta.env.VITE_SUI_NETWORK || "testnet"}/tx/${result.digest})`,
          sender: "ai",
          timestamp: new Date().toLocaleTimeString(),
          chat_id: currentChatId || undefined,
          agentType: "Task Manager",
          agentId: "task_agent",
        };

        if (currentChatId) {
          dispatch(
            addMessage({ chatId: currentChatId, message: successMessage }),
          );
        }

        setPendingTxAction(null);
      } catch (error: any) {
        console.error("[Dashboard] Transaction failed:", error);

        // Add error message
        const errorMessage: Message = {
          id: Date.now() + Math.random(),
          text: `**Transaction Failed**\n\n${error.message || "User cancelled or transaction failed."}`,
          sender: "ai",
          timestamp: new Date().toLocaleTimeString(),
          chat_id: currentChatId || undefined,
          agentType: "Task Manager",
          agentId: "task_agent",
        };

        if (currentChatId) {
          dispatch(
            addMessage({ chatId: currentChatId, message: errorMessage }),
          );
        }

        setPendingTxAction(null);
      }
    };

    executePendingTransaction();
  }, [
    pendingTxAction,
    currentAccount,
    signAndExecuteTransaction,
    currentChatId,
    dispatch,
  ]);

  // Fetch chat history from Redux with background syncing
  useEffect(() => {
    if (!currentChatId || user_id === undefined) {
      return;
    }

    // Only show loading spinner if we don't have messages yet
    const hasMessages =
      messagesMap[currentChatId] && messagesMap[currentChatId].length > 0;
    if (!hasMessages) {
      setIsHistoryLoading(true);
    }

    dispatch(fetchChatHistory(currentChatId)).finally(() => {
      setIsHistoryLoading(false);
    });
  }, [currentChatId, user_id, dispatch, messagesMap]); // Added messagesMap as dependency to check if we have data

  // URL Params for Agent Selection
  const urlParams = new URLSearchParams(window.location.search);
  const agentParam = urlParams.get("agent");

  useEffect(() => {
    if (agentParam) {
      // Map param to AgentType values
      const idMap: { [key: string]: string } = {
        "research-1": "research_agent",
        "task-1": "task_agent",
        "alert-1": "alert_agent",
      };
      const mappedId = idMap[agentParam] || agentParam;

      // Only reset if the agent actually changed
      if (mappedId !== selectedAgentId) {
        setSelectedAgentId(mappedId);

        // Reset chat state for new agent
        setTempMessages([]);
        dispatch(setCurrentChat(null));
        navigate("/?agent=" + agentParam);
      }
    }
  }, [agentParam, selectedAgentId, dispatch, navigate]);

  const handleSendMessage = async (text?: string) => {
    const query = text || input;
    if (!query.trim() || isLoading) return;

    // Check task agent prompt limit
    if (selectedAgentId === "task_agent" && taskPromptStatus) {
      if (taskPromptStatus.remaining <= 0) {
        setShowUpgradeModal(true);
        return;
      }
    }

    // Check if user is authenticated
    if (!user_id) {
      console.error("User not authenticated");
      return;
    }

    // Handle command execution
    if (query.trim().startsWith("/")) {
      handleCommand(query.trim());
      return;
    }

    const userMessage: Message = {
      id: Date.now() + Math.random(),
      text: query,
      sender: "user",
      timestamp: new Date().toLocaleTimeString(),
      chat_id: chatId || currentChatId || undefined,
    };

    setInput("");
    setIsLoading(true);

    // Initial message addition (to temp or current chat)
    if (currentChatId) {
      dispatch(addMessage({ chatId: currentChatId, message: userMessage }));
    } else {
      setTempMessages((prev) => [...prev, userMessage]);
    }

    try {
      // Show processing state
      setIsProcessingPrompt(true);

      // Get last 5 messages for history context
      const history = messages.slice(-5).map((msg) => ({
        role:
          msg.sender === "user"
            ? "user"
            : ("assistant" as "user" | "assistant"),
        content:
          msg.sender === "ai" && msg.variations
            ? msg.variations[msg.currentVariationIndex ?? 0]
            : msg.text,
      }));

      // ============================================
      // STREAMING IMPLEMENTATION STARTS HERE
      // ============================================

      const API_BASE_URL =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id,
          message: query,
          chat_id: currentChatId || chatId,
          agent_id: selectedAgentId !== "main" ? selectedAgentId : undefined,
          history,
        }),
      });

      if (response.status === 429) {
        const errorData = await response.json();

        if (errorData.requiresUpgrade) {
          console.log(
            "[DASHBOARD] Task agent limit reached - showing upgrade modal",
          );
          setShowUpgradeModal(true);
          setIsLoading(false);
          setIsProcessingPrompt(false);

          // Refresh task prompt status to show updated UI
          if (selectedAgentId === "task_agent" && user_id) {
            getTaskPromptStatus(user_id).then(setTaskPromptStatus);
          }
          return;
        }

        // General rate limit (6-hour window for other agents)
        console.log("[DASHBOARD] General rate limit reached");
        const errorMessage: Message = {
          id: Date.now() + Math.random(),
          text: `⏱️ **Rate Limit Reached**\n\n${errorData.message}\n\nYou can send ${errorData.limit} messages every 6 hours.`,
          sender: "ai",
          timestamp: new Date().toLocaleTimeString(),
        };

        if (currentChatId) {
          dispatch(
            addMessage({ chatId: currentChatId, message: errorMessage }),
          );
        } else {
          setTempMessages((prev) => [...prev, errorMessage]);
        }

        setIsLoading(false);
        setIsProcessingPrompt(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read the stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Variables to collect complete response data
      let completeResponse = "";
      let agentUsedInStream = "main";
      let requiresFee = false;
      let estimatedCost = 0;
      let chatIdFromStream = currentChatId || chatId;
      let pendingActionFromStream: any = null;

      setIsProcessingPrompt(false);
      setStreamingText(""); // Start showing streaming text

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log("[STREAM] Stream completed");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;

            try {
              const chunk = JSON.parse(data);
              console.log("[STREAM] Chunk:", chunk);

              if (chunk.chat_id) {
                chatIdFromStream = chunk.chat_id;
              }
              if (chunk.finalResponse) {
                completeResponse = chunk.finalResponse;
                setStreamingText(chunk.finalResponse);
              }
              if (chunk.targetAgent) {
                agentUsedInStream = chunk.targetAgent;
                setAgentUsed(chunk.targetAgent);
              }
              if (chunk.requiresFee !== undefined)
                requiresFee = chunk.requiresFee;
              if (chunk.estimatedCost !== undefined)
                estimatedCost = chunk.estimatedCost;
              if (chunk.workflowSteps) setWorkflowSteps(chunk.workflowSteps);
              if (chunk.pendingAction)
                pendingActionFromStream = chunk.pendingAction;
            } catch (e) {
              console.error("[STREAM] Parse error:", e);
            }
          }
        }
      }

      // ============================================
      // STREAM COMPLETE - PERSIST RESULTS
      // ============================================

      // Determine active chat ID
      const activeChatId = chatIdFromStream || currentChatId || chatId;

      // Add AI response to history
      const aiMessage: Message = {
        id: Date.now() + Math.random(),
        text: completeResponse || "No response generated",
        sender: "ai",
        timestamp: new Date().toLocaleTimeString(),
        chat_id: activeChatId || undefined,
        agentType: getAgentConfig(agentUsedInStream).displayName,
        agentId: agentUsedInStream,
      };

      if (activeChatId) {
        // If this was a new chat creation, migrate everything to Redux once
        if (!currentChatId && !chatId) {
          dispatch(setCurrentChat(activeChatId));
          // Use the locally defined userMessage to avoid stale closure issues
          const historyToSync = [userMessage, aiMessage];

          historyToSync.forEach((msg) => {
            dispatch(
              addMessage({
                chatId: activeChatId,
                message: { ...msg, chat_id: activeChatId },
              }),
            );
          });

          // Clear temp messages immediately to switch view to persisted chat
          setTempMessages([]);
          navigate(`/${activeChatId}`);
        } else {
          // Normal existing chat: just add the AI message
          dispatch(addMessage({ chatId: activeChatId, message: aiMessage }));
        }
      } else {
        // Fallback for unexpected null chat ID (temp chat)
        setTempMessages((prev) => [...prev, aiMessage]);
      }

      // Cleanup streaming and processing states immediately
      setStreamingText("");
      setIsProcessingPrompt(false);
      setIsLoading(false);
      setWorkflowSteps([]);

      // Refresh rate limit status
      getRateLimitStatus(user_id).then(setRateLimitStatus);

      // Refresh task prompt status if using task agent
      if (selectedAgentId === "task_agent") {
        getTaskPromptStatus(user_id).then(setTaskPromptStatus);
      }

      // Handle extra actions (fees, pending tx)
      if (requiresFee && estimatedCost) {
        setFeeModalDetail({
          agent: agentUsedInStream,
          cost: estimatedCost,
          reason: "Deep research and analysis",
        });
        return;
      }

      // Check for pending action (immediate token transfer or swap)
      if (
        pendingActionFromStream &&
        (pendingActionFromStream.action_type === "token_transfer" ||
          pendingActionFromStream.action_type === "token_swap")
      ) {
        const { task_id, action_params } = pendingActionFromStream;
        console.log(
          "[Dashboard] Pending action detected, triggering transaction:",
          action_params,
        );

        setPendingTxAction({
          taskId: task_id.toString(),
          actionType: pendingActionFromStream.action_type || "token_transfer",
          recipientAddress: action_params.recipientAddress,
          amount: action_params.amount,
          coinType: action_params.coinType,
          fromCoin: action_params.fromCoin,
          toCoin: action_params.toCoin,
          amountToSwap: action_params.amountToSwap,
        });
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      setIsLoading(false);
      setIsProcessingPrompt(false);
      setStreamingText("");

      // Determine error message
      let errorText = "Sorry, I encountered an error. Please try again.";

      // Handle rate limit error
      if (error.response?.status === 429) {
        const data = error.response.data;

        // Task agent specific limit
        if (data.requiresUpgrade) {
          setShowUpgradeModal(true);

          // Refresh task prompt status
          if (selectedAgentId === "task_agent" && user_id) {
            getTaskPromptStatus(user_id).then(setTaskPromptStatus);
          }
          return;
        }

        errorText = `⏱️ **Rate Limit Reached**\n\n${data.message}\n\nYou can send ${data.limit} messages every 6 hours.`;
      }

      // Show error message
      const errorMessage: Message = {
        id: Date.now() + Math.random(),
        text: errorText,
        sender: "ai",
        timestamp: new Date().toLocaleTimeString(),
      };

      if (currentChatId) {
        dispatch(addMessage({ chatId: currentChatId, message: errorMessage }));
      } else {
        setTempMessages((prev) => [...prev, errorMessage]);
      }
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setStreamingText("");
      setIsProcessingPrompt(false);
    }
  };

  const handleCommand = (command: string) => {
    const cmd = command.toLowerCase();

    if (cmd === "/clear") {
      // Clear chat logic
      console.log("Clear chat");
    } else if (cmd === "/new") {
      startNewChat();
    } else if (cmd === "/help") {
      // Show help
      console.log("Show help");
    }

    setInput("");
    setShowCommandMenu(false);
  };

  const confirmFee = async () => {
    if (!pendingQuery || !feeModalDetail || !currentAccount?.address) {
      console.error("Missing required data for signature");
      return;
    }

    setIsPayingGas(true);

    try {
      // Create message to sign (includes timestamp to prevent replay attacks)
      const timestamp = Date.now();
      const message = `Approve Research Agent\nCost: ${feeModalDetail.cost} SUI\nQuery: ${pendingQuery}\nTimestamp: ${timestamp}`;

      // Sign message with user's wallet
      const { signature } = await signPersonalMessage({
        message: new TextEncoder().encode(message),
      });

      console.log("Message signed successfully:", signature);

      // Clear fee modal
      setFeeModalDetail(null);
      setIsPayingGas(false);

      // Resend chat request with signature
      try {
        setIsLoading(true);
        setIsProcessingPrompt(true);

        const history = messages.slice(-5).map((msg) => ({
          role:
            msg.sender === "user"
              ? "user"
              : ("assistant" as "user" | "assistant"),
          content:
            msg.sender === "ai" && msg.variations
              ? msg.variations[msg.currentVariationIndex ?? 0]
              : msg.text,
        }));

        const response = await sendChatMessage({
          user_id: currentAccount.address,
          message: pendingQuery,
          chat_id: currentChatId || chatId,
          agent_id: selectedAgentId,
          transaction_hash: signature, // Send signature as "transaction hash"
          history,
        });

        setIsProcessingPrompt(false);
        setAgentUsed(response.agent_used);

        if (response.workflow_steps && response.workflow_steps.length > 0) {
          setWorkflowSteps(response.workflow_steps);
        }

        let activeChatId = response.chat_id;
        if (!currentChatId && !chatId) {
          dispatch(setCurrentChat(activeChatId));
          const allMessages = [...tempMessages];
          allMessages.forEach((msg) => {
            dispatch(
              addMessage({
                chatId: activeChatId!,
                message: { ...msg, chat_id: activeChatId },
              }),
            );
          });
          setTempMessages([]);
          navigate(`/${activeChatId}`);
        }

        const aiMessage: Message = {
          id: Date.now() + Math.random(),
          text: response.response,
          sender: "ai",
          timestamp: new Date().toLocaleTimeString(),
          chat_id: activeChatId || undefined,
          agentType: getAgentConfig(response.agent_used).displayName,
          agentId: response.agent_used,
        };

        if (activeChatId) {
          dispatch(addMessage({ chatId: activeChatId, message: aiMessage }));
        }

        setIsLoading(false);
        setWorkflowSteps([]);
        setPendingQuery(null);
      } catch (error) {
        console.error("Error executing research after signing:", error);
        setIsLoading(false);
        setIsProcessingPrompt(false);
      }
    } catch (error: any) {
      console.error("Message signing failed:", error);
      setIsPayingGas(false);
      alert("Signing failed: " + error.message);
    }
  };

  const cancelFee = () => {
    console.log("Fee cancelled");
    setFeeModalDetail(null);
    setPendingQuery(null);
    setIsPayingGas(false);
  };

  const handleCloseArtifact = () => {
    dispatch(setActiveArtifact(null));
  };

  const handleOpenArtifact = (
    content: string,
    type: "code" | "markdown" | "react",
    title?: string,
  ) => {
    dispatch(
      setActiveArtifact({
        id: Date.now().toString(),
        type,
        title: title || "Artifact",
        content,
        isOpen: true,
        language: title,
      }),
    );
  };

  const startNewChat = useCallback(() => {
    setInput("");

    // Reset agent selection state for new chat
    setSelectedAgentId("task_agent");
    setAutoOpenAgentSelector(true);

    // Clear last chat from localStorage so we don't redirect back
    localStorage.removeItem("tovira_last_chat_id");

    // Navigate to home (no chat ID)
    navigate("/");

    // Clear current chat in Redux
    dispatch(setCurrentChat(null));
  }, [navigate, dispatch]);

  const handleSuggestionClick = (title: string) => {
    handleSendMessage(title);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFeedback = (id: string, type: "like" | "dislike") => {
    setFeedback((prev: Record<string, "like" | "dislike">) => {
      const current = prev[id];
      // Toggle off if clicking same type, otherwise switch to new type
      if (current === type) {
        const newState = { ...prev };
        delete newState[id];
        return newState;
      }
      return { ...prev, [id]: type };
    });
    // Log for now, would connect to backend API here
    console.log(`User ${type}d message ${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0,
        );
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1,
        );
        return;
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedCmd = filteredCommands[selectedCommandIndex];
        setInput(selectedCmd.label + " ");
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
        return;
      }
    }

    // Regular send on Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  // Close command menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showCommandMenu &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCommandMenu]);

  const { setMobileActions } = useOutletContext<LayoutContextType>();

  // Register mobile actions with Layout
  useEffect(() => {
    if (setMobileActions) {
      setMobileActions({
        onRecentClick: () => setIsRecentModalOpen(true),
        onNewClick: startNewChat,
      });
    }
    return () => {
      if (setMobileActions) setMobileActions(null);
    };
  }, [setMobileActions, startNewChat]);

  if (isHistoryLoading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] w-full bg-transparent">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between min-h-[100dvh] w-full max-w-4xl mx-auto">
      <div>
        <div className="sticky md:fixed top-0 p-4 w-full flex items-center justify-end md:justify-start gap-3 mb-2 z-50 pointer-events-none mt-20 md:mt-0 hidden md:flex">
          {/* Recent Chats Icon - Always visible */}
          <button
            onClick={() => setIsRecentModalOpen(true)}
            className="bg-[#00060A] hover:bg-white/15 text-white/80 px-4 py-2.5 rounded-full border border-white/10 transition-all duration-200 cursor-pointer flex items-center gap-2 pointer-events-auto"
            title="Recent Chats"
          >
            <img
              src="/assets/icons/refresh.svg"
              className=""
              width={18}
              height={18}
              alt="Recent Chats"
            />
            <span className="hidden md:block text-[15px] font-[400]">
              Recents
            </span>
          </button>

          {/* Agent Selector - In header position */}
          <div className="pointer-events-auto">
            <AgentSelector
              selectedAgentId={selectedAgentId}
              onAgentChange={(agentId) => {
                setSelectedAgentId(agentId);
                setAutoOpenAgentSelector(false);
              }}
              autoOpen={autoOpenAgentSelector}
              location="header"
            />
          </div>

          {/* New Chat Button */}
          {chatId && (
            <button
              onClick={startNewChat}
              className="bg-white/10 hover:bg-white/15 text-white/80 p-4 rounded-full border border-white/10 transition-all duration-200 cursor-pointer pointer-events-auto"
              title="New Chat"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          const isNearBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight < 100;
          setShowScrollButton(!isNearBottom);
        }}
        className="flex-1 overflow-y-auto pt-16 px-4 pb-4 custom-scrollbar relative"
      >
        <AnimatePresence mode="popLayout">
          {messages.length === 0 &&
            !isLoading &&
            !isProcessingPrompt &&
            !streamingText &&
            !(!chatId && localStorage.getItem("tovira_last_chat_id")) ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[50vh] text-center py-4"
            >
              {/* Central Circular Logo */}
              <div className="relative mb-6">
                <div className="w-24 h-24 rounded-full p-0.5 bg-gradient-to-br from-[#B7FC0D] to-[#246AFC] shadow-[0_0_30px_rgba(183,252,13,0.15)]">
                  <div className="w-full h-full rounded-full bg-[#070B0F] flex items-center justify-center overflow-hidden">
                    <img
                      src="/assets/images/signin-logo.png"
                      alt="Tovira Logo"
                      className="w-12 h-12 object-contain"
                    />
                  </div>
                </div>
              </div>

              <h2 className="text-[32px] font-bold text-white mb-4">Tovira</h2>

              <p className="text-white/90 font-medium text-base max-w-md mb-8 leading-relaxed px-4">
                Your AI assistant for anything web3! Ask me about crypto, DeFi
                or the Sui ecosystem.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl px-4 w-full">
                {getAgentConfig(selectedAgentId).suggestions.map(
                  (suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="px-5 py-3 rounded-[40px] bg-[#ffffff]/5 hover:bg-[#ffffff]/10 border border-white/20 text-white/70 hover:text-white transition-all duration-300 text-[14px] text-center font-medium shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                    >
                      {suggestion}
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-8 max-w-3xl mx-auto py-8">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${message.sender === "user" ? "items-end" : "items-start"} group`}
                >
                  <div
                    className={`md:max-w-[85%] overflow-hidden ${message.sender === "user" ? "bg-[#326AFD] text-white rounded-[24px] px-5 py-2.5 shadow-xl md:w-auto md:ml-auto w-fit" : ""}`}
                  >
                    {message.sender === "ai" && (
                      <div className="flex items-center gap-2 mb-2 text-white/40 text-xs font-semibold tracking-wider">
                        <img
                          src={
                            getAgentConfig(message.agentId || "task_agent").iconUrl
                          }
                          alt={
                            getAgentConfig(message.agentId || "task_agent")
                              .displayName
                          }
                          className="w-6 h-6 object-cover"
                        />
                        <span>
                          {message.agentType?.toUpperCase() || "TOVIRA"}
                        </span>
                      </div>
                    )}
                    <div className="w-full text-gray-200 break-words">
                      {message.sender === "user" ? (
                        <p className="text-[15px] break-all leading-relaxed m-0">
                          {message.text}
                        </p>
                      ) : (
                        <>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[
                              [
                                rehypeHighlight,
                                {
                                  languages: {
                                    move: moveLanguage,
                                    sui: moveLanguage,
                                    javascript,
                                    typescript,
                                    python,
                                    bash,
                                    json,
                                    rust,
                                  },
                                },
                              ],
                              rehypeKatex,
                            ]}
                            components={MarkdownComponents(handleOpenArtifact)}
                          >
                            {(() => {
                              const messageText = String(
                                message.variations
                                  ? message.variations[
                                  message.currentVariationIndex ?? 0
                                  ]
                                  : message.text || "",
                              );

                              // Extract URLs that will have preview cards
                              const urlRegex = /(https?:\/\/[^\s\)]+)/g;
                              const urls = messageText.match(urlRegex) || [];
                              const previewUrls = urls
                                .slice(0, 3)
                                .map((url) => url.replace(/[.,;!?]+$/, ""));

                              // Remove preview URLs and their markdown links from the message text
                              let cleanedText = messageText;
                              previewUrls.forEach((url) => {
                                // Remove entire markdown list item line: - [Title](URL) or * [Title](URL)
                                const listItemRegex = new RegExp(
                                  `^[\\s]*[-*]\\s*\\[([^\\]]+)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*$`,
                                  "gm",
                                );
                                cleanedText = cleanedText.replace(
                                  listItemRegex,
                                  "",
                                );
                                // Remove markdown link format: [Title](URL)
                                const markdownLinkRegex = new RegExp(
                                  `\\[([^\\]]+)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
                                  "g",
                                );
                                cleanedText = cleanedText.replace(
                                  markdownLinkRegex,
                                  "",
                                );
                                // Also remove standalone URL
                                cleanedText = cleanedText.replace(url, "");
                              });

                              return cleanedText;
                            })()}
                          </ReactMarkdown>
                          {message.sender === "ai" &&
                            (() => {
                              const messageText = String(
                                message.variations
                                  ? message.variations[
                                  message.currentVariationIndex ?? 0
                                  ]
                                  : message.text || "",
                              );
                              const urlRegex = /(https?:\/\/[^\s\)]+)/g;
                              const urls = messageText.match(urlRegex) || [];
                              return urls
                                .slice(0, 3)
                                .map((url, idx) => (
                                  <LinkPreview
                                    key={`${message.id}-${idx}`}
                                    url={url.replace(/[.,;!?]+$/, "")}
                                  />
                                ));
                            })()}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Timestamp and Actions */}
                  <div
                    className={`flex items-center gap-2 mt-1 px-1 ${message.sender === "user" ? "justify-end mr-1" : "ml-1"}`}
                  >
                    {/* User Message Actions (hover) */}
                    {message.sender === "user" && (
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(message.text);
                          }}
                          className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          title="Copy message"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-white/40 hover:text-white/80"
                          >
                            <rect
                              x="9"
                              y="9"
                              width="13"
                              height="13"
                              rx="2"
                              ry="2"
                            ></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setInput(message.text);
                            textareaRef.current?.focus();
                          }}
                          className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          title="Edit message"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-white/40 hover:text-white/80"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* AI Message Actions (always visible) */}
                    {message.sender === "ai" && (
                      <div className="flex items-center gap-1.5">
                        {/* Variation Navigation */}
                        {message.variations &&
                          message.variations.length > 1 && (
                            <div className="flex items-center gap-1 mr-2 px-2 py-1 rounded bg-white/5 border border-white/10">
                              <button
                                onClick={() =>
                                  navigateVariation(message, "prev")
                                }
                                disabled={
                                  (message.currentVariationIndex ?? 0) === 0
                                }
                                className="p-0.5 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Previous variation"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="text-white/60"
                                >
                                  <path d="M15 18l-6-6 6-6"></path>
                                </svg>
                              </button>
                              <span className="text-[10px] text-white/40 font-mono min-w-[30px] text-center">
                                {(message.currentVariationIndex ?? 0) + 1}/
                                {message.variations.length}
                              </span>
                              <button
                                onClick={() =>
                                  navigateVariation(message, "next")
                                }
                                disabled={
                                  (message.currentVariationIndex ?? 0) ===
                                  message.variations.length - 1
                                }
                                className="p-0.5 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Next variation"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="text-white/60"
                                >
                                  <path d="M9 18l6-6-6-6"></path>
                                </svg>
                              </button>
                            </div>
                          )}

                        <Tooltip
                          content={
                            copiedId === message.id.toString()
                              ? "Copied!"
                              : "Copy response"
                          }
                        >
                          <button
                            onClick={() => {
                              const textToCopy = message.variations
                                ? message.variations[
                                message.currentVariationIndex ?? 0
                                ]
                                : message.text;
                              handleCopy(textToCopy, message.id.toString());
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={
                                copiedId === message.id.toString()
                                  ? "text-[#B7FC0D]"
                                  : "text-white/40 hover:text-white/80"
                              }
                            >
                              <rect
                                x="9"
                                y="9"
                                width="13"
                                height="13"
                                rx="2"
                                ry="2"
                              ></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                        </Tooltip>

                        <Tooltip content="Like response">
                          <button
                            onClick={() =>
                              handleFeedback(message.id.toString(), "like")
                            }
                            className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill={
                                feedback[message.id.toString()] === "like"
                                  ? "currentColor"
                                  : "none"
                              }
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={
                                feedback[message.id.toString()] === "like"
                                  ? "text-blue-400"
                                  : "text-white/40 hover:text-blue-400"
                              }
                            >
                              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                            </svg>
                          </button>
                        </Tooltip>

                        <Tooltip content="Dislike response">
                          <button
                            onClick={() =>
                              handleFeedback(message.id.toString(), "dislike")
                            }
                            className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill={
                                feedback[message.id.toString()] === "dislike"
                                  ? "currentColor"
                                  : "none"
                              }
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={
                                feedback[message.id.toString()] === "dislike"
                                  ? "text-red-400"
                                  : "text-white/40 hover:text-red-400"
                              }
                            >
                              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                            </svg>
                          </button>
                        </Tooltip>
                        <button
                          onClick={() => {
                            regenerateMessage(message);
                          }}
                          className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          title="Retry"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-white/40 hover:text-white/80"
                          >
                            <path d="M21 2v6h-6"></path>
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                            <path d="M3 22v-6h6"></path>
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                          </svg>
                        </button>
                      </div>
                    )}

                    <span className="text-[10px] text-white/20">
                      {message.timestamp}
                    </span>
                  </div>
                </motion.div>
              ))}

              {/* Streaming Workflow Steps */}
              {workflowSteps.length > 0 && (
                <div className="max-w-[85%] mx-auto w-full">
                  <WorkflowSteps steps={workflowSteps} />
                </div>
              )}

              {/* Streaming Text with Smooth Typewriter Effect */}
              {streamingText && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-start"
                >
                  <div className="w-full md:max-w-[85%] overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 text-white/40 text-xs font-semibold tracking-wider">
                      <img
                        src={getAgentConfig(agentUsed).iconUrl}
                        alt={getAgentConfig(agentUsed).displayName}
                        className="w-4 h-4 rounded-full object-cover"
                      />
                      <span>
                        {getAgentConfig(agentUsed).displayName.toUpperCase()}
                      </span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none break-words">
                      <TypewriterEffect
                        content={streamingText}
                        onOpenArtifact={handleOpenArtifact}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Thinking State */}
              {isProcessingPrompt && !streamingText && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-start w-full"
                >
                  <div className="flex items-center gap-1 px-4 py-3 max-w-[85%]">
                    <div className="relative">
                      <img
                        src={getAgentConfig(selectedAgentId).iconUrl}
                        alt="Agent"
                        className="w-10 h-10 rounded-full object-cover animate-pulse opacity-80"
                      />
                    </div>
                    <span className="text-md text-white/60 font-medium">
                      Thinking...
                    </span>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </AnimatePresence>

        {/* Scroll to Bottom Button */}
      </div>

      {/* Fee Modal - Rendered via Portal at document.body */}
      <AnimatePresence mode="wait">
        {feeModalDetail && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={cancelFee}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#1e1e1e] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center">
                    <Fuel size={20} />
                  </div>
                  <button
                    onClick={cancelFee}
                    className="text-white/40 hover:text-white transition-colors cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-bold text-white mb-2">
                  Signature Required
                </h3>
                <p className="text-white/60 text-sm mb-4">
                  The{" "}
                  <strong>
                    {feeModalDetail.agent === "research_agent"
                      ? "Research"
                      : "Task"}{" "}
                    Agent
                  </strong>{" "}
                  requires your signature to proceed.
                </p>

                <div className="bg-black/40 rounded-lg p-3 mb-6 flex justify-between items-center">
                  <span className="text-sm text-white/50">
                    {feeModalDetail.reason}
                  </span>
                  <span className="text-emerald-400 font-mono font-bold text-lg">
                    {feeModalDetail.cost} SUI
                  </span>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={cancelFee}
                    disabled={isPayingGas}
                    className="flex-1 py-3 text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmFee}
                    disabled={isPayingGas}
                    className="flex-1 py-3 text-sm font-medium text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all font-bold disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isPayingGas ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Signing...
                      </>
                    ) : (
                      "Sign & Approve"
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>

      {/* Upgrade Modal for Task Agent Limit */}
      <AnimatePresence mode="wait">
        {showUpgradeModal && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowUpgradeModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#1e1e1e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center">
                    <Crown size={24} className="text-white" />
                  </div>
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="text-white/40 hover:text-white transition-colors cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-bold text-white mb-2">
                  Upgrade to Premium
                </h3>
                <p className="text-white/60 text-sm mb-4">
                  You need to upgrade to premium to continue chatting. Free tier
                  only gets 2 prompts per day.
                </p>

                {taskPromptStatus && (
                  <div className="bg-black/40 rounded-lg p-4 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle size={16} className="text-yellow-400" />
                      <span className="text-sm text-white/70">
                        Daily Limit Reached
                      </span>
                    </div>
                    <div className="text-white/90 text-sm">
                      You've used{" "}
                      <strong>
                        {taskPromptStatus.used}/{taskPromptStatus.limit}
                      </strong>{" "}
                      task prompts today.
                    </div>
                  </div>
                )}

                <div className="bg-gradient-to-br from-blue-500/20 to-blue-700/20 border border-blue-500/30 rounded-lg p-4 mb-6">
                  <h4 className="text-white font-bold text-sm mb-2">
                    Premium Benefits
                  </h4>
                  <ul className="space-y-2 text-sm text-white/80">
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                      5 daily task prompts (vs 2 free)
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                      Priority agent access
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                      Advanced features & early access
                    </li>
                  </ul>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="flex-1 py-3 text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      navigate("/subscription");
                    }}
                    className="flex-1 py-3 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 rounded-xl transition-all font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Crown size={16} />
                    Upgrade Now
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>

      {/* Unified Input Bar */}
      <div className="w-full flex justify-center items-end p-4 pb-6 sticky bottom-0 z-50">
        <motion.div
          className="group relative max-w-[800px] w-full bg-[##00060A] backdrop-blur-2xl border-[2px] border-white/20 flex items-center md:items-end gap-2 text-white rounded-[35px] transition-all duration-300 px-[16px] pr-2 pt-[3px] pb-[6px] shadow-[0_0_40px_rgba(0,0,0,0.4)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);
              // Command menu logic skipped for brevity as it's not visual
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedAgentId === "task_agent" &&
                taskPromptStatus &&
                taskPromptStatus.remaining <= 0
                ? "Upgrade to premium to continue using task agent..."
                : rateLimitStatus?.isLimited && countdown !== null
                  ? `Rate limit reached. Try again in ${formatCountdown(countdown)}`
                  : "Ask anything..."
            }
            className={`flex-1 min-h-[40px] max-h-[120px] py-2.5 placeholder-white/20 border-0 focus:outline-none resize-none bg-transparent text-[15px] font-medium leading-relaxed overflow-hidden ${rateLimitStatus?.isLimited || (selectedAgentId === "task_agent" && taskPromptStatus && taskPromptStatus.remaining <= 0) ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={
              isLoading ||
              !!rateLimitStatus?.isLimited ||
              (selectedAgentId === "task_agent" &&
                !!taskPromptStatus &&
                taskPromptStatus.remaining <= 0)
            }
          />

          {/* Rate limit indicator */}
          {rateLimitStatus &&
            !rateLimitStatus.isLimited &&
            rateLimitStatus.remaining <= 2 &&
            selectedAgentId !== "task_agent" && (
              <span className="text-xs text-yellow-400/70 absolute -top-6 left-5">
                {rateLimitStatus.remaining} message
                {rateLimitStatus.remaining !== 1 ? "s" : ""} remaining
              </span>
            )}

          {/* Task prompt limit indicator */}
          {selectedAgentId === "task_agent" && taskPromptStatus && (
            <span
              className={`text-xs absolute -top-6 left-5 ${taskPromptStatus.remaining === 0
                ? "text-red-400"
                : taskPromptStatus.remaining <= 1
                  ? "text-yellow-400/70"
                  : "text-white/40"
                }`}
            >
              {taskPromptStatus.remaining === 0
                ? "Upgrade to continue"
                : `${taskPromptStatus.remaining} task prompt${taskPromptStatus.remaining !== 1 ? "s" : ""} remaining`}
            </span>
          )}

          {/* Send Button */}
          <button
            onClick={() =>
              isLoading ? handleStopGeneration() : handleSendMessage()
            }
            className={`${(input.trim() || isLoading) && !rateLimitStatus?.isLimited && !(selectedAgentId === "task_agent" && taskPromptStatus && taskPromptStatus.remaining <= 0) ? "btn-primary" : "btn-ghost"} btn btn-icon hover:bg-white/20`}
            disabled={
              !!rateLimitStatus?.isLimited ||
              (selectedAgentId === "task_agent" &&
                !!taskPromptStatus &&
                taskPromptStatus.remaining <= 0)
            }
          >
            {isLoading ? (
              <Square size={14} fill="white" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </motion.div>
      </div>

      {/* Scroll to Bottom Button - Moved outside scroll container */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={scrollToBottom}
            className="fixed bottom-24 right-6 p-3 bg-[#1d1d1d]/95 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl hover:bg-white/10 transition-colors z-[60] cursor-pointer"
          >
            <ChevronDown
              size={20}
              className="text-white hover:scale-110 transition-transform duration-200"
            />
          </motion.button>
        )}
      </AnimatePresence>
      {/* Artifact Panel */}
      <ArtifactPanel artifact={activeArtifact} onClose={handleCloseArtifact} />

      {/* Recent Chats Modal */}
      <RecentChatsModal
        isOpen={isRecentModalOpen}
        onClose={() => setIsRecentModalOpen(false)}
        chats={chats}
        currentChatId={currentChatId}
        selectedAgentId={selectedAgentId}
        onChatSelect={(chatId) => {
          navigate(`/${chatId}`);
        }}
        onAgentChange={(agentId) => {
          setSelectedAgentId(agentId);
        }}
        onChatDelete={(chatId) => {
          dispatch(deleteChat(chatId));
          // If the deleted chat was the current chat, navigate to home
          if (chatId === currentChatId) {
            navigate("/");
          }
        }}
      />
    </div>
  );
};

// Smooth Typewriter Effect Component
const TypewriterEffect = ({
  content,
  onOpenArtifact
}: {
  content: string;
  onOpenArtifact?: any;
}) => {
  const [displayedLength, setDisplayedLength] = useState(0);
  const contentRef = useRef(content);

  // Keep ref in sync with content prop
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayedLength((current) => {
        if (current < contentRef.current.length) {
          // Type faster if we are far behind
          const diff = contentRef.current.length - current;
          const step = diff > 50 ? 5 : 1;
          return current + step;
        }
        return current;
      });
    }, 15); // 15ms per character

    return () => clearInterval(interval);
  }, []);

  // Jump to end if content effectively resets (new message)
  useEffect(() => {
    if (content.length === 0) setDisplayedLength(0);
  }, [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [
          rehypeHighlight,
          {
            languages: {
              move: moveLanguage,
              sui: moveLanguage,
              javascript,
              typescript,
              python,
              bash,
              json,
              rust,
            },
          },
        ],
        rehypeKatex,
      ]}
      components={MarkdownComponents(onOpenArtifact)}
    >
      {content.slice(0, displayedLength)}
    </ReactMarkdown>
  );
};

export default Dashboard;
