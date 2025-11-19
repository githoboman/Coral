import { useState } from 'react';
import {
  Search,
  Calendar,
  Bell,
  Brain,
  Target,
  Shield,
  Zap,
  Lock,
  Sparkles,
  Gauge,
  Leaf,
} from 'lucide-react';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

interface Agent {
  id: string;
  name: string;
  description: string;
  Icon: React.FC<any>;
  status: 'live' | 'coming-soon';
  tags: string[];
}

interface Category {
  name: string;
  agents: Agent[];
}

/* -------------------------------------------------
   Tovira Agents – Only 2 live, rest coming soon
   ------------------------------------------------- */
const categories: Category[] = [
  {
    name: 'Research & Insights',
    agents: [
      {
        id: 'research-1',
        name: 'Tovira',
        description: 'Researches any Web3 project, NFT collection, or token. Analyzes contract, team, roadmap, community, on-chain activity, and gives you a clear, unbiased insight report.',
        Icon: Search,
        status: 'live',
        tags: ['research', 'insights', 'analysis'],
      },
      {
        id: 'insight-1',
        name: 'Tovira Oracle',
        description: 'AI powered deep dive into market sentiment, dev activity, and on-chain signals to predict emerging trends on Sui.',
        Icon: Brain,
        status: 'coming-soon',
        tags: ['insights', 'ai', 'prediction'],
      },
      {
        id: 'insight-2',
        name: 'Alpha Scanner',
        description: 'Scans socials, DEX volume, and GitHub commits to surface early alpha on Sui ecosystem projects.',
        Icon: Sparkles,
        status: 'coming-soon',
        tags: ['insights', 'alpha'],
      },
    ],
  },
  {
    name: 'Task & Automation',
    agents: [
      {
        id: 'task-1',
        name: 'Web3 Task Manager',
        description: 'Schedules and automates your Web3 tasks: claim airdrops, vote in DAOs, harvest yields, renew domains, or execute trades, all in one place.',
        Icon: Calendar,
        status: 'live',
        tags: ['tasks', 'scheduling', 'automation'],
      },
      {
        id: 'auto-1',
        name: 'Auto Swap Sniper',
        description: 'Automatically executes your predefined swap strategies when conditions are met, no manual timing.',
        Icon: Target,
        status: 'coming-soon',
        tags: ['automation', 'swap'],
      },
      {
        id: 'auto-2',
        name: 'Yield Harvester',
        description: 'Auto compounds rewards across Sui DeFi protocols to maximize your returns.',
        Icon: Leaf,
        status: 'coming-soon',
        tags: ['automation', 'yield'],
      },
    ],
  },
  {
    name: 'Alerts & Monitoring',
    agents: [
      {
        id: 'alert-1',
        name: 'Price Pulse',
        description: 'Real time price alerts for any token on Sui or cross chain, set thresholds, get notified instantly.',
        Icon: Bell,
        status: 'coming-soon',
        tags: ['alerts', 'price'],
      },
      {
        id: 'alert-2',
        name: 'Wallet Watch',
        description: 'Monitors your wallet for incoming and outgoing transactions, approvals, and suspicious activity.',
        Icon: Shield,
        status: 'coming-soon',
        tags: ['alerts', 'security'],
      },
      {
        id: 'alert-3',
        name: 'Gas Guard',
        description: 'Alerts you when gas is low or spiking, never overpay again.',
        Icon: Gauge,
        status: 'coming-soon',
        tags: ['alerts', 'gas'],
      },
    ],
  },
  {
    name: 'Wallet & Security',
    agents: [
      {
        id: 'sec-1',
        name: 'Transaction Simulator',
        description: 'Preview any transaction before signing, see exactly what will happen to your wallet.',
        Icon: Zap,
        status: 'coming-soon',
        tags: ['security', 'simulation'],
      },
      {
        id: 'sec-2',
        name: 'Wallet Guardian',
        description: 'Real time protection: auto freeze on suspicious activity, multi sig approvals, and scam detection.',
        Icon: Lock,
        status: 'coming-soon',
        tags: ['security', 'wallet'],
      },
    ],
  },
];


const Agents = () => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredCategories = selectedCategory
    ? categories.filter((c) => c.name === selectedCategory)
    : categories;

  return (
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto px-4 pb-6">
      {/* Header */}
      <div className="sticky top-0 pt-6">
        <h2 className="text-3xl font-bold mb-2">Agents</h2>
        </div>
      <div className="mb-8">
        <p className="text-white/80 text-lg">
          Real-time alerts, AI insights, and on-chain automation on Sui.
        </p>
      </div>

      {/* ==== YOUR FILTER BUTTONS (unchanged) ==== */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-5 py-2.5 rounded-full font-medium transition-all ${
            !selectedCategory
              ? 'bg-white/20 text-white shadow-lg'
              : 'bg-white/5 text-white/70 hover:bg-white/10'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.name}
            onClick={() => setSelectedCategory(cat.name)}
            className={`px-5 py-2.5 rounded-full font-medium transition-all ${
              selectedCategory === cat.name
                ? 'bg-white/20 text-white shadow-lg'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Agent Cards */}
      {filteredCategories.map((category) => (
        <section key={category.name} className="mb-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {category.agents.map((agent) => {
              const Icon = agent.Icon;
              return (
                <div
                  key={agent.id}
                  className={`bg-white/10 p-4 rounded-[20px] shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col ${
                    agent.status === 'coming-soon' ? 'opacity-75' : ''
                  }`}
                >
                  {/* Icon + CTA (top-right) */}
                  <div className="flex justify-between items-start w-full mb-4">
                    <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                      <Icon className="w-7 h-7 text-white" />
                    </div>

                    <button
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        agent.status === 'live'
                          ? 'bg-white/10 text-white hover:bg-white/20'
                          : 'bg-white/5 text-white/40 cursor-not-allowed'
                      }`}
                      disabled={agent.status === 'coming-soon'}
                    >
                      {agent.status === 'live' ? '+ Chat' : 'Soon'}
                    </button>
                  </div>

                  {/* Title & Description */}
                  <h4 className="text-lg font-bold mb-2">{agent.name}</h4>
                  <p className="text-sm text-white/70 flex-grow">{agent.description}</p>

                  {/* Coming Soon Label */}
                  {agent.status === 'coming-soon' && (
                    <span className="mt-3 text-xs text-yellow-400 font-medium">
                      Coming Soon
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default Agents;