// src/pages/app/Dashboard.tsx
import { useAuth } from '@/hooks/useAuth';
import { Copy, Check, Plus, AlertTriangle, Zap, LogOut } from 'lucide-react';
import { useState } from 'react';

const Dashboard = () => {
  const { address, signOut } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // Sample data for tasks and alerts
  const tasks = [
    { id: 1, title: 'Schedule NFT mint reminder', due: 'Sep 22, 2025', sentiment: 'positive', priority: 'high' },
    { id: 2, title: 'Monitor DeFi yield farming', due: 'Sep 25, 2025', sentiment: 'neutral', priority: 'medium' },
    { id: 3, title: 'Review governance proposal vote', due: 'Sep 28, 2025', sentiment: 'negative', priority: 'low' },
  ];

  const alerts = [
    { id: 1, title: 'SUI price surge detected', sentiment: 'bullish', score: 85, time: '2 min ago' },
    { id: 2, title: 'New Sui dApp launch event', sentiment: 'neutral', score: 60, time: '1 hr ago' },
    { id: 3, title: 'Market volatility alert', sentiment: 'bearish', score: 25, time: '3 hrs ago' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-white to-[#00FF88] bg-clip-text text-transparent mb-2">
            Dashboard
          </h1>
          <p className="text-white/60">Manage tasks, schedule events, and stay ahead with sentiment-analyzed alerts</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="inline-flex items-center gap-2 bg-gradient-to-r from-[#00FF88] to-[#00CC6A] text-black font-semibold py-2 px-4 rounded-xl hover:from-[#00e679] hover:to-[#00b85a] transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-sm">
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Main Content: Tasks & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks Section */}
        <div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-[#00FF88] to-[#00CC6A] rounded-xl flex items-center justify-center">
                  <span className="text-black font-bold text-sm">📋</span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Scheduled Tasks</h2>
                  <p className="text-white/60 text-sm">AI-optimized for Web3 workflows</p>
                </div>
              </div>
              <button className="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1">
                <span>Schedule New</span>
                <Zap className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className="group bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${task.sentiment === 'positive' ? 'text-green-400' : task.sentiment === 'negative' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {task.sentiment === 'positive' ? '😊' : task.sentiment === 'negative' ? '😟' : '😐'}
                      </span>
                      <div>
                        <p className="text-white font-medium">{task.title}</p>
                        <p className="text-white/60 text-sm">Due: {task.due} • Priority: {task.priority}</p>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                      task.priority === 'high' ? 'bg-red-500/20 text-red-400' : task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                    }`}>
                      {task.priority.toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alerts Section */}
        <div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-sm">🔔</span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">AI Alerts</h2>
                  <p className="text-white/60 text-sm">Sentiment-analyzed market events</p>
                </div>
              </div>
              <button className="text-white/60 hover:text-white transition-colors text-sm flex items-center gap-1">
                <span>Configure</span>
                <AlertTriangle className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="group bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${alert.sentiment === 'bullish' ? 'text-green-400' : alert.sentiment === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {alert.sentiment === 'bullish' ? '🚀' : alert.sentiment === 'bearish' ? '📉' : '⚖️'}
                      </span>
                      <div>
                        <p className="text-white font-medium">{alert.title}</p>
                        <p className="text-white/60 text-sm">Sentiment Score: {alert.score}%</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/40">{alert.time}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* User Profile Card */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-r from-[#00FF88] to-[#00CC6A] rounded-xl flex items-center justify-center">
              <span className="text-black font-bold text-sm">👤</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Connected on Sui</h3>
              <p className="text-white/60 text-sm">{address ? truncateAddress(address) : 'No connection'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => address && copyToClipboard(address, 'address')}
              disabled={!address}
              className={`p-2 rounded-xl transition-all duration-200 flex items-center justify-center ${
                copiedField === 'address'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              } ${!address ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {copiedField === 'address' ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all duration-200 px-4 py-2 rounded-xl text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;