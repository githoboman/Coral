import { X, Clock, Search, Trash2 } from 'lucide-react';
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
  onChatDelete: (chatId: string) => void;
}

const RecentChatsModal = ({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onChatSelect,
  onChatDelete,
}: RecentChatsModalProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);

  // Sort chats by last updated
  const sortedChats = [...chats].sort((a, b) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  );

  // Filter chats based on search query
  const filteredChats = sortedChats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150]"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[150] flex items-end md:items-center justify-center md:p-4"
              onClick={onClose}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[#1a1a1a] md:border border-white/10 md:rounded-3xl w-full md:max-w-2xl h-full md:h-[600px] shadow-2xl overflow-hidden flex flex-col"
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
                    <div className="space-y-1">
                      {filteredChats.map((chat) => {
                        const isActive = chat.chat_id === currentChatId;

                        return (
                          <div
                            key={chat.chat_id}
                            className={`group relative w-full py-2 transition-all duration-200 ${isActive
                              ? 'border-l-2 border-white/40 pl-3'
                              : 'pl-1 hover:pl-2'
                              }`}
                          >
                            <button
                              onClick={() => {
                                onChatSelect(chat.chat_id);
                                onClose();
                              }}
                              className="w-full text-left"
                            >
                              <h3 className="text-white font-medium text-sm mb-1 truncate pr-8">
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

                            {/* Delete Button */}
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingChatId(chat.chat_id);
                                }}
                                className="p-1 transition-colors"
                                title="Delete chat"
                              >
                                <Trash2 size={16} className="text-white/40 hover:text-red-400 transition-colors" />
                              </button>
                            </div>
                          </div>
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingChatId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingChatId(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[160]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[160] flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <Trash2 size={20} className="text-red-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white mb-2">Delete Chat?</h3>
                    <p className="text-white/60 text-sm">
                      Are you sure you want to delete "{chats.find(c => c.chat_id === deletingChatId)?.name}"? This action cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setDeletingChatId(null)}
                    className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onChatDelete(deletingChatId);
                      setDeletingChatId(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default RecentChatsModal;
