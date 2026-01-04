// Command configuration for each agent
export interface Command {
  id: string;
  label: string;
  description: string;
  icon: string;
  action?: string;
}

export const agentCommands: Record<string, Command[]> = {
  main: [
    { id: 'help', label: '/help', description: 'Show available commands', icon: '❓' },
    { id: 'clear', label: '/clear', description: 'Clear chat history', icon: '🗑️' },
    { id: 'new', label: '/new', description: 'Start a new chat', icon: '✨' },
  ],
  research_agent: [
    { id: 'help', label: '/help', description: 'Show available commands', icon: '❓' },
    { id: 'clear', label: '/clear', description: 'Clear chat history', icon: '🗑️' },
    { id: 'new', label: '/new', description: 'Start a new chat', icon: '✨' },
    { id: 'research', label: '/research', description: 'Deep research on a topic', icon: '🔬' },
    { id: 'analyze', label: '/analyze', description: 'Analyze token or protocol', icon: '📊' },
    { id: 'compare', label: '/compare', description: 'Compare multiple tokens', icon: '⚖️' },
    { id: 'trends', label: '/trends', description: 'Market trends analysis', icon: '📈' },
  ],
  task_agent: [
    { id: 'help', label: '/help', description: 'Show available commands', icon: '❓' },
    { id: 'clear', label: '/clear', description: 'Clear chat history', icon: '🗑️' },
    { id: 'new', label: '/new', description: 'Start a new chat', icon: '✨' },
    { id: 'create', label: '/create', description: 'Create a new task', icon: '➕' },
    { id: 'schedule', label: '/schedule', description: 'Schedule a task', icon: '📅' },
    { id: 'automate', label: '/automate', description: 'Automate a workflow', icon: '⚙️' },
    { id: 'remind', label: '/remind', description: 'Set a reminder', icon: '⏰' },
  ],
  alert_agent: [
    { id: 'help', label: '/help', description: 'Show available commands', icon: '❓' },
    { id: 'clear', label: '/clear', description: 'Clear chat history', icon: '🗑️' },
    { id: 'new', label: '/new', description: 'Start a new chat', icon: '✨' },
    { id: 'alert', label: '/alert', description: 'Create price alert', icon: '🔔' },
    { id: 'watch', label: '/watch', description: 'Watch a token', icon: '👁️' },
    { id: 'notify', label: '/notify', description: 'Set notification', icon: '📢' },
    { id: 'track', label: '/track', description: 'Track wallet activity', icon: '🎯' },
  ],
};

export const getCommandsForAgent = (agentId: string): Command[] => {
  return agentCommands[agentId] || agentCommands.main;
};

export const filterCommands = (commands: Command[], query: string): Command[] => {
  if (!query || !query.startsWith('/')) return commands;

  const searchTerm = query.toLowerCase();
  return commands.filter(cmd =>
    cmd.label.toLowerCase().includes(searchTerm) ||
    cmd.description.toLowerCase().includes(searchTerm)
  );
};
