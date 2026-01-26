import { X, Clock, Search, Trash2, ChevronRight } from 'lucide-react';
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
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/40 backdrop-blur-md"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative bg-[#070B0F]/95 backdrop-blur-2xl border border-white/5 rounded-[32px] w-full max-w-[460px] h-[550px] shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="pt-6 px-6 pb-2">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Clock size={20} className="text-white" />
                    <h2 className="text-[24px] font-bold text-white tracking-tight">Recent chats</h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-white/5 rounded-full transition-all cursor-pointer"
                  >
                    <X size={20} className="text-white/40 hover:text-white" />
                  </button>
                </div>

                {/* Search Bar - Pill Shaped */}
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#B7FC0D] transition-colors">
                    <Search size={18} />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search"
                    className="w-full pl-12 pr-10 py-3 bg-[#15191C] border border-white/5 rounded-full text-white text-base placeholder-white/20 focus:outline-none focus:border-[#B7FC0D]/30 transition-all font-medium"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* Chats List */}
              <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-2 no-scrollbar">
                {filteredChats.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-white/20">
                    <p className="font-medium text-lg">{searchQuery ? 'No chats found' : 'No recent chats'}</p>
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isActive = chat.chat_id === currentChatId;

                    return (
                      <div
                        key={chat.chat_id}
                        className="group relative flex items-center gap-3 pr-1 min-w-0"
                      >
                        <button
                          onClick={() => {
                            onChatSelect(chat.chat_id);
                            onClose();
                          }}
                          className={`flex-1 min-w-0 p-4 rounded-[24px] text-left transition-all duration-300 flex items-center justify-between cursor-pointer
                            ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}
                          `}
                        >
                          <div className="flex-1 min-w-0">
                            <h3 className="text-white font-bold text-[17px] mb-1 truncate">
                              {chat.name}
                            </h3>
                            <p className="text-white/40 text-[13px] font-medium truncate">
                              {new Date(chat.last_updated).toLocaleDateString('en-US', {
                                month: 'numeric',
                                day: 'numeric',
                                year: 'numeric'
                              })} at{' '}
                              {new Date(chat.last_updated).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              }).toLowerCase()}
                            </p>
                          </div>

                          {/* "Go to chat" visible on hover */}
                          <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-shrink-0 items-center gap-1.5 text-[13px] font-bold text-white pr-1">
                            Go to chat <ChevronRight size={16} />
                          </div>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingChatId(chat.chat_id);
                          }}
                          className={`w-[50px] h-[50px] flex-shrink-0 rounded-[16px] flex items-center justify-center transition-all duration-300 cursor-pointer
                            ${deletingChatId === chat.chat_id ? 'bg-red-500/20 text-red-500' : 'bg-transparent text-white border border-white/5 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400'}
                          `}
                          title="Delete chat"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingChatId && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingChatId(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-[#070B0F] border border-white/10 rounded-[40px] w-full max-w-md p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center mb-8">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
                  <Trash2 size={32} className="text-red-500" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Delete chat?</h3>
                <p className="text-white/40 font-medium leading-relaxed">
                  Are you sure you want to delete <span className="text-white">"{chats.find(c => c.chat_id === deletingChatId)?.name}"</span>?
                  This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setDeletingChatId(null)}
                  className="flex-1 py-4 text-sm font-bold text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onChatDelete(deletingChatId);
                    setDeletingChatId(null);
                  }}
                  className="flex-1 py-4 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-full transition-all shadow-lg cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default RecentChatsModal;
