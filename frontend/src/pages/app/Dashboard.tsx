import { useAuth } from '@/hooks/useAuth';
import { Send, ChevronDown, MoreVertical, Trash2, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import Dropdown from '@/components/ui/dropdown';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  chat_id?: string;
}

interface Chat {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
}

const chatSuggestions = [
  {
    title: 'Analyze BTC market sentiment',
    description: 'Get real-time sentiment analysis for Bitcoin markets.',
  },
  {
    title: 'Research a token on Sui',
    description: 'Dive into token details and performance on the Sui blockchain.',
  },
  {
    title: 'What’s trending in NFTs?',
    description: 'Discover the latest trends and hot NFTs in the market.',
  },
  {
    title: 'Set up a price alert for ETH',
    description: 'Receive notifications for Ethereum price changes.',
  },
];

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const Dashboard = () => {
  const { address } = useAuth();
  const { chatId } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [chatName, setChatName] = useState('');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const user_id = address;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Sync currentChatId with chatId from URL
  useEffect(() => {
    setCurrentChatId(chatId || null);
  }, [chatId]);

  // Fetch user's chats
  useEffect(() => {
    if (user_id) {
      const fetchChats = async () => {
        try {
          const response = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
          if (response.ok) {
            const data = await response.json();
            setChats(data.chats);
          } else {
            console.error('Failed to fetch chats');
          }
        } catch (error) {
          console.error('Error fetching chats:', error);
        }
      };
      fetchChats();
    }
  }, [user_id]);

  // Fetch chat history when currentChatId changes
  useEffect(() => {
    if (currentChatId) {
      const fetchChatHistory = async () => {
        try {
          setIsLoading(true);
          const response = await fetch(`${apiBaseUrl}/api/chat/${currentChatId}`);
          if (response.ok) {
            const data = await response.json();
            const formattedMessages: Message[] = data.messages.map((msg: any, index: number) => ({
              id: index + 1,
              text: msg.query,
              sender: msg.sender as 'user' | 'ai',
              timestamp: new Date(msg.timestamp).toLocaleTimeString(),
              chat_id: msg.chat_id,
            }));
            setMessages(formattedMessages);
          } else {
            console.error('Failed to fetch chat history');
            setMessages((prev) => [
              ...prev,
              {
                id: prev.length + 1,
                text: 'Failed to load chat history.',
                sender: 'ai',
                timestamp: new Date().toLocaleTimeString(),
                chat_id: currentChatId,
              },
            ]);
          }
        } catch (error) {
          console.error('Error fetching chat history:', error);
          setMessages((prev) => [
            ...prev,
            {
              id: prev.length + 1,
              text: 'Error connecting to the server.',
              sender: 'ai',
              timestamp: new Date().toLocaleTimeString(),
              chat_id: currentChatId,
            },
          ]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchChatHistory();
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  const handleSendMessage = async (query: string) => {
    if (!query.trim()) return;

    const newMessage: Message = {
      id: messages.length + 1,
      text: query,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
      chat_id: currentChatId || undefined,
    };
    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    textareaRef.current?.focus();
    setIsLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, user_id, chat_id: currentChatId }),
      });

      if (response.ok) {
        const data = await response.json();
        const newChatId = data.chat_id;
        const aiMessage: Message = {
          id: messages.length + 2,
          text: data.response || 'I got your query! Here’s a sample response about ' + query,
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString(),
          chat_id: newChatId,
        };
        setMessages((prev) => [...prev, aiMessage]);
        // Navigate to new chat if created
        if (!currentChatId && newChatId) {
          setCurrentChatId(newChatId);
          navigate(`/c/${newChatId}`);
        }
        // Refresh chats list
        const chatsResponse = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
        if (chatsResponse.ok) {
          const chatsData = await chatsResponse.json();
          setChats(chatsData.chats);
        }
      } else {
        const errorData = await response.json();
        setMessages((prev) => [
          ...prev,
          {
            id: messages.length + 2,
            text: errorData.detail || 'Sorry, something went wrong. Try again!',
            sender: 'ai',
            timestamp: new Date().toLocaleTimeString(),
            chat_id: currentChatId || undefined,
          },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: messages.length + 2,
          text: 'Error connecting to the server. Please try again later.',
          sender: 'ai',
          timestamp: new Date().toLocaleTimeString(),
          chat_id: currentChatId || undefined,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    navigate('/c');
    setMessages([]);
    setInput('');
    setIsDropdownOpen(false);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    handleSendMessage(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  const selectChat = (chatId: string) => {
    setCurrentChatId(chatId);
    navigate(`/c/${chatId}`);
    setIsDropdownOpen(false);
    setChatMenuOpen(null);
  };

  const handleEditName = (chat: Chat) => {
    setEditingChatId(chat.chat_id);
    setChatName(chat.name);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleNameChange = async (chatId: string) => {
    if (!chatId || !chatName.trim()) {
      setEditingChatId(null);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chatName }),
      });
      if (response.ok) {
        const chatsResponse = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
        if (chatsResponse.ok) {
          const chatsData = await chatsResponse.json();
          setChats(chatsData.chats);
        }
      } else {
        console.error('Failed to update chat name');
      }
    } catch (error) {
      console.error('Error updating chat name:', error);
    } finally {
      setEditingChatId(null);
      setChatMenuOpen(null);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/${chatId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const chatsResponse = await fetch(`${apiBaseUrl}/api/chats?user_id=${user_id}`);
        if (chatsResponse.ok) {
          const chatsData = await chatsResponse.json();
          setChats(chatsData.chats);
          if (chatId === currentChatId) {
            setCurrentChatId(null);
            navigate('/c');
            setMessages([]);
          }
        }
      } else {
        console.error('Failed to delete chat');
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
    } finally {
      setChatMenuOpen(null);
    }
  };

  // Filter chats based on search query
  const filteredChats = chats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Define chat items for the Dropdown component using filtered chats
  const chatItems = filteredChats.map((chat) => ({
    id: chat.chat_id,
    label: chat.name,
    subLabel: new Date(chat.last_updated).toLocaleDateString(),
    onClick: () => selectChat(chat.chat_id),
    isActive: chat.chat_id === currentChatId,
    customContent:
      editingChatId === chat.chat_id ? (
        <input
          ref={nameInputRef}
          value={chatName}
          onChange={(e) => setChatName(e.target.value)}
          onBlur={() => handleNameChange(chat.chat_id)}
          onKeyDown={(e) => e.key === 'Enter' && handleNameChange(chat.chat_id)}
          className="bg-transparent border border-white/10 text-white px-2 py-1 rounded text-sm flex-1"
          placeholder="Chat name"
          maxLength={50}
        />
      ) : null,
    nestedDropdown: {
      items: [
        {
          label: 'Edit Name',
          onClick: () => handleEditName(chat),
          icon: <MoreVertical size={14} />,
        },
        {
          label: 'Delete',
          onClick: () => handleDeleteChat(chat.chat_id),
          icon: <Trash2 size={14} className="text-red-400" />,
        },
      ],
    },
  }));

  return (
    <div className="h-full flex flex-col justify-center items-center w-full max-w-3xl mx-auto relative">
      {/* Dropdown and New Chat Button */}
      <div className="absolute top-0 py-4 w-full flex items-center gap-3 mb-2">
        {/* Dropdown for chats */}
        <Dropdown
          triggerLabel={currentChatId ? chats.find((chat) => chat.chat_id === currentChatId)?.name || 'Untitled' : 'Select Chat'}
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
        {/* New Chat Button */}
        {chatId && (
          <button
            onClick={startNewChat}
            className="bg-white/10 hover:bg-white/20 text-white/80 p-3 rounded-[25px] border border-white/10 transition-all duration-200 cursor-pointer"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {/* Chat Interface */}
      <div className="overflow-y-auto w-full p-16 sm:px-6 lg:px-8 h-full flex flex-col">
        <div className="mb-4 p-4 flex-1">
          <AnimatePresence>
            {messages.length === 0 && !currentChatId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col justify-end items-center"
              >
                <h2 className="text-white/60 text-center text-2xl font-bold">Chat with Tovira for crypto insights!</h2>
                <div className="grid grid-cols-2 gap-3 mb-4 p-4">
                  <AnimatePresence>
                    {chatSuggestions.map((suggestion, index) => (
                      <motion.button
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.3, delay: index * 0.1 }}
                        onClick={() => handleSuggestionClick(suggestion.title)}
                        className="bg-white/10 hover:bg-white/20 text-white/80 p-3 rounded-xl border border-white/10 text-left transition-all duration-200 cursor-pointer"
                      >
                        <h4 className="text-sm font-semibold mb-1">{suggestion.title}</h4>
                        <p className="text-xs text-white/60">{suggestion.description}</p>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`mb-4 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] p-3 rounded-xl ${
                    message.sender === 'user'
                      ? 'bg-gradient-to-r from-[#00FF88] to-[#00CC6A] text-black'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  <p>{message.text}</p>
                  <p className="text-xs text-white/40 mt-1">{message.timestamp}</p>
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start mb-4"
              >
                <div className="bg-white/10 p-3 rounded-xl max-w-[70%]">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce delay-200"></div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>
      {/* Input Field & Send Button */}
      <div className={`w-full p-4 ${messages.length > 0 ? 'absolute bottom-0' : ''}`}>
        <motion.div
          className="group relative max-w-3xl mx-auto w-full flex items-end gap-2 bg-[#1d1d1d]/90 backdrop-blur-xl border border-white/10 text-white rounded-[35px] transition-all duration-200 p-2 px-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-red-500 to-green-600 opacity-3 blur-xl -z-10" />
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Tovira anything..."
            className="w-full bg-transparent placeholder-white/40 border-0 focus:outline-none focus:ring-0 focus:border-transparent transition-all duration-200 p-2 resize-none min-h-[3rem] max-h-[120px] overflow-y-auto"
            maxLength={500}
            disabled={isLoading}
          />
          {input.trim() && (
            <div className="w-fit flex items-end justify-end">
              <button
                onClick={() => handleSendMessage(input)}
                disabled={isLoading}
                className={`rounded-full w-9 h-9 flex items-center justify-center bg-gradient-to-r from-[#8EF1FE] to-[#0796D9] text-black transition-all duration-200 ${
                  isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:from-[#79e8f0] hover:to-[#0687c2] cursor-pointer'
                }`}
              >
                <Send size={16} />
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;