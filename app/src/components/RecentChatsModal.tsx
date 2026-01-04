import { X, Clock, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Chat {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
}

interface RecentChatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  currentChatId: string | null;
  selectedAgentId: string;
  onChatSelect: (chatId: string) => void;
  onAgentChange: (agentId: string) => void;
}

const RecentChatsModal = ({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onChatSelect,
}: RecentChatsModalProps) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Sort chats by last updated
  const sortedChats = [...chats].sort((a, b) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  );

  // Filter chats based on search query
  const filteredChats = sortedChats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={onClose}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a1a] border border-white/10 rounded-3xl w-full max-w-2xl h-[600px] shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock size={20} className="text-white/60" />
                    <h2 className="text-xl font-bold text-white">Recent Chats</h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X size={20} className="text-white/60" />
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search chats..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-full text-white placeholder-white/40 focus:outline-none focus:border-white/20 transition-colors"
                  />
                </div>
              </div>

              {/* Chats List */}
              <div className="flex-1 overflow-y-auto p-4">
                {filteredChats.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <Clock size={48} className="mb-4" />
                    <p>{searchQuery ? 'No chats found' : 'No recent chats'}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredChats.map((chat) => {
                      const isActive = chat.chat_id === currentChatId;

                      return (
                        <button
                          key={chat.chat_id}
                          onClick={() => {
                            onChatSelect(chat.chat_id);
                            onClose();
                          }}
                          className={`w-full p-4 rounded-xl text-left transition-all duration-200 ${isActive
                              ? 'bg-white/10 border border-white/20'
                              : 'bg-white/5 hover:bg-white/10 border border-transparent'
                            }`}
                        >
                          <h3 className="text-white font-medium text-sm mb-1 truncate">
                            {chat.name}
                          </h3>
                          <p className="text-white/40 text-xs">
                            {new Date(chat.last_updated).toLocaleDateString()} at{' '}
                            {new Date(chat.last_updated).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default RecentChatsModal;
