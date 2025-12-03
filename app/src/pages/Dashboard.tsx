import { useAuth } from '@/hooks/useAuth';
import { Send, Trash2, Plus, MoreVertical, Brain, Fuel } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Dropdown from '@/components/ui/dropdown';

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

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingPrompt, setIsProcessingPrompt] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [chatName, setChatName] = useState('');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [agentUsed, setAgentUsed] = useState<string>('');

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
    setCurrentChatId(chatId || null);
  }, [chatId]);

  // Fetch chats
  useEffect(() => {
    if (!user_id) return;
    const fetchChats = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
        if (res.ok) {
          const data = await res.json();
          setChats(data.chats);
        }
      } catch (e) { console.error(e); }
    };
    fetchChats();
  }, [user_id]);

  // Fetch chat history
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }
    const fetchChatHistory = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/chat/${currentChatId}`);
        if (res.ok) {
          const data = await res.json();
          const formatted: Message[] = data.messages.map((msg: any, i: number) => ({
            id: i + 1,
            text: msg.query,
            sender: msg.sender as 'user' | 'ai',
            timestamp: new Date(msg.timestamp).toLocaleTimeString(),
            chat_id: msg.chat_id,
          }));
          setMessages(formatted);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchChatHistory();
  }, [currentChatId]);

  const handleSendMessage = async (query: string) => {
    if (!query.trim()) return;

    const userMsg: Message = {
      id: messages.length + 1,
      text: query,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
      chat_id: currentChatId || undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsProcessingPrompt(true);
    setStreamingText('');
    setAgentUsed('');

    try {
      const res = await fetch(`${apiBaseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          user_id,
          chat_id: currentChatId,
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
        if (done) {
          console.log('Stream completed');
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.substring(6));
            console.log('Received SSE event:', data);

            if (data.type === 'chat_id') {
              newChatId = data.chat_id;
              if (!currentChatId) {
                setCurrentChatId(newChatId);
                navigate(`/${newChatId}`);
              }
            }

            else if (data.type === 'agent_info') {
              setAgentUsed(data.agent);
            }

            else if (data.type === 'response') {
              fullResponse += data.content;
              setStreamingText(fullResponse);
            }

            else if (data.type === 'done') {
              const aiMsg: Message = {
                id: messages.length + 2,
                text: fullResponse,
                sender: 'ai',
                timestamp: new Date().toLocaleTimeString(),
                chat_id: newChatId || undefined,
              };
              setMessages(prev => [...prev, aiMsg]);
              setStreamingText('');
              setAgentUsed('');
              // Refresh chats
              const chatsRes = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
              if (chatsRes.ok) {
                const d = await chatsRes.json();
                setChats(d.chats);
              }
            }
          } catch (e) {
            console.error('SSE parse error:', e);
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: prev.length + 2,
        text: 'Connection error. Please try again.',
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString(),
      }]);
    } finally {
      setIsProcessingPrompt(false);
    }
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    navigate('/');
    setMessages([]);
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
      const res = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
      const data = await res.json();
      setChats(data.chats);
    } catch (e) { console.error(e); } finally {
      setEditingChatId(null);
      setChatMenuOpen(null);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/chat/${chatId}`, { method: 'DELETE' });
      const res = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
      const data = await res.json();
      setChats(data.chats);
      if (chatId === currentChatId) {
        setCurrentChatId(null);
        navigate('/');
        setMessages([]);
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
      setCurrentChatId(chat.chat_id);
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
    return (
      <div className="h-dvh w-full flex justify-center items-center">
        <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
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
            <button
              onClick={startNewChat}
              className="bg-[#2d2d2d] hover:bg-white/20 text-white/80 p-3 rounded-[25px] border border-white/10 transition-all duration-200 cursor-pointer"
            >
              <Plus size={16} />
            </button>
          )}
        </div>

        <div className="w-full p-4 sm:px-6 lg:px-8 h-full flex flex-col">
          <AnimatePresence>
            {messages.length === 0 && !currentChatId && !isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col justify-end items-center">
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

            {messages.map(msg => (
              <motion.div
                key={msg.id}
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

            {isProcessingPrompt && !streamingText && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 mb-4">
                <div className="rounded-full h-10 w-10 flex items-center justify-center">
                  <img src="/assets/images/mascot.png" alt="Tovira" className="object-cover w-full h-full" />
                </div>
                <p className="text-sm text-white/60">Just a second...</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>
      </div>

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