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
      'Remind me to check the market in 2 hours',
      'Swap 10 SUI for USDC',
      'Set a price alert for SUI at $5',
      'Schedule a weekly DCA',
    ],
    placeholder: 'Tell me what task you want to automate...',
  },
};

// Helper function to get agent config
export const getAgentConfig = (agentId: string): AgentConfig => {
  return agentConfigs[agentId] || agentConfigs.task_agent;
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
