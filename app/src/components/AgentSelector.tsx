import { useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAgentConfig, allAgents } from '@/config/agents';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface AgentSelectorProps {
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  className?: string;
}

const AgentSelector = ({ selectedAgentId, onAgentChange, className = '' }: AgentSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedAgent = getAgentConfig(selectedAgentId);

  const handleAgentSelect = (agentId: string) => {
    onAgentChange(agentId);
    setIsOpen(false);
  };

  return (
    <>
      <div className={className}>
        {/* Trigger Button */}
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-3 rounded-full bg-white/5 hover:bg-white/10 transition-all duration-200 border border-white/10"
        >
          <img
            src={selectedAgent.iconUrl}
            alt={selectedAgent.displayName}
            className="w-6 h-6 rounded-full object-cover"
          />
          <span className="text-white font-medium text-sm">{selectedAgent.displayName}</span>
          <ChevronDown
            size={16}
            className="text-white/60"
          />
        </button>
      </div>

      {/* Agent Selection Modal */}
      <AnimatePresence>
        {isOpen && (
          <ModalPortal>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4"
              onClick={() => setIsOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[#1a1a1a] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Select AI Agent</h2>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X size={18} className="text-white/60" />
                  </button>
                </div>

                {/* Agents Grid */}
                <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
                  {allAgents.map((agent) => {
                    const isSelected = agent.id === selectedAgentId;

                    return (
                      <button
                        key={agent.id}
                        onClick={() => handleAgentSelect(agent.id)}
                        className={`relative flex flex-col items-start p-3 rounded-2xl border transition-all duration-200 text-left group ${isSelected
                          ? 'bg-white/10 border-white/20'
                          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                          }`}
                      >
                        <div className="flex items-start justify-between w-full mb-2">
                          <div className="w-10 h-10 rounded-full p-0.5 bg-gradient-to-br from-white/10 to-white/5 border border-white/10">
                            <img
                              src={agent.iconUrl}
                              alt={agent.displayName}
                              className="w-full h-full rounded-full object-cover"
                            />
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-[#00FF88] flex items-center justify-center">
                              <Check size={12} className="text-black font-bold" />
                            </div>
                          )}
                        </div>

                        <h3 className="text-white font-bold text-base mb-1 group-hover:text-[#00FF88] transition-colors">
                          {agent.displayName}
                        </h3>

                        <p className="text-white/60 text-xs mb-3 line-clamp-2">
                          {agent.description}
                        </p>

                        <div className="mt-auto pt-3 w-full border-t border-white/5 flex items-center justify-between">
                          <span className="text-xs font-mono text-white/40 uppercase">Cost</span>
                          <span className={`text-xs font-bold ${agent.fee > 0 ? 'text-[#00FF88]' : 'text-white/60'}`}>
                            {agent.feeDisplay}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </>
  );
};

export default AgentSelector;
