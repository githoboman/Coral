import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { Plus, Fuel, X, Clock, ArrowUp, Terminal, Square, Layout, Wallet, ChevronDown } from 'lucide-react';
import WorkflowSteps from '@/components/WorkflowSteps';
import AgentSelector from '@/components/AgentSelector';
import RecentChatsModal from '@/components/RecentChatsModal';
import ArtifactPanel from '@/components/ArtifactPanel';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";
import { LayoutContextType } from './Layout';

// Define custom Sui Move language for rehype-highlight
const moveLanguage = (hljs: any) => {
  return {
    name: 'Move',
    case_insensitive: false,
    keywords: {
      keyword: 'public native friend entry fun struct use module const script has as mut copy drop store key if else return abort break continue loop while let move',
      literal: 'true false',
      type: 'u8 u16 u32 u64 u128 u256 bool address vector signer UID TxContext Coin Balance Option String',
      built_in: 'transfer public_transfer object new share_object freeze_object delete init mint burn'
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.NUMBER_MODE,
      {
        className: 'title.function',
        begin: /public\s+(entry\s+)?fun\s+/,
        end: /\s*\(/,
        excludeBegin: true,
        excludeEnd: true,
        relevance: 0
      },
      {
        className: 'type',
        begin: /:\s*/,
        end: /\s*(=|;|\)|,)/,
        excludeBegin: true,
        excludeEnd: true,
        keywords: 'u8 u16 u32 u64 u128 u256 bool address vector signer UID TxContext Coin Balance Option String'
      }
    ]
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


import { ModalPortal } from '@/components/ui/ModalPortal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchChats, fetchChatHistory, setCurrentChat, addMessage, setMessages, setActiveArtifact, deleteChat, type Message } from '@/store/slices/chatsSlice';
import { getAgentConfig } from '@/config/agents';
import { getCommandsForAgent, filterCommands, type Command } from '@/config/commands';
import { sendChatMessage } from '@/services/chatService';
import LinkPreview from '@/components/LinkPreview';








// Custom Markdown Components (Gemini Style)
const MarkdownComponents = (handleOpenArtifact: any) => ({
  h1: ({ node, ...props }: any) => <h1 className="text-2xl font-semibold mb-4 mt-6 text-white pb-2" {...props} />,
  h2: ({ node, ...props }: any) => <h2 className="text-lg font-semibold mb-3 mt-5 text-white" {...props} />,
  h3: ({ node, ...props }: any) => <h3 className="text-base font-semibold mb-2 mt-4 text-white/90" {...props} />,
  h4: ({ node, ...props }: any) => <h4 className="text-sm font-semibold mb-2 mt-3 text-white/80" {...props} />,
  p: ({ node, ...props }: any) => <p className="leading-7 mb-4 text-gray-300 last:mb-0 break-words" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="list-disc list-outside ml-5 mb-4 space-y-1 text-gray-300" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="list-decimal list-outside ml-5 mb-4 space-y-1 text-gray-300" {...props} />,
  li: ({ node, ...props }: any) => <li className="pl-1 break-words" {...props} />,
  blockquote: ({ node, ...props }: any) => <blockquote className="border-l-2 border-white/20 pl-4 py-1 my-4 text-gray-400 italic break-words" {...props} />,
  a: ({ node, ...props }: any) => <a className="text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors break-words" target="_blank" rel="noopener noreferrer" {...props} />,
  pre: ({ children }: any) => <>{children}</>,
  code: ({ node, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !String(children).includes('\n')
    return isInline ? (
      <code className="bg-white/10 text-white/90 px-1.5 py-0.5 rounded text-[13px] font-mono border border-white/5 break-all" {...props}>
        {children}
      </code>
    ) : (
      <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 my-4 w-full max-w-full">
        {match && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/5">
            <span className="text-xs text-gray-400 font-medium font-sans">{match[1].charAt(0).toUpperCase() + match[1].slice(1)}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenArtifact(String(children), 'code', match[1])}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
                title="Open as Artifact"
              >
                <Layout size={14} />
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(String(children))}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
                title="Copy code"
              >
                <span className="sr-only">Copy</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto w-full">
          <code className={`${className} block text-sm p-4 font-mono leading-relaxed min-w-0`} {...props}>
            {children}
          </code>
        </div>
      </div>
    )
  },
  table: ({ node, ...props }: any) => <div className="overflow-x-auto my-6 rounded-lg border border-white/10 w-full"><table className="w-full text-left border-collapse bg-white/5" {...props} /></div>,
  th: ({ node, ...props }: any) => <th className="bg-white/10 p-3 font-semibold text-white/90 border-b border-white/10 text-sm whitespace-nowrap" {...props} />,
  td: ({ node, ...props }: any) => <td className="p-3 border-b border-white/5 text-gray-300 text-sm whitespace-nowrap" {...props} />,
  hr: ({ node, ...props }: any) => <hr className="border-white/10 my-8" {...props} />,
  img: ({ node, ...props }: any) => <img className="rounded-lg my-4 max-w-full h-auto border border-white/10" {...props} alt={props.alt || ''} />,
});

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { chatId } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  const { toggleWallet } = useOutletContext<LayoutContextType>();

  // Redux state
  const dispatch = useAppDispatch();
  const chats = useAppSelector(state => state.chats.chats);
  const currentChatId = useAppSelector(state => state.chats.currentChatId);
  const messagesMap = useAppSelector(state => state.chats.messages);
  const activeArtifact = useAppSelector(state => state.chats.activeArtifact);

  // Local state
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isProcessingPrompt, setIsProcessingPrompt] = useState(false);
  const [isEditing, setIsEditing] = useState(false);


  const [streamingText, setStreamingText] = useState('');
  const [agentUsed, setAgentUsed] = useState<string>('');
  const [tempMessages, setTempMessages] = useState<Message[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('main');
  const [feeModalDetail, setFeeModalDetail] = useState<{ agent: string; cost: number; reason: string } | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [isPayingGas, setIsPayingGas] = useState(false);
  const [isRecentModalOpen, setIsRecentModalOpen] = useState(false);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);

  // Get messages for current chat (include temp messages if no chat ID)
  const messages = currentChatId ? (messagesMap[currentChatId] || []) : tempMessages;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const user_id = currentAccount?.address || '';
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Regenerate the last AI message without resending user message
  const regenerateMessage = async (messageToRegenerate: Message) => {
    if (isLoading || !user_id) return;

    // Find the user message that prompted this AI response
    const messageIndex = messages.findIndex(m => m.id === messageToRegenerate.id);
    const userMessage = messages.slice(0, messageIndex).reverse().find(m => m.sender === 'user');

    if (!userMessage) return;

    setIsLoading(true);
    setIsProcessingPrompt(true);

    try {
      const response = await sendChatMessage({
        user_id,
        message: userMessage.text,
        chat_id: currentChatId || chatId,
        agent_id: selectedAgentId !== 'main' ? selectedAgentId : undefined,
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
        const updatedMessages = messages.map(m =>
          m.id === messageToRegenerate.id ? updatedMessage : m
        );
        dispatch(setMessages({ chatId: currentChatId, messages: updatedMessages }));
      } else {
        setTempMessages(prev =>
          prev.map(m => m.id === messageToRegenerate.id ? updatedMessage : m)
        );
      }

      setIsLoading(false);
      setWorkflowSteps([]);
    } catch (error) {
      console.error('Error regenerating message:', error);
      setIsLoading(false);
      setIsProcessingPrompt(false);
    }
  };

  // Navigate between message variations
  const navigateVariation = (message: Message, direction: 'prev' | 'next') => {
    if (!message.variations) return;

    const currentIndex = message.currentVariationIndex ?? 0;
    const newIndex = direction === 'next'
      ? Math.min(currentIndex + 1, message.variations.length - 1)
      : Math.max(currentIndex - 1, 0);

    const updatedMessage: Message = {
      ...message,
      currentVariationIndex: newIndex,
    };

    if (currentChatId) {
      const updatedMessages = messages.map(m =>
        m.id === message.id ? updatedMessage : m
      );
      dispatch(setMessages({ chatId: currentChatId, messages: updatedMessages }));
    } else {
      setTempMessages(prev =>
        prev.map(m => m.id === message.id ? updatedMessage : m)
      );
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, workflowSteps]);

  useEffect(() => {
    dispatch(setCurrentChat(chatId || null));
  }, [chatId, dispatch]);

  // Fetch chats from Redux
  useEffect(() => {
    if (!user_id) return;
    dispatch(fetchChats(user_id));
  }, [user_id, dispatch]);

  // Fetch chat history from Redux
  useEffect(() => {
    if (!currentChatId || user_id === undefined) {
      return;
    }
    setIsHistoryLoading(true);
    dispatch(fetchChatHistory(currentChatId)).finally(() => {
      setIsHistoryLoading(false);
    });
  }, [currentChatId, user_id, dispatch]);

  // URL Params for Agent Selection
  const urlParams = new URLSearchParams(window.location.search);
  const agentParam = urlParams.get('agent');

  useEffect(() => {
    if (agentParam) {
      // Map param to AgentType values
      const idMap: { [key: string]: string } = {
        'research-1': 'research_agent',
        'task-1': 'task_agent',
        'alert-1': 'alert_agent'
      };
      const mappedId = idMap[agentParam] || agentParam;
      setSelectedAgentId(mappedId);
      window.history.replaceState({}, '', '/?agent=' + agentParam);
    }
  }, [agentParam]);

  const handleSendMessage = async (text?: string) => {
    const query = text || input;
    if (!query.trim() || isLoading) return;

    // Check if user is authenticated
    if (!user_id) {
      console.error('User not authenticated');
      return;
    }

    // Handle command execution
    if (query.trim().startsWith('/')) {
      handleCommand(query.trim());
      return;
    }

    const userMessage: Message = {
      id: Date.now() + Math.random(),
      text: query,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
      chat_id: chatId || currentChatId || undefined,
    };

    setInput('');
    setIsEditing(false);
    setIsLoading(true);

    // Initial message addition (to temp or current chat)
    if (currentChatId) {
      dispatch(addMessage({ chatId: currentChatId, message: userMessage }));
    } else {
      setTempMessages(prev => [...prev, userMessage]);
    }

    try {
      // Show processing state
      setIsProcessingPrompt(true);

      // Get last 5 messages for history context
      const history = messages
        .slice(-5)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
          content: msg.sender === 'ai' && msg.variations
            ? msg.variations[msg.currentVariationIndex ?? 0]
            : msg.text
        }));

      // Call real API
      const response = await sendChatMessage({
        user_id,
        message: query,
        chat_id: currentChatId || chatId,
        agent_id: selectedAgentId !== 'main' ? selectedAgentId : undefined,
        history,
      });

      setIsProcessingPrompt(false);
      setAgentUsed(response.agent_used);

      // Check if fee is required (research agent needs gas)
      // IMPORTANT: Check this BEFORE adding any messages or updating chat
      if (response.requires_fee && response.estimated_cost) {
        setIsLoading(false);
        setPendingQuery(query);
        setFeeModalDetail({
          agent: response.agent_used,
          cost: response.estimated_cost,
          reason: 'Deep research and analysis'
        });
        return; // Stop here and wait for user to sign - don't add any messages
      }

      // Handle workflow steps if present (for research agent)
      if (response.workflow_steps && response.workflow_steps.length > 0) {
        setWorkflowSteps(response.workflow_steps);
      }

      // Handle routing to chat if new
      let activeChatId = response.chat_id;
      if (!currentChatId && !chatId) {
        // New chat created by backend
        dispatch(setCurrentChat(activeChatId));

        // Migrate temp messages to Redux
        const allMessages = [...tempMessages, userMessage];
        allMessages.forEach(msg => {
          dispatch(addMessage({ chatId: activeChatId!, message: { ...msg, chat_id: activeChatId } }));
        });

        // Small delay to ensure state update before clearing temp
        setTimeout(() => setTempMessages([]), 50);
        navigate(`/${activeChatId}`);
      }

      // Add AI response to messages
      const aiMessage: Message = {
        id: Date.now() + Math.random(),
        text: response.response,
        sender: 'ai',
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
    } catch (error: any) {
      console.error('Error sending message:', error);
      setIsLoading(false);
      setIsProcessingPrompt(false);

      // Determine error message
      let errorText = 'Sorry, I encountered an error. Please try again.';

      // Handle rate limit error
      if (error.response?.status === 429) {
        const data = error.response.data;
        errorText = `⏱️ **Rate Limit Reached**\n\n${data.message}\n\nYou can send ${data.limit} messages every 6 hours.`;
      }

      // Show error message
      const errorMessage: Message = {
        id: Date.now() + Math.random(),
        text: errorText,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString(),
      };

      if (currentChatId) {
        dispatch(addMessage({ chatId: currentChatId, message: errorMessage }));
      } else {
        setTempMessages(prev => [...prev, errorMessage]);
      }
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setStreamingText('');
      setIsProcessingPrompt(false);
    }
  };

  const handleCommand = (command: string) => {
    const cmd = command.toLowerCase();

    if (cmd === '/clear') {
      // Clear chat logic
      console.log('Clear chat');
    } else if (cmd === '/new') {
      startNewChat();
    } else if (cmd === '/help') {
      // Show help
      console.log('Show help');
    }

    setInput('');
    setShowCommandMenu(false);
  };

  const confirmFee = async () => {
    if (!pendingQuery || !feeModalDetail || !currentAccount?.address) {
      console.error('Missing required data for signature');
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

      console.log('Message signed successfully:', signature);

      // Clear fee modal
      setFeeModalDetail(null);
      setIsPayingGas(false);

      // Resend chat request with signature
      try {
        setIsLoading(true);
        setIsProcessingPrompt(true);

        const history = messages
          .slice(-5)
          .map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
            content: msg.sender === 'ai' && msg.variations
              ? msg.variations[msg.currentVariationIndex ?? 0]
              : msg.text
          }));

        const response = await sendChatMessage({
          user_id: currentAccount.address,
          message: pendingQuery,
          chat_id: currentChatId || chatId,
          agent_id: selectedAgentId !== 'main' ? selectedAgentId : undefined,
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
          allMessages.forEach(msg => {
            dispatch(addMessage({ chatId: activeChatId!, message: { ...msg, chat_id: activeChatId } }));
          });
          setTempMessages([]);
          navigate(`/${activeChatId}`);
        }

        const aiMessage: Message = {
          id: Date.now() + Math.random(),
          text: response.response,
          sender: 'ai',
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
        console.error('Error executing research after signing:', error);
        setIsLoading(false);
        setIsProcessingPrompt(false);
      }
    } catch (error: any) {
      console.error('Message signing failed:', error);
      setIsPayingGas(false);
      alert('Signing failed: ' + error.message);
    }
  };

  const cancelFee = () => {
    console.log('Fee cancelled');
    setFeeModalDetail(null);
    setPendingQuery(null);
    setIsPayingGas(false);
  };

  const handleCloseArtifact = () => {
    dispatch(setActiveArtifact(null));
  };

  const handleOpenArtifact = (content: string, type: 'code' | 'markdown' | 'react', title?: string) => {
    dispatch(setActiveArtifact({
      id: Date.now().toString(),
      type,
      title: title || 'Artifact',
      content,
      isOpen: true,
      language: title
    }));
  };

  const startNewChat = () => {
    setInput('');

    // Navigate to home (no chat ID)
    navigate('/');

    // Clear current chat in Redux
    dispatch(setCurrentChat(null));
  };

  const handleSuggestionClick = (title: string) => {
    handleSendMessage(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const selectedCmd = filteredCommands[selectedCommandIndex];
        setInput(selectedCmd.label + ' ');
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
        return;
      }
    }

    // Regular send on Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };



  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  // Close command menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showCommandMenu && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setShowCommandMenu(false);
        setSelectedCommandIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCommandMenu]);

  if (isHistoryLoading && messages.length === 0) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <div className="flex flex-col justify-between min-h-[100dvh] w-full max-w-4xl mx-auto">
      <div>
        <div className="sticky md:fixed top-0 p-4 w-full flex items-center justify-end md:justify-start gap-3 mb-2 z-50">
          {/* Agent Selector */}
          <AgentSelector
            selectedAgentId={selectedAgentId}
            onAgentChange={(agentId) => {
              setSelectedAgentId(agentId);
            }}
          />

          {/* Recent Chats Icon - Always visible */}
          <button
            onClick={() => setIsRecentModalOpen(true)}
            className="bg-white/10 hover:bg-white/15 text-white/80 p-4 rounded-full border border-white/10 transition-all duration-200 cursor-pointer flex items-center gap-2"
            title="Recent Chats"
          >
            <Clock size={16} />
            {currentChatId && chats.find(c => c.chat_id === currentChatId) && (
              <span className="hidden md:block text-sm font-medium truncate max-w-[150px]">
                {chats.find(c => c.chat_id === currentChatId)?.name}
              </span>
            )}
          </button>

          {/* New Chat Button */}
          {chatId && (
            <button
              onClick={startNewChat}
              className="bg-white/10 hover:bg-white/15 text-white/80 p-4 rounded-full border border-white/10 transition-all duration-200 cursor-pointer"
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
          const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
          setShowScrollButton(!isNearBottom);
        }}
        className="flex-1 overflow-y-auto pt-16 px-4 pb-4 custom-scrollbar relative"
      >
        <AnimatePresence mode="popLayout">
          {messages.length === 0 && !isLoading && !isProcessingPrompt && !streamingText ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center"
            >
              <div className="w-20 h-20 mb-6 rounded-3xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 shadow-2xl">
                <span className="text-4xl">{getAgentConfig(selectedAgentId).icon}</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-3">
                {getAgentConfig(selectedAgentId).displayName}
              </h2>
              <p className="text-white/60 text-lg max-w-md mb-8 leading-relaxed">
                {getAgentConfig(selectedAgentId).description}
              </p>
              <div className="flex flex-wrap justify-center gap-3 max-w-2xl px-4">
                {getAgentConfig(selectedAgentId).suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="px-5 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-all duration-200 text-sm font-medium hover:scale-105 active:scale-95 shadow-lg"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-8 max-w-3xl mx-auto py-8">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${message.sender === 'user' ? 'items-end' : 'items-start'} group`}
                >
                  <div className={`md:max-w-[85%] overflow-hidden ${message.sender === 'user' ? 'bg-gradient-to-r from-emerald-600 to-emerald-800 text-white rounded-[24px] rounded-tr-none px-5 py-3.5 shadow-xl md:w-auto md:ml-auto w-fit' : ''}`}>
                    {message.sender === 'ai' && (
                      <div className="flex items-center gap-2 mb-2 text-white/40 text-xs font-semibold tracking-wider">
                        <img
                          src={getAgentConfig(message.agentId || 'main').iconUrl}
                          alt={getAgentConfig(message.agentId || 'main').displayName}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                        <span>{message.agentType?.toUpperCase() || 'TOVIRA'}</span>
                      </div>
                    )}
                    <div className="w-full text-gray-200 break-words">
                      {message.sender === 'user' ? (
                        <p className="text-[15px] break-all leading-relaxed m-0">{message.text}</p>
                      ) : (
                        <>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[[rehypeHighlight, {
                              languages: {
                                move: moveLanguage,
                                sui: moveLanguage,
                                javascript,
                                typescript,
                                python,
                                bash,
                                json,
                                rust
                              }
                            }], rehypeKatex]}
                            components={MarkdownComponents(handleOpenArtifact)}
                          >
                            {(() => {
                              const messageText = String(message.variations
                                ? message.variations[message.currentVariationIndex ?? 0]
                                : message.text || '');

                              // Extract URLs that will have preview cards
                              const urlRegex = /(https?:\/\/[^\s\)]+)/g;
                              const urls = messageText.match(urlRegex) || [];
                              const previewUrls = urls.slice(0, 3).map(url => url.replace(/[.,;!?]+$/, ''));

                              // Remove preview URLs and their markdown links from the message text
                              let cleanedText = messageText;
                              previewUrls.forEach(url => {
                                // Remove entire markdown list item line: - [Title](URL) or * [Title](URL)
                                const listItemRegex = new RegExp(`^[\\s]*[-*]\\s*\\[([^\\]]+)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`, 'gm');
                                cleanedText = cleanedText.replace(listItemRegex, '');
                                // Remove markdown link format: [Title](URL)
                                const markdownLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
                                cleanedText = cleanedText.replace(markdownLinkRegex, '');
                                // Also remove standalone URL
                                cleanedText = cleanedText.replace(url, '');
                              });

                              return cleanedText;
                            })()}
                          </ReactMarkdown>
                          {message.sender === 'ai' && (() => {
                            const messageText = String(message.variations
                              ? message.variations[message.currentVariationIndex ?? 0]
                              : message.text || '');
                            const urlRegex = /(https?:\/\/[^\s\)]+)/g;
                            const urls = messageText.match(urlRegex) || [];
                            return urls.slice(0, 3).map((url, idx) => (
                              <LinkPreview key={`${message.id}-${idx}`} url={url.replace(/[.,;!?]+$/, '')} />
                            ));
                          })()}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Timestamp and Actions */}
                  <div className={`flex items-center gap-2 mt-1 px-1 ${message.sender === 'user' ? 'justify-end mr-1' : 'ml-1'}`}>
                    {/* User Message Actions (hover) */}
                    {
                      message.sender === 'user' && (
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(message.text);
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Copy message"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white/80">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setInput(message.text);
                              setIsEditing(true);
                              textareaRef.current?.focus();
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Edit message"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white/80">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                        </div>
                      )
                    }

                    {/* AI Message Actions (always visible) */}
                    {
                      message.sender === 'ai' && (
                        <div className="flex items-center gap-1.5">
                          {/* Variation Navigation */}
                          {message.variations && message.variations.length > 1 && (
                            <div className="flex items-center gap-1 mr-2 px-2 py-1 rounded bg-white/5 border border-white/10">
                              <button
                                onClick={() => navigateVariation(message, 'prev')}
                                disabled={(message.currentVariationIndex ?? 0) === 0}
                                className="p-0.5 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Previous variation"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
                                  <path d="M15 18l-6-6 6-6"></path>
                                </svg>
                              </button>
                              <span className="text-[10px] text-white/40 font-mono min-w-[30px] text-center">
                                {(message.currentVariationIndex ?? 0) + 1}/{message.variations.length}
                              </span>
                              <button
                                onClick={() => navigateVariation(message, 'next')}
                                disabled={(message.currentVariationIndex ?? 0) === message.variations.length - 1}
                                className="p-0.5 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Next variation"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
                                  <path d="M9 18l6-6-6-6"></path>
                                </svg>
                              </button>
                            </div>
                          )}

                          <button
                            onClick={() => {
                              const textToCopy = message.variations
                                ? message.variations[message.currentVariationIndex ?? 0]
                                : message.text;
                              navigator.clipboard.writeText(textToCopy);
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Copy response"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white/80">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              console.log('Liked message:', message.id);
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Like response"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-blue-400">
                              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              console.log('Disliked message:', message.id);
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Dislike response"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-red-400">
                              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              regenerateMessage(message);
                            }}
                            className="p-1 rounded hover:bg-white/10 transition-colors"
                            title="Retry"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 hover:text-white/80">
                              <path d="M21 2v6h-6"></path>
                              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                              <path d="M3 22v-6h6"></path>
                              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                            </svg>
                          </button>
                        </div>
                      )
                    }

                    < span className="text-[10px] text-white/20" >
                      {message.timestamp}
                    </span>
                  </div>

                </motion.div >
              ))}

              {/* Streaming Workflow Steps */}
              {
                workflowSteps.length > 0 && (
                  <div className="max-w-[85%] mx-auto w-full">
                    <WorkflowSteps steps={workflowSteps} />
                  </div>
                )
              }

              {/* Streaming Text */}
              {
                streamingText && (
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
                        <span>{getAgentConfig(agentUsed).displayName.toUpperCase()}</span>
                      </div>
                      <div className="prose prose-invert prose-sm max-w-none break-words">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[[rehypeHighlight, {
                            languages: {
                              move: moveLanguage,
                              sui: moveLanguage,
                              javascript,
                              typescript,
                              python,
                              bash,
                              json,
                              rust
                            }
                          }], rehypeKatex]}
                          components={MarkdownComponents(handleOpenArtifact)}
                        >
                          {streamingText}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                )
              }

              {/* Thinking State */}
              {
                isProcessingPrompt && !streamingText && (
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
                      <span className="text-md text-white/60 font-medium">Thinking...</span>
                    </div>
                  </motion.div>
                )
              }
              <div ref={messagesEndRef} />
            </div >
          )}
        </AnimatePresence >

        {/* Scroll to Bottom Button */}

      </div >

      {/* Fee Modal - Rendered via Portal at document.body */}
      < AnimatePresence mode="wait" >
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
                  <button onClick={cancelFee} className="text-white/40 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-bold text-white mb-2">Signature Required</h3>
                <p className="text-white/60 text-sm mb-4">
                  The <strong>{feeModalDetail.agent === 'research_agent' ? 'Research' : 'Task'} Agent</strong> requires your signature to proceed.
                </p>

                <div className="bg-black/40 rounded-lg p-3 mb-6 flex justify-between items-center">
                  <span className="text-sm text-white/50">{feeModalDetail.reason}</span>
                  <span className="text-emerald-400 font-mono font-bold text-lg">
                    {feeModalDetail.cost} SUI
                  </span>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={cancelFee}
                    disabled={isPayingGas}
                    className="flex-1 py-3 text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmFee}
                    disabled={isPayingGas}
                    className="flex-1 py-3 text-sm font-medium text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all font-bold disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isPayingGas ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Signing...
                      </>
                    ) : (
                      'Sign & Approve'
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence >

      {/* Input */}
      <div className={`w-full flex justify-center items-end p-4 sticky bottom-0 gap-2`}>
        <motion.div
          className="group relative max-w-3xl flex-1 bg-[#1d1d1d]/95 backdrop-blur-xl border border-white/20 flex flex-col gap-2 text-white rounded-[30px] transition-all duration-200 p-4 shadow-2xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Editing Mode Indicator */}
          {isEditing && (
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10 rounded-t-[30px] -mt-4 -mx-4 mb-2">
              <span className="text-xs font-medium text-emerald-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Editing Message
              </span>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setInput('');
                }}
                className="text-xs text-white/40 hover:text-white transition-colors flex items-center gap-1 bg-white/5 px-2 py-1 rounded-full hover:bg-white/10"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);

              // Show command menu if input starts with /
              if (value.startsWith('/')) {
                const commands = getCommandsForAgent(selectedAgentId);
                const filtered = filterCommands(commands, value);
                setFilteredCommands(filtered);
                setShowCommandMenu(true);
                setSelectedCommandIndex(0); // Reset selection when filtering
              } else {
                setShowCommandMenu(false);
              }

              // Auto-resize
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={getAgentConfig(selectedAgentId).placeholder}
            className={`w-full min-h-[20px] max-h-[120px] placeholder-white/40 border-0 focus:outline-none resize-none overflow-y-auto bg-transparent transition-colors ${!input.trim() && 'pl-10'} transition-all duration-800 ${input.length > 500 ? 'text-red-400' : 'text-white'
              }`}
            maxLength={500}
            disabled={isLoading}
          />
          {/* Command Menu Popup */}
          <AnimatePresence>
            {showCommandMenu && filteredCommands.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-0 mb-2 w-64 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
              >
                {filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.id}
                    onClick={() => {
                      setInput(cmd.label + ' ');
                      setShowCommandMenu(false);
                      setSelectedCommandIndex(0);
                      textareaRef.current?.focus();
                    }}
                    className={`w-full px-3 py-2 flex items-center transition-colors text-left ${index === selectedCommandIndex
                      ? 'bg-white/10'
                      : 'hover:bg-white/5'
                      }`}
                  >
                    <div className="flex-1">
                      <div className="text-white font-medium text-sm">{cmd.label}</div>
                      <div className="text-white/40 text-xs">{cmd.description}</div>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Bar */}
          <div className={`${!input.trim() && 'absolute bottom-0 top-0 pr-6 -z-1'} w-full flex items-center justify-between transition-all duration-800`}>
            {/* Command Button */}
            <button
              onClick={() => {
                const commands = getCommandsForAgent(selectedAgentId);
                setFilteredCommands(commands);
                setShowCommandMenu(!showCommandMenu);
              }}
              title="Commands"
            >
              <Terminal size={18} className="text-white/60" />
            </button>

            {/* Send or Stop Button */}
            {(input.trim() || isLoading || !!streamingText) && (
              <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                onClick={() => (isLoading || !!streamingText) ? handleStopGeneration() : handleSendMessage()}
                className="rounded-full w-10 h-10 flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg"
                style={{
                  background: (isLoading || !!streamingText) ? 'white' : getAgentConfig(selectedAgentId).gradient,
                }}
                disabled={input.length > 500 && !isLoading && !streamingText}
              >
                {(isLoading || !!streamingText) ? (
                  <Square size={16} fill="black" className="text-black" />
                ) : (
                  <ArrowUp size={20} className="text-white" strokeWidth={2.5} />
                )}
              </motion.button>
            )}

            {/* Error indicator when over limit */}
            {input.length > 500 && (
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <span className="font-medium">{input.length - 500} characters over limit</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Mobile Wallet Button (Outside bubble) */}
        <button
          onClick={toggleWallet}
          className="md:hidden flex-shrink-0 w-12 h-12 bg-[#1d1d1d]/95 backdrop-blur-xl border border-white/20 rounded-full flex items-center justify-center shadow-2xl active:scale-95 transition-transform mb-1"
        >
          <Wallet size={20} className="text-[#00FF88]" />
        </button>

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
              <ChevronDown size={20} className="text-white hover:scale-110 transition-transform duration-200" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Artifact Panel */}
      <ArtifactPanel
        artifact={activeArtifact}
        onClose={handleCloseArtifact}
      />

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
            navigate('/');
          }
        }}
      />
    </div>
  );
};

export default Dashboard;