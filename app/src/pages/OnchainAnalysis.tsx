import { useState, useEffect } from "react";
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
import { useActivity } from "@/hooks/useActivity";
import { sileo } from "sileo";
import { 
  AreaChart, 
  Area,
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

export default function OnchainAnalysis() {
  const account = useCurrentAccount();
  const address = account?.address || null;
  const [displayAddress, setDisplayAddress] = useState(address);
  const { activity, isFetchingActivity, fetchActivity } = useActivity(displayAddress);

  const { walletBalanceUSD, tokens } = useOutletContext<LayoutContextType>();
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);
  const [isRecentTxModalOpen, setIsRecentTxModalOpen] = useState(false);
  
  const [selectedTimeframe, setSelectedTimeframe] = useState<"24h" | "7D" | "30D">("7D");
  const [performanceData, setPerformanceData] = useState<any[]>([]);
  const [isFetchingPerformance, setIsFetchingPerformance] = useState(false);
  const [searchAddress, setSearchAddress] = useState("");
  const [portfolioChange, setPortfolioChange] = useState({ value: 0, isPositive: true });

  useEffect(() => {
    if (displayAddress) {
      fetchActivity();
    }
  }, [displayAddress, fetchActivity]);

  // Fetch performance data
  useEffect(() => {
    const fetchPerformance = async () => {
      if (!address || !tokens || tokens.length === 0) return;
      
      setIsFetchingPerformance(true);
      try {
        const days = selectedTimeframe === "24h" ? 1 : selectedTimeframe === "7D" ? 7 : 30;
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/sui/market_chart?vs_currency=usd&days=${days}&interval=${selectedTimeframe === "24h" ? "hourly" : "daily"}`
        );
        const data = await res.json();
        
        if (!data.prices) throw new Error("No price data");

        // Get SUI balance
        const suiToken = tokens.find(t => t.symbol === "SUI");
        const currentBalance = suiToken ? suiToken.balance : 0;

        // Process prices and reconstruct historical balances
        // For simplicity, we assume other tokens are negligible or stable for now, 
        // as we only have SUI historical data easily accessible.
        
        const chartData = data.prices.map(([timestamp, price]: [number, number]) => {
          // Find transactions that happened AFTER this timestamp
          const futureTxs = activity.filter(tx => tx.timestampMs && Number(tx.timestampMs) > timestamp);
          
          // Reverse transactions to get balance at this timestamp
          let historicalBalance = currentBalance;
          futureTxs.forEach(tx => {
             // If we received SUI in the future, we had LESS in the past
             // If we sent SUI in the future, we had MORE in the past
             historicalBalance -= tx.netSUI;
          });

          return {
            name: new Date(timestamp).toLocaleDateString(undefined, { 
              month: 'short', 
              day: 'numeric',
              hour: selectedTimeframe === "24h" ? '2-digit' : undefined
            }),
            value: Number((historicalBalance * price).toFixed(2)),
            timestamp
          };
        });

        setPerformanceData(chartData);

        // Calculate timeframe change
        if (chartData.length > 1) {
          const latest = chartData[chartData.length - 1].value;
          const first = chartData[0].value;
          const change = first !== 0 ? ((latest - first) / first) * 100 : 0;
          setPortfolioChange({ value: Math.abs(change), isPositive: change >= 0 });
        }
      } catch (err) {
        console.error("Failed to fetch performance:", err);
      } finally {
        setIsFetchingPerformance(false);
      }
    };

    fetchPerformance();
  }, [displayAddress, tokens, activity, selectedTimeframe]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sileo.success({ title: "Copied", description: "Copied to clipboard!" });
    } catch (err) {
      console.error("Failed to copy:", err);
      sileo.error({ title: "Error", description: "Failed to copy to clipboard" });
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] text-white p-6 md:p-8">
      <div className="max-w-[1200px] mx-auto space-y-6">
        
         {/* Header Row */}
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
            <h1 className="text-md md:text-2xl font-bold tracking-tight text-center">
              Portfolio Dashboard
            </h1>
            <div className="flex items-center gap-5 sm:ml-2">
              <div className="flex items-center gap-2 text-gray-300 text-sm">
                <span className="truncate max-w-[120px] sm:max-w-none text-center">
                  {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : "No wallet connected"}
                </span>
                {displayAddress && (
                  <button 
                    onClick={() => copyToClipboard(displayAddress)}
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
            {/* <div className="flex items-center bg-[#0A0A0A] border border-white/10 rounded-full p-1 w-full sm:w-auto overflow-x-auto whitespace-nowrap">
              <button className="flex-1 sm:flex-none px-5 py-1.5 rounded-full text-gray-400 hover:text-white text-sm font-medium transition-colors">
                SUI
              </button>
              <button className="flex-1 sm:flex-none px-5 py-1.5 rounded-full bg-white/5 border border-[#B7FC0D]/50 text-white text-sm font-medium transition-colors">
                USD
              </button>
            </div> */}

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
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setDisplayAddress(searchAddress)}
                placeholder="Enter a SUI address"
                className="block w-full pl-10 pr-10 py-2.5 bg-[#141414] border border-white/10 rounded-full text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-500"
              />
              {searchAddress && (
                <button 
                  onClick={() => setSearchAddress("")}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              {/* Analyze Button */}
              <button 
                onClick={() => setDisplayAddress(searchAddress)}
                disabled={!searchAddress.startsWith("0x")}
                className="flex-1 sm:flex-none bg-[#3B82F6] hover:bg-[#2563EB] text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
              >
                Analyze wallet
              </button>

              {/* Refresh Button */}
              <button 
                onClick={() => fetchActivity()}
                disabled={isFetchingActivity}
                className="p-2.5 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-white/5 border border-transparent flex-shrink-0 bg-[#0A0A0A] sm:bg-transparent border-white/10 sm:border-transparent"
              >
                <RefreshCw size={18} className={isFetchingActivity ? "animate-spin" : ""} />
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
                <span className="text-gray-400 text-sm">{selectedTimeframe === "24h" ? "24h" : selectedTimeframe === "7D" ? "7 days" : "30 days"} change</span>
                <span className={`font-medium text-sm ${portfolioChange.isPositive ? "text-emerald-400" : "text-rose-500"}`}>
                  {portfolioChange.isPositive ? "+" : "-"}{portfolioChange.value.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Portfolio Performance */}
          <div className="lg:col-span-4 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 relative min-h-[160px] h-[220px] lg:h-auto flex flex-col">
            <h3 className="text-gray-300 font-medium whitespace-nowrap mb-4">
              Portfolio performance
            </h3>
            <div className="absolute right-6 top-6 flex items-center gap-3 text-xs font-mono z-10">
              {(["24h", "7D", "30D"] as const).map((tf) => (
                <button 
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`transition-colors px-1.5 rounded ${selectedTimeframe === tf ? 'text-[#B7FC0D] bg-white/10' : 'text-gray-500 hover:text-white'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
            
            <div className="flex-1 w-full min-h-[120px]">
                {isFetchingPerformance ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <RefreshCw size={24} className="text-gray-600 animate-spin" />
                    </div>
                ) : performanceData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={performanceData}>
                            <defs>
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34D399" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#34D399" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                itemStyle={{ color: '#34D399' }}
                                labelStyle={{ color: '#9CA3AF' }}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="value" 
                                stroke="#34D399" 
                                fillOpacity={1} 
                                fill="url(#colorValue)" 
                                strokeWidth={2}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                        Insufficient data
                    </div>
                )}
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
            <div className="lg:col-span-4 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 min-h-[220px] h-auto overflow-hidden flex flex-col">
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

                <div className="space-y-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 flex-1">
                    <div className="min-w-[500px] space-y-5">
                        {isFetchingActivity && activity.length === 0 ? (
                            /* Skeleton */
                            <div className="space-y-5">
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="flex items-center gap-4 animate-pulse">
                                        <div className="w-5 h-5 bg-white/5 rounded-full" />
                                        <div className="w-6 h-6 bg-white/5 rounded-full" />
                                        <div className="h-4 bg-white/5 rounded-full flex-1" />
                                        <div className="w-20 h-4 bg-white/5 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        ) : activity.length > 0 ? (
                            <>
                                {activity.slice(0, 10).map((tx, i) => (
                                    <TransactionRow key={i} tx={tx} />
                                ))}
                                {activity.length > 10 && (
                                    <button 
                                        onClick={() => setIsRecentTxModalOpen(true)}
                                        className="w-full py-3 mt-2 text-sm text-[#3B82F6] hover:text-[#2563EB] font-medium transition-colors border-t border-white/5"
                                    >
                                        See all transactions
                                    </button>
                                )}
                            </>
                        ) : (
                            <div className="text-center py-10 text-gray-500 text-sm">
                                No recent transactions found
                            </div>
                        )}
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
                                <button 
                                    onClick={() => {
                                        sileo.success({ title: "Subscribed", description: "You will now receive alerts for this wallet." });
                                        setIsAlertModalOpen(false);
                                    }}
                                    className="w-full sm:w-auto bg-[#10B981] hover:bg-[#059669] text-white px-5 py-3 sm:py-2 rounded-full text-sm font-medium transition-colors order-1 sm:order-2">
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

                {/* All Transactions Modal */}
                {isRecentTxModalOpen && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <div className="bg-[#0A0A0A] border border-white/10 rounded-[24px] w-full max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden">
                            <div className="p-6 border-b border-white/10 flex items-center justify-between">
                                <h3 className="text-lg font-bold">Recent Transactions</h3>
                                <button 
                                    onClick={() => setIsRecentTxModalOpen(false)}
                                    className="p-2 text-gray-400 hover:text-white transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto space-y-4">
                                {activity.map((tx, i) => (
                                    <TransactionRow key={i} tx={tx} />
                                ))}
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

function TransactionRow({ tx }: { tx: any }) {
    const absAmount = Math.abs(tx.netSUI || 0);
    const amountStr = `${absAmount.toFixed(4)} SUI`;
    const addr = tx.txType === 'sent' ? 'to' : tx.txType === 'received' ? 'from' : 'with';
    const displayAddr = tx.digest ? tx.digest.slice(0, 10) + "..." : "Unknown";

    return (
        <a 
            href={`https://suiscan.xyz/testnet/tx/${tx.digest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 text-sm group hover:bg-white/5 p-1 rounded-lg transition-colors"
        >
            <div className="w-5 flex justify-center flex-shrink-0">
                {tx.txType === 'received' ? (
                    <ArrowDownLeft className="text-[#34D399]" size={16} />
                ) : (
                    <ArrowUpRight className="text-[#EF4444]" size={16} />
                )}
            </div>
            <div className="w-6 h-6 rounded-full bg-[#1A1A1A] flex items-center justify-center border border-[#3B82F6]/30 flex-shrink-0">
                <div className="w-4 h-4 rounded-full bg-[#3B82F6] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">S</span>
                </div>
            </div>
            <div className="flex flex-1 items-center gap-2 text-gray-300 min-w-[200px]">
                <span className="capitalize">{tx.txType}</span>
                <span className="font-medium text-white">{amountStr}</span>
                <span>{addr}</span>
                <span className="text-white truncate" style={{ maxWidth: '100px' }}>{displayAddr}</span>
            </div>
            <div className="text-gray-500 whitespace-nowrap text-right">
                {tx.timestampMs ? new Date(Number(tx.timestampMs)).toLocaleDateString() : '—'}
            </div>
        </a>
    );
}
