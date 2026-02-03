import { useState, useEffect } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { allAgents, getAgentConfig } from '@/config/agents';

interface AgentSelectorProps {
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  className?: string;
  disabled?: boolean;
  autoOpen?: boolean;
  location?: 'header' | 'input'; // Where the selector is placed
}

const AgentSelector = ({
  selectedAgentId,
  onAgentChange,
  className = '',
  disabled = false,
  autoOpen = false,
  location = 'header'
}: AgentSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedAgent = getAgentConfig(selectedAgentId);

  useEffect(() => {
    if (autoOpen && !disabled) {
      setIsOpen(true);
    }
  }, [autoOpen, disabled]);

  const handleAgentSelect = (agentId: string) => {
    onAgentChange(agentId);
    setIsOpen(false);
  };

  if (disabled) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full">
          <img
            src={selectedAgent.iconUrl}
            alt={selectedAgent.displayName}
            className="w-5 h-5 rounded-full object-contain"
          />
          <span className="font-medium text-[14px] text-white/80">{selectedAgent.displayName}</span>
          <Lock size={12} className="text-white/30" />
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button - Shows selected agent */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 transition-all duration-200 cursor-pointer"
      >
        <img
          src={selectedAgent.iconUrl}
          alt={selectedAgent.displayName}
          className="cursor-pointer w-5 h-5 object-contain"
        />
        <span className="cursor-pointer font-medium text-[14px] text-white">{selectedAgent.displayName}</span>
        <ChevronDown
          size={14}
          className={`cursor-pointer text-white/60 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Invisible backdrop to close dropdown */}
            <div
              className="fixed inset-0 z-[199]"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown positioned below trigger */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className={`absolute z-[200] w-[280px] ${location === 'header'
                ? 'top-full left-0 mt-2'
                : 'bottom-full left-0 mb-2'
                }`}
            >
              <div className="bg-[#00060A] border border-white/10 rounded-[30px] space-y-2 p-2 shadow-2xl">
                {allAgents.map((agent) => {
                  const isSelected = agent.id === selectedAgentId;

                  return (
                    <button
                      key={agent.id}
                      onClick={() => handleAgentSelect(agent.id)}
                      className={`relative w-full flex items-center pl-1.3 pr-2 p-1 rounded-full transition-all duration-200 text-left gap-3 cursor-pointer
                        ${isSelected
                        ? 'bg-white/10 border-[2px] border-[#B7FC0D]'
                          : 'bg-transparent border border-transparent hover:bg-white/5'
                        }
                      `}
                    >
                      {/* Icon Container */}
                      <div className="w-[40px] h-[40px] bg-black p-[10px] rounded-full flex items-center justify-center flex-shrink-0">
                        <img
                          src={agent.iconUrl}
                          alt={agent.displayName}
                          className="w-6 h-6 object-contain"
                        />
                      </div>

                      {/* Name */}
                      <span className="w-full flex-1 text-white font-medium text-[14px]">
                        {agent.displayName}
                      </span>

                      {/* Fee Badge */}
                      <div className="w-[50px] flex flex-col items-center">
                        <div className="bg-[#B7FC0D33] text-[#B7FC0D] px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0">
                          {agent.fee > 0 ? `$${agent.fee}` : 'Free'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentSelector;

