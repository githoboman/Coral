// Mock Chat Service - Simulates AI chat without backend dependency

export interface MockMessage {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  chat_id?: string;
  agentType?: string;
}

export interface MockChat {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
}

// Sample agent responses
const agentResponses: Record<string, string[]> = {
  research_agent: [
    `### SUI Token Research Report

**Overview:**
SUI is the native token of the Sui blockchain, a layer-1 blockchain designed for high throughput and low latency.

**Key Metrics:**
- **Current Price:** $4.32 (as of Dec 2024)
- **Market Cap:** $12.8B
- **24h Volume:** $1.2B
- **Circulating Supply:** 2.96B SUI

**Technology:**
- Built on Move programming language
- Parallel transaction execution
- Object-centric data model
- Instant finality

**Recent Developments:**
- Partnership with major DeFi protocols
- Growing NFT ecosystem
- Expanding developer community

**Investment Outlook:**
SUI shows strong fundamentals with innovative technology and growing adoption. However, as with all crypto investments, conduct your own research and invest responsibly.`,

    `### Deep Dive: Cetus Protocol on Sui

**What is Cetus?**
Cetus is the leading DEX on Sui blockchain, offering concentrated liquidity and efficient trading.

**Key Features:**
- **Concentrated Liquidity:** Capital efficiency similar to Uniswap V3
- **Low Fees:** 0.04% - 1% depending on pool
- **Fast Execution:** Leverages Sui's parallel processing

**TVL & Volume:**
- Total Value Locked: $180M+
- 24h Trading Volume: $45M+
- Active Liquidity Providers: 12,000+

**Token Economics:**
- CETUS token for governance
- Fee sharing for stakers
- Liquidity mining rewards

**Competitive Advantage:**
Cetus benefits from being first-mover on Sui, with deep liquidity and strong community support.`,
  ],

  task_agent: [
    `✅ **Task Created Successfully!**

I've set up your reminder:

**Task:** Check the market
**Scheduled:** 2 hours from now (${new Date(Date.now() + 2 * 60 * 60 * 1000).toLocaleTimeString()})
**Priority:** Medium
**Status:** Pending

You'll receive a notification when it's time. You can view all your tasks in the Activity page.`,

    `✅ **Swap Order Configured!**

I've set up your limit order:

**Action:** Swap 100 SUI for USDC
**Trigger Price:** $4.50
**Estimated Output:** ~$450 USDC
**Slippage:** 0.5%
**Status:** Waiting for price target

The order will execute automatically when SUI reaches $4.50. You can monitor it in the Activity page.`,
  ],

  main: [
    `Hello! I'm Tovira, your Web3 AI assistant on Sui. I can help you with:

🔍 **Research** - Deep dives into tokens, protocols, and projects
📋 **Tasks** - Set reminders, automate swaps, and manage your Web3 activities  
🔔 **Alerts** - Price notifications and wallet monitoring
💬 **Chat** - Answer questions about crypto, DeFi, and the Sui ecosystem

What would you like to explore today?`,

    `The Sui blockchain is a layer-1 blockchain that uses the Move programming language. Here are some key points:

**Architecture:**
- Object-centric model (unlike account-based)
- Parallel transaction execution
- Instant finality

**Performance:**
- Theoretical throughput: 297,000 TPS
- Sub-second finality
- Low transaction costs (~$0.001)

**Ecosystem:**
- Growing DeFi protocols (Cetus, Turbos, Scallop)
- Active NFT marketplaces
- Gaming and social applications

Would you like me to research any specific aspect of Sui in more detail?`,

    `Based on current market conditions, here are some popular DeFi strategies on Sui:

**1. Liquidity Provision on Cetus**
- Provide liquidity to SUI/USDC pool
- Expected APR: 15-25%
- Risk: Impermanent loss

**2. Lending on Scallop**
- Supply SUI or stablecoins
- Earn interest: 5-12% APY
- Risk: Smart contract risk

**3. Yield Farming**
- Stake LP tokens for additional rewards
- APR: 30-50% (varies by pool)
- Risk: Higher volatility

**4. Staking SUI**
- Native staking for network security
- APR: ~3-5%
- Risk: Minimal (validator risk)

Would you like me to research any of these strategies in detail?`,
  ],
};

// Sample workflow steps
const workflowSteps = [
  { message: 'Running web search', status: 'completed' },
  { message: 'Running analyze token metrics', status: 'completed' },
  { message: 'Running fetch on-chain data', status: 'completed' },
  { message: 'Running generate report', status: 'running' },
];

