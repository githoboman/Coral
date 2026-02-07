// Agent Configuration

export interface AgentConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  iconUrl: string;
  color: string;
  gradient: string;
  fee: number;
  feeDisplay: string;
  suggestions: string[];
  placeholder: string;
}

export const agentConfigs: Record<string, AgentConfig> = {
  research_agent: {
    id: 'research_agent',
    name: 'research',
    displayName: 'Research Agent',
    description: 'Comprehensive crypto research and analysis',
    icon: '🔍',
    iconUrl: '/assets/images/agents/research-agent.svg',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
    fee: 0.0008,
    feeDisplay: '0.0008 SUI per research',
    suggestions: [
      'Research the SUI token',
      'Analyze Cetus protocol',
      'What tokens are trending?',
      'Deep dive into NFT dynamics',
    ],
    placeholder: 'Ask me to research any token, protocol, or market...',
  },

  task_agent: {
    id: 'task_agent',
    name: 'task',
    displayName: 'Task Manager',
    description: 'Automate your Web3 tasks: swaps, reminders, and on-chain actions',
    icon: '📋',
    iconUrl: '/assets/images/agents/task-agent.svg',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'Remind me in 2 hours',
      'Swap 10 SUI for USDC',
      'Set a price alert for SUI',
      'Schedule a weekly DCA',
    ],
    placeholder: 'Tell me what task you want to automate...',
  },

  alert_agent: {
    id: 'alert_agent',
    name: 'alert',
    displayName: 'Alert Manager',
    description: 'Real-time price alerts and wallet monitoring',
    icon: '🔔',
    iconUrl: '/assets/images/agents/alert-agent.svg',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'Alert me when SUI hits $5',
      'Monitor my wallet',
      'Notify me of new listings',
      'Track whale movements',
    ],
    placeholder: 'What would you like to be alerted about?',
  },

  main: {
    id: 'main',
    name: 'main',
    displayName: 'Tovira AI',
    description: 'Your AI assistant for Web3',
    icon: '💬',
    iconUrl: '/assets/images/agents/tovira-agent.svg',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'What is the Sui blockchain?',
      'Explain DeFi yield farming',
      'Best DeFi strategies?',
      'How do I get started?',
    ],
    placeholder: 'Ask me anything about crypto and Web3...',
  },
};

export const getAgentConfig = (agentId: string): AgentConfig => {
  return agentConfigs[agentId] || agentConfigs.main;
};

export const allAgents = Object.values(agentConfigs);

export enum AgentType {
  RESEARCH = 'research_agent',
  TASK = 'task_agent',
  ALERT = 'alert_agent',
  MAIN = 'main',
}
