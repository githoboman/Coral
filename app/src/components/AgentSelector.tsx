import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { allAgents } from '@/config/agents';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface AgentSelectorProps {
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  className?: string;
}

const AgentSelector = ({ selectedAgentId, onAgentChange, className = '' }: AgentSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleAgentSelect = (agentId: string) => {
    onAgentChange(agentId);
    setIsOpen(false);
  };

  return (
    <>
      <div className={className}>
        {/* Trigger Button - Gradient Pill */}
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#8BEE1C] to-[#2B87D1] hover:opacity-90 transition-all duration-300 shadow-lg active:scale-95 group cursor-pointer"
        >
          <span className="text-white font-bold text-[15px]">Select agent</span>
          <ChevronUp
            size={18}
            className={`text-white transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
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
              className="fixed inset-0 bg-black/40 backdrop-blur-md z-[200] cursor-pointer"
            />

            {/* Modal Content - Positioned above the input area */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-[90px] right-4 md:right-8 z-[200] w-full max-w-[320px]"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[#070B0F]/95 backdrop-blur-2xl border border-white/10 rounded-[30px] p-4 shadow-2xl flex flex-col gap-2"
              >
                {allAgents.map((agent) => {
                  const isSelected = agent.id === selectedAgentId;

                  return (
                    <button
                      key={agent.id}
                      onClick={() => handleAgentSelect(agent.id)}
                      className={`relative flex items-center p-2 rounded-2xl transition-all duration-300 text-left gap-3 cursor-pointer
                        ${isSelected
                          ? 'bg-white/5 border border-white/10'
                          : 'bg-transparent border border-transparent hover:bg-white/5'
                        }
                      `}
                    >
                      {/* Icon Container */}
                      <div className="w-10 h-10 rounded-full p-1.5 bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                        <img
                          src={agent.iconUrl}
                          alt={agent.displayName}
                          className="w-full h-full object-contain"
                        />
                      </div>

                      {/* Info Container */}
                      <div className="flex-1 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-white font-semibold text-[14px]">{agent.displayName}</span>
                        </div>

                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold 
                          ${agent.fee > 0 ? 'bg-[#B7FC0D]/10 text-[#B7FC0D]' : 'bg-white/10 text-white/40'}
                        `}>
                          {agent.fee > 0 ? `$${agent.fee}` : 'Free'}
                        </div>
                      </div>

                      {/* Selected Glow/Gradient Border Effect */}
                      {isSelected && (
                        <div className="absolute inset-0 rounded-2xl border border-[#B7FC0D]/30 pointer-events-none" />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </>
  );
};

export default AgentSelector;