// Simulate streaming text
export const simulateStreaming = async (
  text: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onStep?: (step: any) => void,
  signal?: AbortSignal
) => {
  // Simulate workflow steps first (for research agent)
  if (onStep) {
    for (const step of workflowSteps) {
      if (signal?.aborted) return;
      onStep({ ...step, id: Date.now() + Math.random() });
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Stream the text
  const words = text.split(' ');
  let currentText = '';

  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) return;
    currentText += (i > 0 ? ' ' : '') + words[i];
    onChunk(currentText);

    // Variable delay for more natural feel
    const delay = words[i].length > 10 ? 50 : 30;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  onComplete();
};

// Get appropriate response based on query and agent
export const getMockResponse = (query: string, agentType: string = 'main'): string => {
  const responses = agentResponses[agentType] || agentResponses.main;

  // Simple keyword matching for more relevant responses
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes('research') || lowerQuery.includes('token') || lowerQuery.includes('sui')) {
    return responses[0] || responses[Math.floor(Math.random() * responses.length)];
  }

  if (lowerQuery.includes('task') || lowerQuery.includes('remind') || lowerQuery.includes('swap')) {
    return agentResponses.task_agent[0];
  }

  // Random response from the agent's pool
  return responses[Math.floor(Math.random() * responses.length)];
};

// Mock chat data
export const mockChats: MockChat[] = [
  {
    chat_id: 'chat-1',
    name: 'SUI Token Research',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    last_updated: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
  {
    chat_id: 'chat-2',
    name: 'DeFi Strategies Discussion',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    last_updated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    chat_id: 'chat-3',
    name: 'Market Analysis',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    last_updated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Mock chat messages
export const mockChatMessages: Record<string, MockMessage[]> = {
  'chat-1': [
    {
      id: 1,
      text: 'Research the SUI token',
      sender: 'user',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toLocaleTimeString(),
      chat_id: 'chat-1',
    },
    {
      id: 2,
      text: agentResponses.research_agent[0],
      sender: 'ai',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 5000).toLocaleTimeString(),
      chat_id: 'chat-1',
      agentType: 'Research Agent',
    },
  ],
  'chat-2': [
    {
      id: 1,
      text: 'What are some good DeFi strategies on Sui?',
      sender: 'user',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toLocaleTimeString(),
      chat_id: 'chat-2',
    },
    {
      id: 2,
      text: agentResponses.main[2],
      sender: 'ai',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000 + 3000).toLocaleTimeString(),
      chat_id: 'chat-2',
    },
  ],
  'chat-3': [
    {
      id: 1,
      text: 'Tell me about Sui blockchain',
      sender: 'user',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleTimeString(),
      chat_id: 'chat-3',
    },
    {
      id: 2,
      text: agentResponses.main[1],
      sender: 'ai',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 2000).toLocaleTimeString(),
      chat_id: 'chat-3',
    },
  ],
};

// Simulate router decision
export const simulateRouter = (query: string, selectedAgent?: string): {
  target_agent: string;
  requires_fee: boolean;
  estimated_cost: number;
  reason: string;
} => {
  const lowerQuery = query.toLowerCase();

  // If agent is pre-selected, use it
  if (selectedAgent) {
    const requiresFee = selectedAgent === 'research_agent';
    return {
      target_agent: selectedAgent,
      requires_fee: requiresFee,
      estimated_cost: requiresFee ? 0.0008 : 0,
      reason: `Using selected ${selectedAgent.replace('_', ' ')}`,
    };
  }

  // Research keywords
  if (lowerQuery.includes('research') || lowerQuery.includes('analyze') || lowerQuery.includes('deep dive')) {
    return {
      target_agent: 'research_agent',
      requires_fee: true,
      estimated_cost: 0.0008,
      reason: 'Deep research requires on-chain analysis',
    };
  }

  // Task keywords
  if (lowerQuery.includes('remind') || lowerQuery.includes('task') || lowerQuery.includes('swap') || lowerQuery.includes('buy')) {
    return {
      target_agent: 'task_agent',
      requires_fee: false,
      estimated_cost: 0,
      reason: 'Task automation is free',
    };
  }

  // Default to main agent
  return {
    target_agent: 'main',
    requires_fee: false,
    estimated_cost: 0,
    reason: 'General chat is free',
  };
};

// Generate a new chat ID
export const generateChatId = (): string => {
  return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
