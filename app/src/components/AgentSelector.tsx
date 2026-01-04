import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAgentConfig, allAgents } from '@/config/agents';

interface AgentSelectorProps {
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  className?: string;
}

const AgentSelector = ({ selectedAgentId, onAgentChange, className = '' }: AgentSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedAgent = getAgentConfig(selectedAgentId);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAgentSelect = (agentId: string) => {
    onAgentChange(agentId);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
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
          className={`text-white/60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-full min-w-[280px] bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
          >
            {allAgents.map((agent) => {
              const isSelected = agent.id === selectedAgentId;

              return (
                <button
                  key={agent.id}
                  onClick={() => handleAgentSelect(agent.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors duration-150"
                  style={{
                    background: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                  }}
                >
                  {/* Agent Icon - Image */}
                  <img
                    src={agent.iconUrl}
                    alt={agent.displayName}
                    className="w-8 h-8 rounded-full object-cover"
                  />

                  {/* Agent Name - Simple */}
                  <span className="text-white font-medium text-sm flex-1 text-left">
                    {agent.displayName}
                  </span>

                  {/* Selected Indicator */}
                  {isSelected && (
                    <Check size={18} className="text-white" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentSelector;
