// Agent Configuration and Data

export interface AgentConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string; // For backward compatibility
  iconUrl: string; // Image path
  color: string; // Primary color
  gradient: string; // Gradient for backgrounds
  fee: number; // 0 for free
  feeDisplay: string;
  suggestions: string[];
  placeholder: string;
}

export const agentConfigs: Record<string, AgentConfig> = {
  research_agent: {
    id: 'research_agent',
    name: 'research',
    displayName: 'Tovira Research',
    description: 'Comprehensive crypto research and analysis. Data-driven insights for informed decisions',
    icon: '🔍',
    iconUrl: '/assets/images/agents/research-agent.png',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
    fee: 0.0008,
    feeDisplay: '0.0008 SUI per research',
    suggestions: [
      'Research the SUI token',
      'Analyze Cetus protocol',
      'What tokens are trending on Solana?',
      'Deep dive into NFT market dynamics',
    ],
    placeholder: 'Ask me to research any token, protocol, or market...',
  },

  task_agent: {
    id: 'task_agent',
    name: 'task',
    displayName: 'Task Manager',
    description: 'Automate your Web3 tasks: swaps, reminders, and on-chain actions',
    icon: '📋',
    iconUrl: '/assets/images/agents/task-agent.png',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'Remind me to check the market in 2 hours',
      'Swap 10 SUI for USDC',
      'Set a price alert for SUI at $5',
      'Schedule a weekly DCA',
    ],
    placeholder: 'Tell me what task you want to automate...',
  },

  alert_agent: {
    id: 'alert_agent',
    name: 'alert',
    displayName: 'Alert Agent',
    description: 'Real-time price alerts and wallet monitoring for your crypto portfolio',
    icon: '🔔',
    iconUrl: '/assets/images/agents/alert-agent.png',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'Alert me when SUI hits $5',
      'Monitor my wallet for large transactions',
      'Notify me of new token listings',
      'Track whale movements',
    ],
    placeholder: 'What would you like to be alerted about?',
  },

  main: {
    id: 'main',
    name: 'main',
    displayName: 'Tovira',
    description: 'Your AI assistant for Web3. Ask me anything about crypto, DeFi, and the Sui ecosystem',
    icon: '💬',
    iconUrl: '/assets/images/signin-logo.png',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    fee: 0,
    feeDisplay: 'Free',
    suggestions: [
      'What is the Sui blockchain?',
      'Explain DeFi yield farming',
      'What are some good DeFi strategies?',
      'How do I get started with Web3?',
    ],
    placeholder: 'Ask me anything about crypto and Web3...',
  },
};

// Helper function to get agent config
export const getAgentConfig = (agentId: string): AgentConfig => {
  return agentConfigs[agentId] || agentConfigs.main;
};

// List of all agents for selector
export const allAgents = Object.values(agentConfigs);

// Agent type enum
export enum AgentType {
  RESEARCH = 'research_agent',
  TASK = 'task_agent',
  ALERT = 'alert_agent',
  MAIN = 'main',
}
