import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Trash2, Clock } from "lucide-react";
import { ModalPortal } from "./ui/ModalPortal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
}

interface RecentChatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export const RecentChatsModal: React.FC<RecentChatsModalProps> = ({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelect,
  onDelete,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [conversations, searchQuery]);

  // Helper to extract date from ID (assuming format "conv-{timestamp}")
  const getDateLabel = (id: string) => {
    try {
      const timestamp = parseInt(id.split("-")[1]);
      if (isNaN(timestamp)) return "";
      const date = new Date(timestamp);
      return new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      }).format(date);
    } catch {
      return "";
    }
  };

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={onClose}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="w-full max-w-md bg-[#0C0E13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[80vh]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    <Clock size={18} className="text-white/60" />
                    <h2 className="text-lg font-semibold text-white">Recent chats</h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-full hover:bg-white/5 text-white/40 hover:text-white transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Search */}
                <div className="px-6 pt-5 pb-2">
                  <div className="relative">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                    />
                    <input
                      type="text"
                      placeholder="Search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors"
                      autoFocus
                    />
                  </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
                  {filteredConversations.length === 0 ? (
                    <div className="text-center py-10 text-white/20 text-sm">
                      {conversations.length === 0
                        ? "No recent conversations"
                        : "No results found"}
                    </div>
                  ) : (
                    filteredConversations.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => {
                          onSelect(conv.id);
                          onClose();
                        }}
                        className={`group w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all cursor-pointer border border-transparent ${activeId === conv.id
                          ? "bg-white/[0.06] border-white/5"
                          : "hover:bg-white/[0.03] hover:border-white/5"
                          }`}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <h3 className={`text-sm font-medium truncate mb-1 ${activeId === conv.id ? "text-white" : "text-white/80 group-hover:text-white"
                            }`}>
                            {conv.title}
                          </h3>
                          <p className="text-xs text-white/30 truncate">
                            {getDateLabel(conv.id)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id, e);
                          }}
                          className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/30 hover:text-red-400 transition-all flex-shrink-0"
                          title="Delete conversation"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
};
