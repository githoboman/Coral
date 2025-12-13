import { useAuth } from '@/hooks/useAuth';
import { Send, Trash2, Plus, MoreVertical, Brain, Fuel, X } from 'lucide-react';
import WorkflowSteps from '@/components/WorkflowSteps';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Dropdown from '@/components/ui/dropdown';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchChats, fetchChatHistory, setCurrentChat, addMessage, updateChat, deleteChat as deleteReduxChat } from '@/store/slices/chatsSlice';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  chat_id?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  agentType?: string;
  originalQuery?: string;
  gasFee?: string;
}

interface Chat {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
}

const chatSuggestions = [
  { title: 'Research a token on Sui', description: 'Dive into token details and performance on the Sui blockchain.' },
  { title: 'Analyze SUI price trends', description: 'Get insights on SUI token price movements and market sentiment.' },
  { title: 'Find top Sui DeFi protocols', description: 'Discover the leading DeFi applications on Sui network.' },
  { title: 'Explain Sui Move language', description: 'Learn about the Move programming language used on Sui.' },
];

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const Dashboard = () => {
  const { address } = useAuth();
  const { chatId } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();

  // Redux state
  const dispatch = useAppDispatch();
  const chats = useAppSelector(state => state.chats.chats);
  const currentChatId = useAppSelector(state => state.chats.currentChatId);
  const messagesMap = useAppSelector(state => state.chats.messages);

  // Local state
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingPrompt, setIsProcessingPrompt] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [chatName, setChatName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [agentUsed, setAgentUsed] = useState<string>('');
  const [tempMessages, setTempMessages] = useState<Message[]>([]);

  // Get messages for current chat (include temp messages if no chat ID)
  const messages = currentChatId ? (messagesMap[currentChatId] || []) : tempMessages;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const user_id = address;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

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
    if (!currentChatId) {
      return;
    }
    setIsLoading(true);
    dispatch(fetchChatHistory(currentChatId)).finally(() => {
      setIsLoading(false);
    });
  }, [currentChatId, dispatch]);

  // --- Multi-Agent State ---
  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);
  const [feeModalDetail, setFeeModalDetail] = useState<{ cost: number, agent: string, reason: string } | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // URL Params for Agent Selection
  const urlParams = new URLSearchParams(window.location.search);
  const agentParam = urlParams.get('agent');

  // Debug logging
  useEffect(() => {
    console.log('Fee Modal State:', feeModalDetail);
    console.log('Pending Query:', pendingQuery);
    console.log('Temp Messages:', tempMessages);
  }, [feeModalDetail, pendingQuery, tempMessages]);

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
      setAgentUsed(mappedId === 'research_agent' ? 'Research Agent' : 'Task Agent');

      window.history.replaceState({}, '', '/?agent=' + agentParam);
    }
  }, [agentParam]);

  const handleSendMessage = async (query: string, bypassRouter = false, skipUserMessage = false) => {
    // Strict validation for empty queries
    if (!query || !query.trim()) {
      console.warn('Empty query detected, aborting send');
      return;
    }

    const trimmedQuery = query.trim();

    // 1. Optimistic UI - Skip if message already added (e.g., during fee confirmation)
    if (!skipUserMessage) {
      const userMsg: Message = {
        id: Date.now(),
        text: trimmedQuery,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString(),
        chat_id: currentChatId || undefined,
      };

      // Always show user message immediately
      if (currentChatId) {
        dispatch(addMessage({ chatId: currentChatId, message: userMsg }));
      } else {
        // Store in temp state if no chat ID yet
        setTempMessages(prev => [...prev, userMsg]);
      }
    }

    setInput('');
    setIsProcessingPrompt(true);
    setStreamingText('');
    setWorkflowSteps([]);

    try {
      // 2. Router Check (Skip if confirming fee)
      let targetAgent = 'main';

      if (!bypassRouter) {
        console.log('Sending to router:', { query: trimmedQuery, user_id, agent_id: selectedAgentId });
        const routerRes = await fetch(`${apiBaseUrl}/api/chat/router`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmedQuery,
            user_id,
            agent_id: selectedAgentId
          })
        });

        if (routerRes.ok) {
          const routerData = await routerRes.json();
          console.log("Router Decision:", routerData);

          // Validate router response
          if (!routerData || !routerData.target_agent) {
            console.error('Invalid router response:', routerData);
            throw new Error('Router returned invalid response');
          }

          if (routerData.requires_fee) {
            // STOP: Show Fee Modal
            console.log('Showing fee modal for query:', trimmedQuery);
            setFeeModalDetail({
              cost: routerData.estimated_cost,
              agent: routerData.target_agent,
              reason: routerData.reason || "Advanced operation"
            });
            setPendingQuery(trimmedQuery);
            setIsProcessingPrompt(false);
            return; // Wait for user confirmation
          }
          targetAgent = routerData.target_agent;
        } else {
          // Router failed, log the error
          const errorText = await routerRes.text();
          console.error('Router request failed:', routerRes.status, errorText);
          throw new Error(`Router failed: ${routerRes.status}`);
        }
      } else {
        // If bypassing, we assume we want to run the expensive agent
        targetAgent = feeModalDetail?.agent || 'research_agent';
      }

      // 3. Execution (Streaming)
      const res = await fetch(`${apiBaseUrl}/api/chat/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmedQuery,
          user_id,
          chat_id: currentChatId,
          agent_type: targetAgent, // Router determined agent
          mock_payment: bypassRouter // If we bypassed, we "paid"
        }),
      });

      if (!res.ok) throw new Error('Stream failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No stream');

      let newChatId = currentChatId;
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.substring(6));

            if (data.type === 'chat_id') {
              // Backend created a new chat, update our state
              newChatId = data.chat_id;

              // Only proceed if we have a valid chat ID
              if (newChatId) {
                // Migrate temp messages to Redux
                if (tempMessages.length > 0) {
                  tempMessages.forEach(msg => {
                    dispatch(addMessage({ chatId: newChatId as string, message: { ...msg, chat_id: newChatId as string } }));
                  });
                  setTempMessages([]);
                }

                // Update current chat and navigate
                dispatch(setCurrentChat(newChatId));
                navigate(`/${newChatId}`);

                // Fetch updated chats list
                if (user_id) {
                  dispatch(fetchChats(user_id));
                }
              }
            }
            else if (data.type === 'step_start') {
              setWorkflowSteps(prev => [...prev, { id: Date.now(), message: data.step, status: 'running' }]);
            }
            else if (data.type === 'step_complete') {
              setWorkflowSteps(prev => prev.map(s =>
                s.message === data.step.replace('Finished ', 'Running ') ? { ...s, status: 'completed' } : s
              ));
            }
            else if (data.type === 'payload') {
              // Task Saved Notification
              // Ideally show a nice Toast or Embed Card
              fullResponse += `\n\n> [!SUCCESS] ${data.data.status === 'saved_pending_confirmation' ? 'Saved to Activity' : 'Action Ready'} \n> Action: ${data.data.action_type}`;
            }
            else if (data.type === 'response') {
              fullResponse += data.content;
              setStreamingText(fullResponse);
            }
            else if (data.type === 'done') {
              // Finalize
            }
          } catch (e) {
            // ignore partial JSON
          }
        }
      }

      // Final Message Commit
      const aiMsg: Message = {
        id: Date.now() + 1,
        text: fullResponse,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString(),
        chat_id: newChatId || undefined,
      };
      if (newChatId) {
        dispatch(addMessage({ chatId: newChatId, message: aiMsg }));
      }
      setStreamingText('');
      setWorkflowSteps([]); // Clear steps after done? Or keep them? Let's clear for now.

    } catch (err) {
      console.error(err);
      const errorMsg: Message = {
        id: Date.now(),
        text: 'Error: ' + (err as Error).message,
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString(),
      };
      if (currentChatId) {
        dispatch(addMessage({ chatId: currentChatId, message: errorMsg }));
      }
    } finally {
      setIsProcessingPrompt(false);
    }
  };

  const confirmFee = () => {
    console.log('Fee confirmed, executing query:', pendingQuery);
    if (pendingQuery) {
      const queryToExecute = pendingQuery;
      // Clear modal state before executing
      setFeeModalDetail(null);
      setPendingQuery(null);
      // Skip adding user message again since it was already added before the fee modal
      handleSendMessage(queryToExecute, true, true);
    }
  };

  const cancelFee = () => {
    console.log('Fee cancelled, clearing temp messages');
    setFeeModalDetail(null);
    setPendingQuery(null);
    setTempMessages([]);
  };

  const startNewChat = () => {
    dispatch(setCurrentChat(null));
    navigate('/');
    setInput('');
    setIsDropdownOpen(false);
  };

  const handleSuggestionClick = (title: string) => {
    setInput(title);
    handleSendMessage(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  const handleEditName = (chat: Chat) => {
    setEditingChatId(chat.chat_id);
    setChatName(chat.name);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleNameChange = async (chatId: string) => {
    if (!chatName.trim()) return;
    try {
      await fetch(`${apiBaseUrl}/api/chat/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chatName }),
      });
      // Update Redux store
      dispatch(updateChat({ chatId, updates: { name: chatName } }));
    } catch (e) { console.error(e); } finally {
      setEditingChatId(null);
      setChatMenuOpen(null);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/chat/${chatId}`, { method: 'DELETE' });
      // Update Redux store
      dispatch(deleteReduxChat(chatId));
      if (chatId === currentChatId) {
        navigate('/');
      }
    } catch (e) { console.error(e); } finally {
      setChatMenuOpen(null);
    }
  };

  const filteredChats = chats.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const chatItems = filteredChats.map(chat => ({
    id: chat.chat_id,
    label: chat.name,
    subLabel: new Date(chat.last_updated).toLocaleDateString(),
    onClick: () => {
      dispatch(setCurrentChat(chat.chat_id));
      navigate(`/${chat.chat_id}`);
      setIsDropdownOpen(false);
    },
    isActive: chat.chat_id === currentChatId,
    customContent: editingChatId === chat.chat_id ? (
      <input
        ref={nameInputRef}
        value={chatName}
        onChange={e => setChatName(e.target.value)}
        onBlur={() => handleNameChange(chat.chat_id)}
        onKeyDown={e => e.key === 'Enter' && handleNameChange(chat.chat_id)}
        className="bg-transparent border border-white/10 text-white px-2 py-1 rounded text-sm flex-1"
        placeholder="Chat name"
        maxLength={50}
      />
    ) : null,
    nestedDropdown: {
      items: [
        { label: 'Edit Name', onClick: () => handleEditName(chat), icon: <MoreVertical size={14} /> },
        { label: 'Delete', onClick: () => handleDeleteChat(chat.chat_id), icon: <Trash2 size={14} className="text-red-400" /> },
      ],
    },
  }));

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  if (!isProcessingPrompt && isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <div className="flex flex-col justify-between min-h-[100dvh] w-full max-w-4xl mx-auto">
      <div>
        <div className="sticky top-0 py-4 w-full flex items-center gap-3 mb-2 z-[100]">
          <Dropdown
            triggerLabel={currentChatId ? chats.find(c => c.chat_id === currentChatId)?.name || 'Untitled' : 'Select Chat'}
            isOpen={isDropdownOpen}
            setIsOpen={setIsDropdownOpen}
            items={chatItems}
            width="w-80"
            maxHeight="max-h-64"
            nestedOpenId={chatMenuOpen}
            setNestedOpenId={setChatMenuOpen}
            searchValue={searchQuery}
            setSearchValue={setSearchQuery}
            searchPlaceholder="Search chats..."
          />
          {chatId && (
            <>
              <button
                onClick={startNewChat}
                className="bg-[#2d2d2d] hover:bg-white/20 text-white/80 p-3 rounded-[25px] border border-white/10 transition-all duration-200 cursor-pointer"
              >
                <Plus size={16} />
              </button>
            </>
          )}
        </div>

        <div className="w-full p-4 sm:px-6 lg:px-8 h-full flex flex-col">
          <AnimatePresence>
            {messages.length === 0 && !currentChatId && !isLoading && (
              <motion.div
                key="welcome-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col justify-end items-center"
              >

                {selectedAgentId && (
                  <div className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-full flex items-center gap-2 mb-6 animate-pulse border border-emerald-500/30">
                    <Brain size={16} />
                    <span className="text-sm font-semibold">Active: {selectedAgentId.replace('_', ' ').toUpperCase()}</span>
                    <button onClick={() => {
                      setSelectedAgentId(null);
                      setAgentUsed('');
                      window.history.replaceState({}, '', '/');
                    }} className="ml-2 hover:text-white"><X size={14} /></button>
                  </div>
                )}

                <h2 className="text-white/60 text-center text-2xl font-bold">
                  Chat with <span className="text-emerald-400">Tovira</span> for crypto insights!
                </h2>
                <div className="grid grid-cols-2 gap-3 mb-4 p-4">
                  {chatSuggestions.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.1 }}
                      onClick={() => handleSuggestionClick(s.title)}
                      className="bg-white/10 hover:bg-white/20 text-white/80 p-3 rounded-xl border border-white/10 text-left transition-all duration-200 cursor-pointer"
                    >
                      <h4 className="text-sm font-semibold mb-1">{s.title}</h4>
                      <p className="text-xs text-white/60">{s.description}</p>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((msg, index) => (
              <motion.div
                key={`${msg.id}-${index}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-4 flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`w-fit rounded-2xl p-4 ${msg.sender === 'user' ? 'max-w-[75%] bg-gradient-to-r from-emerald-400 to-emerald-600 text-black' : 'max-w-[85%] text-white/50'}`}>
                  {msg.sender === 'ai' ? (
                    <div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
                        h3: ({ children }) => <h3 className="text-emerald-400 font-semibold mt-3 mb-2">{children}</h3>,
                        strong: ({ children }) => <strong className="text-emerald-300">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc ml-5 space-y-1">{children}</ul>,
                        li: ({ children }) => <li className="text-white/50">{children}</li>,
                        p: ({ children }) => <p className="my-2 text-white/50 text-wrap">{children}</p>,
                        code: ({ children }) => <code className="bg-black/40 px-1 py-0.5 rounded text-emerald-300">{children}</code>,
                      }}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-all">{msg.text}</p>
                  )}
                  <p className="text-xs text-white/40 mt-2">{msg.timestamp}</p>
                </div>
              </motion.div>
            ))}

            {streamingText && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start mb-4">
                <div className="w-full p-4">
                  {agentUsed && (
                    <div className="text-xs text-emerald-400/60 mb-2 flex items-center gap-1">
                      <Brain size={12} />
                      <span>{agentUsed} agent</span>
                    </div>
                  )}

                  {/* Workflow Steps */}
                  <WorkflowSteps steps={workflowSteps} />

                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
                    h3: ({ children }) => <h3 className="text-emerald-400 font-semibold mt-3 mb-2">{children}</h3>,
                    strong: ({ children }) => <strong className="text-emerald-300">{children}</strong>,
                    ul: ({ children }) => <ul className="list-disc ml-5 space-y-1">{children}</ul>,
                    li: ({ children }) => <li className="text-white/50">{children}</li>,
                    p: ({ children }) => <p className="my-2 text-white/50">{children}</p>,
                    code: ({ children }) => <code className="bg-black/40 px-1 py-0.5 rounded text-emerald-300">{children}</code>,
                  }}>
                    {streamingText}
                  </ReactMarkdown>
                  <span className="inline-block w-2 h-4 bg-emerald-400 animate-pulse ml-1" />
                </div>
              </motion.div>
            )}

            {isProcessingPrompt && !streamingText && workflowSteps.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 mb-4">
                <div className="rounded-full h-10 w-10 flex items-center justify-center">
                  <img src="/assets/images/mascot.png" alt="Tovira" className="object-cover w-full h-full" />
                </div>
                <p className="text-sm text-white/60">Thinking...</p>
              </motion.div>
            )}

            {/* Steps only (if thinking but no text yet) */}
            {isProcessingPrompt && !streamingText && workflowSteps.length > 0 && (
              <div className="mb-4">
                <WorkflowSteps steps={workflowSteps} />
              </div>
            )}

          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>
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
                  <button onClick={cancelFee} className="text-white/40 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-bold text-white mb-2">Transaction Fee Required</h3>
                <p className="text-white/60 text-sm mb-4">
                  The <strong>{feeModalDetail.agent === 'research_agent' ? 'Research' : 'Task'} Agent</strong> needs gas for this operation.
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
                    className="flex-1 py-3 text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmFee}
                    className="flex-1 py-3 text-sm font-medium text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all font-bold"
                  >
                    Approve & Pay
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className={`w-full flex justify-center items-center p-4 ${messages.length > 0 ? 'sticky bottom-0' : ''}`}>
        <motion.div
          className="group relative max-w-3xl w-full bg-[#1d1d1d]/90 backdrop-blur-xl border border-white/10 flex items-end gap-2 text-white rounded-[35px] transition-all duration-200 p-2 px-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={e => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask Tovira anything..."
            className="w-full min-h-[12px] max-h-[120px] placeholder-white/40 border-0 focus:outline-none resize-none p-2 overflow-y-auto"
            maxLength={500}
            disabled={isLoading}
          />
          {input.trim() && (
            <button
              onClick={() => handleSendMessage(input)}
              disabled={isLoading}
              className={`rounded-full w-9 h-9 flex items-center justify-center bg-gradient-to-r from-[#8EF1FE] to-[#0796D9] text-black transition-all duration-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:from-[#79e8f0] hover:to-[#0687c2]'}`}
            >
              <Send size={16} />
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;