import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { LayoutContextType } from "@/types/LayoutTypes";
import {
  Search,
  ChevronDown,
  RefreshCw,
  Copy,
  ArrowUpRight,
  ArrowDownLeft,
  X,
} from "lucide-react";

export default function OnchainAnalysis() {
  const account = useCurrentAccount();
  const { walletBalanceUSD, tokens } = useOutletContext<LayoutContextType>();
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#000000] text-white p-6 md:p-8">
      <div className="max-w-[1200px] mx-auto space-y-6">
        
        {/* Header Row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Portfolio Dashboard
            </h1>
            <div className="flex items-center gap-5 sm:ml-2">
              <span className="bg-[#B7FC0D33] text-[#B7FC0D] px-5 py-1.5 rounded-full text-sm font-medium">
                View only
              </span>
              <div className="flex items-center gap-2 text-gray-300 text-sm">
                <span className="truncate max-w-[120px] sm:max-w-none">
                  {account?.address ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}` : "No wallet connected"}
                </span>
                {account?.address && (
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(account.address);
                    }}
                    className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
                  >
                    <Copy size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-4 pt-2">
          
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 w-full xl:w-auto">
            {/* USD / SUI Toggle */}
            <div className="flex items-center bg-[#0A0A0A] border border-white/10 rounded-full p-1 w-full sm:w-auto overflow-x-auto whitespace-nowrap">
              <button className="flex-1 sm:flex-none px-5 py-1.5 rounded-full text-gray-400 hover:text-white text-sm font-medium transition-colors">
                SUI
              </button>
              <button className="flex-1 sm:flex-none px-5 py-1.5 rounded-full bg-white/5 border border-[#B7FC0D]/50 text-white text-sm font-medium transition-colors">
                USD
              </button>
            </div>

            {/* Network Selector */}
            <div className="relative">
              <button 
                onClick={() => setIsNetworkDropdownOpen(!isNetworkDropdownOpen)}
                className="flex items-center justify-between w-full sm:w-auto gap-2 bg-[#0A0A0A] border border-white/10 px-4 py-2 rounded-full hover:bg-white/5 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20 whitespace-nowrap"
              >
                <span className="text-sm">Testnet</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${isNetworkDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isNetworkDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-full sm:w-36 bg-[#0A0A0A] border border-white/10 rounded-xl shadow-xl overflow-hidden z-20">
                  <div className="py-1">
                    <button 
                      onClick={() => setIsNetworkDropdownOpen(false)}
                      className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5 transition-colors"
                    >
                      Testnet
                    </button>
                    <button 
                      disabled
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 cursor-not-allowed"
                      title="Mainnet is currently unavailable"
                    >
                      Mainnet
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto flex-1">
            {/* Search Bar */}
            <div className="flex-1 relative w-full">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={16} className="text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Enter a SUI address"
                className="block w-full pl-10 pr-10 py-2.5 bg-[#141414] border border-white/10 rounded-full text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-500"
              />
              <button className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              {/* Analyze Button */}
              <button className="flex-1 sm:flex-none bg-[#3B82F6] hover:bg-[#2563EB] text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap">
                Analyze wallet
              </button>

              {/* Refresh Button */}
              <button className="p-2.5 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-white/5 border border-transparent flex-shrink-0 bg-[#0A0A0A] sm:bg-transparent border-white/10 sm:border-transparent">
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Top Cards Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
          
          {/* Portfolio Value */}
          <div className="lg:col-span-3 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 flex flex-col justify-between min-h-[160px]">
            <h3 className="text-gray-300 font-medium text-center">Portfolio value</h3>
            <div>
              <div className="text-4xl font-bold mt-2 text-center">${walletBalanceUSD || "0.00"}</div>
              <div className="flex justify-between items-end mt-4">
                <span className="text-gray-400 text-sm">24h change</span>
                <span className="text-green-500 font-medium text-sm">+1.56%</span>
              </div>
            </div>
          </div>

          {/* Portfolio Performance */}
          <div className="lg:col-span-4 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 relative min-h-[160px] h-[220px] lg:h-auto flex flex-col">
            <h3 className="text-gray-300 font-medium whitespace-nowrap">
              Portfolio perfomance
            </h3>
            <div className="absolute left-6 top-14 flex flex-col gap-3 text-xs font-mono">
              <button className="text-gray-500 hover:text-white">30D</button>
              <button className="text-[#34D399]">7D</button>
              <button className="text-white bg-white/10 px-1.5 rounded">24h</button>
            </div>
            {/* Mock Graph */}
            <div className="absolute inset-0 top-14 left-16 right-6 bottom-6 flex items-end">
                <svg viewBox="0 0 200 80" className="w-full h-full preserve-3d" preserveAspectRatio="none">
                    <path
                        d="M 0 40 L 20 70 L 40 45 L 60 75 L 80 50 L 100 30 L 120 45 L 140 20 L 160 30 L 180 15 L 200 25"
                        fill="none"
                        stroke="#34D399"
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
          </div>

          {/* Asset Distribution */}
          <div className="lg:col-span-5 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-8 sm:gap-0 lg:justify-between px-0 sm:pl-4 sm:pr-2 pt-6 lg:pt-0">
            
            {/* Donut Chart */}
            <div className="relative w-40 h-40 sm:w-32 sm:h-32 flex-shrink-0">
               {/* Pure CSS Donut Chart */}
               <div className="w-full h-full rounded-full bg-[#1A1A1A] relative"
                    style={{
                        background: 'conic-gradient(#B7FC0D 0% 25%, #3B82F6 25% 100%)'
                    }}>
                    <div className="absolute inset-4 rounded-full bg-[#000000] flex flex-col items-center justify-center">
                        <span className="text-xl font-bold">60%</span>
                        <span className="text-xs text-gray-400">SUI</span>
                    </div>
               </div>
            </div>

            {/* Distribution Bars */}
            <div className="w-full sm:flex-1 sm:ml-8 space-y-5">
                {[
                    { 
                      label: 'Liquid SUI', 
                      value: tokens?.find(t => t.symbol === 'SUI') ? `${tokens.find(t => t.symbol === 'SUI').balance.toFixed(2)} SUI` : '0.00 SUI', 
                      color: 'bg-[#3B82F6]', 
                      width: '60%' 
                    },
                    { label: 'Staked SUI', value: '0.00 SUI', color: 'bg-[#3B82F6]', width: '5%' },
                    { label: 'Locked SUI', value: '0.00 SUI', color: 'bg-[#3B82F6]', width: '2%' },
                ].map((item, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="w-full sm:w-24 text-sm text-gray-300">{item.label}</div>
                        <div className="flex-1 h-6 bg-[#262626] rounded-full relative overflow-hidden flex items-center justify-end px-3">
                            <div className={`absolute top-0 left-0 bottom-0 ${item.color} rounded-full`} style={{ width: item.width }} />
                            <span className="relative z-10 text-xs text-gray-400 font-medium mix-blend-difference">{item.value}</span>
                        </div>
                    </div>
                ))}
            </div>

          </div>
        </div>

        {/* Bottom Cards Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            
            {/* Other assets */}
            <div className="lg:col-span-4 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 h-[350px] overflow-hidden flex flex-col">
                <h3 className="text-gray-300 font-medium mb-6">Other assets</h3>
                <div className="space-y-6 overflow-y-auto no-scrollbar flex-1">
                    {tokens && tokens.length > 0 ? tokens.map((token, i) => (
                        <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center overflow-hidden">
                                   {token.icon && token.icon.startsWith('/') ? (
                                       <img src={token.icon} alt={token.symbol} className="w-8 h-8 object-contain" />
                                   ) : (
                                       <div className="w-5 h-5 rounded-full bg-[#3B82F6] flex items-center justify-center">
                                           <span className="text-[10px] font-bold">{token.symbol?.slice(0, 1)}</span>
                                       </div>
                                   )}
                                </div>
                                <div>
                                    <div className="font-medium">{token.balance.toFixed(2)} {token.symbol}</div>
                                    <div className="text-gray-500 text-xs mt-0.5">${token.price?.toFixed(2) || "0.00"}</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-medium">${(token.balance * token.price).toFixed(2)}</div>
                                <div className={`${(token.change24h || 0) >= 0 ? "text-[#34D399]" : "text-red-500"} text-xs mt-0.5`}>
                                    {(token.change24h || 0) >= 0 ? "+" : ""}{(token.change24h || 0).toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    )) : (
                        <div className="text-center text-gray-500 text-sm mt-10">No assets found</div>
                    )}
                </div>
            </div>

            {/* Recent transactions */}
            <div className="lg:col-span-8 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 relative min-h-[500px] h-auto flex flex-col">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 mb-6 w-full">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-3 w-full sm:w-auto">
                        <h3 className="text-gray-300 font-medium">Recent transactions</h3>
                        <span className="text-gray-500 text-sm">Last 10 transactions</span>
                    </div>
                    <button 
                         onClick={() => setIsAlertModalOpen(true)}
                         className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors w-full sm:w-auto">
                        Enable Live alerts
                    </button>
                </div>

                <div className="space-y-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                    <div className="min-w-[500px] space-y-5">
                        {[
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'received', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                            { type: 'sent', amount: '10 USDC', addr: '0x1a2B3c4d5E6f....', time: '2 minutes ago' },
                        ].map((tx, i) => (
                            <div key={i} className="flex items-center gap-4 text-sm">
                                <div className="w-5 flex justify-center flex-shrink-0">
                                    {tx.type === 'sent' ? (
                                        <ArrowUpRight className="text-[#EF4444]" size={16} />
                                    ) : (
                                        <ArrowDownLeft className="text-[#34D399]" size={16} />
                                    )}
                                </div>
                                <div className="w-6 h-6 rounded-full bg-[#1A1A1A] flex items-center justify-center border border-[#3B82F6]/30 flex-shrink-0">
                                       <div className="w-4 h-4 rounded-full bg-[#3B82F6] flex items-center justify-center">
                                           <span className="text-[8px] font-bold">$</span>
                                       </div>
                                </div>
                                <div className="flex flex-1 items-center gap-2 text-gray-300 min-w-[200px]">
                                    <span>{tx.type === 'sent' ? 'Sent' : 'Recieved'}</span>
                                    <span className="font-medium text-white">{tx.amount}</span>
                                    <span>{tx.type === 'sent' ? 'to' : 'from'}</span>
                                    <span className="text-white truncate" style={{ maxWidth: '100px' }}>{tx.addr}</span>
                                </div>
                                <div className="text-gray-500 whitespace-nowrap text-right">{tx.time}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Subcription Modal Overlay (Simulated Absolute Position) */}
                {isAlertModalOpen && (
                    <div className="fixed inset-0 sm:absolute sm:inset-auto sm:top-1/2 sm:left-1/2 sm:transform sm:-translate-x-1/2 sm:-translate-y-1/2 w-full h-full sm:h-auto sm:w-[400px] bg-black/80 sm:bg-[#0A0A0A] sm:border border-white/10 sm:rounded-[20px] p-6 shadow-2xl z-50 flex flex-col justify-end sm:justify-start sm:block backdrop-blur-sm sm:backdrop-blur-none">
                        <div className="bg-[#0A0A0A] w-full p-6 sm:p-0 rounded-t-[24px] sm:rounded-none -mx-6 -mb-6 sm:mx-0 sm:mb-0 border-t border-white/10 sm:border-none">
                            <h4 className="font-medium text-[15px] mb-4">Subscribe to live notifications for this wallet</h4>
                            
                            <div className="bg-[#1F1F1F] rounded-[10px] p-3 mb-4">
                                <span className="text-gray-300 text-sm break-all">
                                    {account?.address || "No wallet connected"}
                                </span>
                            </div>
                            
                            <p className="text-xs text-gray-500 mb-8">You can subscribe to up to 3 wallets</p>
                            
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0 mt-auto">
                                <button className="w-full sm:w-auto bg-[#10B981] hover:bg-[#059669] text-white px-5 py-3 sm:py-2 rounded-full text-sm font-medium transition-colors order-1 sm:order-2">
                                    Confirm
                                </button>
                                <button 
                                    onClick={() => setIsAlertModalOpen(false)}
                                    className="w-full sm:w-auto text-[#EF4444] text-sm font-medium hover:text-red-400 transition-colors order-2 sm:order-1 py-2 sm:py-0">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
        </div>
      </div>
    </div>
  );
}
