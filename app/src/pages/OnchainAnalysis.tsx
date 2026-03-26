import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  Search,
  ChevronDown,
  RefreshCw,
  Copy,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  ChevronLeft,
  Trash2,
  Plus
} from "lucide-react";
import { useActivity } from "@/hooks/useActivity";
import { useTokens } from "@/hooks/useTokens";
import { useProfile } from "@/hooks/useProfile";
import { sileo } from "sileo";
import { 
  AreaChart, 
  Area,
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { SkeletonBox } from "@/components/ui/SkeletonLoader";

export default function OnchainAnalysis() {
  const account = useCurrentAccount();
  const address = account?.address || null;
  const [viewedWallet, setViewedWallet] = useState<string | null>(null);
  const effectiveAddress = viewedWallet || address;
  const { activity, isFetchingActivity, fetchActivity } = useActivity(effectiveAddress);

  const { walletBalanceUSD, tokens, isFetchingTokens } = useTokens(effectiveAddress);
  const { profile, refetch: refetchProfile } = useProfile();

  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);
  const [isRecentTxModalOpen, setIsRecentTxModalOpen] = useState(false);
  
  const [selectedTimeframe, setSelectedTimeframe] = useState<"24h" | "7D" | "30D">("7D");
  const [performanceData, setPerformanceData] = useState<any[]>([]);
  const [isFetchingPerformance, setIsFetchingPerformance] = useState(false);
  const [searchAddress, setSearchAddress] = useState("");
  const [portfolioChange, setPortfolioChange] = useState({ value: 0, isPositive: true });

  const [isRecentlyAnalyzedOpen, setIsRecentlyAnalyzedOpen] = useState(false);
  const [isSearchSuggestionsOpen, setIsSearchSuggestionsOpen] = useState(false);
  const [isAlertManagerView, setIsAlertManagerView] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const recentlyAnalyzedRef = useRef<HTMLDivElement>(null);
  const networkDropdownRef = useRef<HTMLDivElement>(null);
  const addressToSaveRef = useRef<string | null>(null);
  
  // Reset scroll to top when switching views
  useEffect(() => {
    // We need to target the specific scroll container from Layout.tsx which has h-dvh and overflow-y-auto
    const resetScroll = () => {
      window.scrollTo(0, 0);
      const mainContainer = document.querySelector('.h-dvh.overflow-y-auto');
      if (mainContainer) {
        mainContainer.scrollTop = 0;
      }
    };

    // Initial jump
    resetScroll();
    
    // Safety check with requestAnimationFrame to ensure the jump happens after the render
    const frame = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frame);
  }, [isAlertManagerView]);

  const recentlyAnalyzedMenuRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const searchSuggestionsMenuRef = useRef<HTMLDivElement>(null);

  const [shouldRenderRecentlyAnalyzed, setShouldRenderRecentlyAnalyzed] = useState(false);
  const [shouldRenderNetwork, setShouldRenderNetwork] = useState(false);
  const [shouldRenderSearchSuggestions, setShouldRenderSearchSuggestions] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsSearchSuggestionsOpen(false);
      }
      if (recentlyAnalyzedRef.current && !recentlyAnalyzedRef.current.contains(target)) {
        setIsRecentlyAnalyzedOpen(false);
      }
      if (networkDropdownRef.current && !networkDropdownRef.current.contains(target)) {
        setIsNetworkDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async (addr: string) => {
    if (!addr || !addr.startsWith("0x")) return;
    setViewedWallet(addr);
    setIsRecentlyAnalyzedOpen(false);
    setIsSearchSuggestionsOpen(false);
    setSearchAddress(addr); // Autofill
    
    // Set ref to trigger save after data finishes loading
    if (address && addr !== address) {
      addressToSaveRef.current = addr;
    }
  };

  useEffect(() => {
    if (effectiveAddress) {
      fetchActivity();
    }
  }, [effectiveAddress, fetchActivity]);

  // Save recently analyzed address after successful fetch
  useEffect(() => {
    if (addressToSaveRef.current && !isFetchingTokens && !isFetchingActivity) {
      const addr = addressToSaveRef.current;
      addressToSaveRef.current = null; // Prevent duplicate saves

      (async () => {
        try {
          const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
          await fetch(`${baseUrl}/api/user/recently-analyzed`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: addr })
          });
          refetchProfile();
        } catch (err) {
          console.error("Failed to add recently analyzed:", err);
        }
      })();
    }
  }, [isFetchingTokens, isFetchingActivity, refetchProfile]);

  // Animate Recently Analyzed Dropdown (Top Right)
  useEffect(() => {
    if (isRecentlyAnalyzedOpen) setShouldRenderRecentlyAnalyzed(true);
  }, [isRecentlyAnalyzedOpen]);

  useGSAP(() => {
    if (isRecentlyAnalyzedOpen && recentlyAnalyzedMenuRef.current) {
      gsap.fromTo(recentlyAnalyzedMenuRef.current,
        { opacity: 0, scale: 0.95, y: -10, transformOrigin: "top right" },
        { opacity: 1, scale: 1, y: 0, duration: 0.2, ease: "power2.out" }
      );
    } else if (!isRecentlyAnalyzedOpen && recentlyAnalyzedMenuRef.current) {
      gsap.to(recentlyAnalyzedMenuRef.current, {
        opacity: 0, scale: 0.95, y: -10, duration: 0.15, ease: "power2.in",
        onComplete: () => setShouldRenderRecentlyAnalyzed(false)
      });
    }
  }, [isRecentlyAnalyzedOpen, shouldRenderRecentlyAnalyzed]);

  // Animate Network Dropdown
  useEffect(() => {
    if (isNetworkDropdownOpen) setShouldRenderNetwork(true);
  }, [isNetworkDropdownOpen]);

  useGSAP(() => {
    if (isNetworkDropdownOpen && networkMenuRef.current) {
      gsap.fromTo(networkMenuRef.current,
        { opacity: 0, scale: 0.95, y: -10, transformOrigin: "top left" },
        { opacity: 1, scale: 1, y: 0, duration: 0.2, ease: "power2.out" }
      );
    } else if (!isNetworkDropdownOpen && networkMenuRef.current) {
      gsap.to(networkMenuRef.current, {
        opacity: 0, scale: 0.95, y: -10, duration: 0.15, ease: "power2.in",
        onComplete: () => setShouldRenderNetwork(false)
      });
    }
  }, [isNetworkDropdownOpen, shouldRenderNetwork]);

  // Animate Search Suggestions
  useEffect(() => {
    if (isSearchSuggestionsOpen) setShouldRenderSearchSuggestions(true);
  }, [isSearchSuggestionsOpen]);

  useGSAP(() => {
    if (isSearchSuggestionsOpen && searchSuggestionsMenuRef.current) {
      gsap.fromTo(searchSuggestionsMenuRef.current,
        { opacity: 0, scale: 0.95, y: -10, transformOrigin: "top left" },
        { opacity: 1, scale: 1, y: 0, duration: 0.2, ease: "power2.out" }
      );
    } else if (!isSearchSuggestionsOpen && searchSuggestionsMenuRef.current) {
      gsap.to(searchSuggestionsMenuRef.current, {
        opacity: 0, scale: 0.95, y: -10, duration: 0.15, ease: "power2.in",
        onComplete: () => setShouldRenderSearchSuggestions(false)
      });
    }
  }, [isSearchSuggestionsOpen, shouldRenderSearchSuggestions]);

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
  }, [effectiveAddress, tokens, activity, selectedTimeframe]);

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
    <div className="min-h-screen bg-[#000000] text-white p-6 md:p-8 pt-14 md:pt-8">
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 sm:gap-4 w-full">
          <div className="flex flex-col sm:flex-row items-center text-center sm:text-left gap-2 sm:gap-4 w-full sm:w-auto">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight flex flex-col sm:flex-row items-center sm:items-baseline">
              <span>Portfolio Dashboard</span>
              {isAlertManagerView && <span className="text-gray-400 font-light text-sm sm:text-lg sm:ml-3">/ Alert Manager</span>}
            </h1>
            
            {!isAlertManagerView && (
              <>
                {viewedWallet && (
                  <span className="bg-[#253203] text-[#B7FC0D] px-4 py-2 rounded-full text-[13px]  ml-1">
                    View only
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-400">
                    {effectiveAddress ? `${effectiveAddress.slice(0, 10)}...${effectiveAddress.slice(-6)}` : "No wallet connected"}
                  </span>
                  {effectiveAddress && (
                    <button 
                      onClick={() => copyToClipboard(effectiveAddress)}
                      className="text-gray-600 hover:text-white transition-colors"
                    >
                      <Copy size={13} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          
          <div className="w-full sm:w-auto flex flex-col items-center sm:items-end gap-2 sm:gap-4 md:pr-20">
            {isAlertManagerView ? (
              <button 
                onClick={() => setIsAlertManagerView(false)}
                className="flex items-center gap-2 bg-[#0A0A0A] sm:bg-transparent hover:bg-[#141414] sm:hover:bg-transparent border border-white/10 sm:border-transparent px-5 py-2 sm:px-0 rounded-full sm:rounded-none text-sm font-medium transition-all order-first sm:order-none mb-2 sm:mb-0 hover:text-white"
              >
                <ChevronLeft size={16} /> Back to Dashboard
              </button>
            ) : (
                <>
                {/* Recently Analyzed Dropdown Button */}
                <div className="relative" ref={recentlyAnalyzedRef}>
                  <button 
                    onClick={() => setIsRecentlyAnalyzedOpen(!isRecentlyAnalyzedOpen)}
                    className="flex items-center gap-2 bg-[#0A0A0A] hover:bg-[#141414] border border-white/10 px-5 py-2 rounded-full text-sm font-medium transition-all"
                  >
                    Recently analysed <ChevronDown size={14} className={`text-gray-500 transition-transform ${isRecentlyAnalyzedOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {shouldRenderRecentlyAnalyzed && profile?.recently_analyzed && profile.recently_analyzed.length > 0 && (
                    <div ref={recentlyAnalyzedMenuRef} className="absolute top-full left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 mt-2 w-[280px] sm:w-64 bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[70] p-1.5">
                      {profile.recently_analyzed.map((addr: string, idx: number) => (
                        <button 
                          key={idx}
                          onClick={() => {
                            handleSearch(addr);
                          }}
                          className="w-full text-left px-4 py-4 sm:py-3 text-sm text-white hover:bg-white/5 transition-colors flex items-center justify-between rounded-xl group"
                        >
                          <span className="font-mono text-xs text-white/80 group-hover:text-white transition-colors">{addr.slice(0, 12)}...{addr.slice(-4)}</span>
                          <span className="text-[10px] text-gray-500 italic font-light opacity-60">Recently analyzed</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {viewedWallet && (
                  <button 
                    onClick={() => {
                      setViewedWallet(null);
                      setSearchAddress("");
                    }}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    <ChevronLeft size={16} /> Back to my wallet
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {!isAlertManagerView && (
          <>
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
            <div className="relative" ref={networkDropdownRef}>
              <button 
                onClick={() => setIsNetworkDropdownOpen(!isNetworkDropdownOpen)}
                className="flex items-center justify-between w-full sm:w-auto gap-2 bg-[#0A0A0A] border border-white/10 px-4 py-2 rounded-full hover:bg-white/5 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20 whitespace-nowrap"
              >
                <span className="text-sm">Testnet</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${isNetworkDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {shouldRenderNetwork && (
                <div ref={networkMenuRef} className="absolute top-full left-0 mt-2 w-full sm:w-36 bg-[#0A0A0A] border border-white/10 rounded-xl shadow-xl overflow-hidden z-20">
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
             <div className="flex-1 relative w-full" ref={dropdownRef}>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={16} className="text-gray-400" />
              </div>
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                onFocus={() => setIsSearchSuggestionsOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch(searchAddress);
                }}
                placeholder="Enter a SUI address"
                className="block w-full pl-11 pr-10 py-2.5 bg-[#0A0A0A] border border-white/10 rounded-full text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-500 shadow-inner"
              />
              {searchAddress && (
                <button 
                  onClick={() => setSearchAddress("")}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              )}
              {shouldRenderSearchSuggestions && profile?.recently_analyzed && profile.recently_analyzed.length > 0 && (
                <div ref={searchSuggestionsMenuRef} className="absolute top-full left-0 mt-2 w-full bg-[#0A0A0A] border border-white/10 rounded-xl shadow-xl overflow-hidden z-[60]">
                  <div className="py-2">
                    <div className="px-4 py-1 text-xs text-gray-500 font-medium">Recently Analyzed</div>
                    {profile.recently_analyzed.map((addr: string, idx: number) => (
                      <button 
                        key={idx}
                        onClick={() => {
                          handleSearch(addr);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5 transition-colors font-mono"
                      >
                        {addr.slice(0, 6)}...{addr.slice(-4)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              {/* Analyze Button */}
              <button 
                onClick={() => handleSearch(searchAddress)}
                disabled={!searchAddress.startsWith("0x")}
                className="flex-1 sm:flex-none bg-[#246AFC] hover:bg-[#1C54CB] text-white px-8 py-2.5 rounded-full text-sm font-bold transition-all shadow-lg active:scale-95 whitespace-nowrap disabled:opacity-50"
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
          <div className="lg:col-span-3 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-8 flex flex-col items-center justify-between min-h-[220px]">
            <h3 className="text-gray-500 font-medium text-sm uppercase tracking-wider">Portfolio value</h3>
            <div className="flex-1 flex flex-col items-center justify-center py-4">
              {isFetchingTokens ? (
                <SkeletonBox className="h-12 w-32" />
              ) : (
                <div className="text-5xl font-bold text-white tracking-tight">${walletBalanceUSD || "0.00"}</div>
              )}
            </div>
            {isFetchingTokens ? (
              <SkeletonBox className="h-6 w-24 rounded-full" />
            ) : (
              <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/5">
                <span className="text-gray-500 text-xs font-medium">{selectedTimeframe === "24h" ? "24h" : selectedTimeframe === "7D" ? "7D" : "30D"}</span>
                <div className={`h-3 w-[1px] bg-white/10`} />
                <span className={`font-bold text-xs ${portfolioChange.isPositive ? "text-[#34D399]" : "text-rose-500"}`}>
                  {portfolioChange.isPositive ? "+" : "-"}{portfolioChange.value.toFixed(2)}%
                </span>
              </div>
            )}
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
                {isFetchingPerformance || isFetchingTokens ? (
                    <div className="w-full h-full">
                        <SkeletonBox className="w-full h-full rounded-xl" />
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
               {isFetchingTokens ? (
                   <SkeletonBox className="w-full h-full rounded-full" />
               ) : (
                   /* Pure CSS Donut Chart */
                   <div className="w-full h-full rounded-full bg-[#1A1A1A] relative"
                        style={{
                            background: 'conic-gradient(#B7FC0D 0% 25%, #3B82F6 25% 100%)'
                        }}>
                        <div className="absolute inset-4 rounded-full bg-[#000000] flex flex-col items-center justify-center">
                            <span className="text-xl font-bold">60%</span>
                            <span className="text-xs text-gray-400">SUI</span>
                        </div>
                   </div>
               )}
            </div>

            {/* Distribution Bars */}
            <div className="w-full sm:flex-1 sm:ml-8 space-y-5">
                {isFetchingTokens ? (
                    [...Array(3)].map((_, i) => (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                            <SkeletonBox className="w-24 h-4" />
                            <SkeletonBox className="flex-1 h-6 rounded-full" />
                        </div>
                    ))
                ) : (
                    [
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
                    ))
                )}
            </div>

          </div>
        </div>

        {/* Bottom Cards Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2 items-start">
            
            {/* Other assets */}
            <div className="lg:col-span-4 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 min-h-[220px] h-auto overflow-hidden flex flex-col">
                <h3 className="text-gray-300 font-medium mb-6">Other assets</h3>
                <div className="space-y-6 overflow-y-auto no-scrollbar flex-1">
                    {isFetchingTokens ? (
                        [...Array(4)].map((_, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <SkeletonBox className="w-8 h-8 rounded-full" />
                                    <SkeletonBox className="h-4 w-20" />
                                </div>
                                <SkeletonBox className="h-4 w-16" />
                            </div>
                        ))
                    ) : tokens && tokens.length > 0 ? (
                        tokens.map((token, i) => (
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
                                <div className="text-sm font-medium text-white">{token.symbol}</div>
                            </div>
                            <div className="text-sm font-bold text-white">${token.value?.toFixed(2)}</div>
                        </div>
                    ))) : (
                        <div className="text-center py-4 text-gray-500 text-xs">No assets found</div>
                    )}
                </div>
            </div>

            {/* Recent transactions */}
            <div className="lg:col-span-8 bg-[#0A0A0A] border border-white/10 rounded-[20px] p-6 relative min-h-[400px] sm:min-h-[500px] h-auto flex flex-col">
                <div className="flex items-center justify-between mb-4 sm:mb-6 w-full">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3">
                        <h3 className="text-gray-300 font-medium text-sm sm:text-base">Recent transactions</h3>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6">
                      <button 
                           onClick={() => setIsAlertManagerView(true)}
                           className="text-[#246AFC] hover:text-[#1C54CB] text-[12px] sm:text-sm font-medium transition-colors">
                          Manage alerts
                      </button>
                      {viewedWallet && (
                        <button 
                             onClick={() => setIsAlertModalOpen(true)}
                             className="bg-[#246AFC] hover:bg-[#1C54CB] text-white px-5 py-2 rounded-full text-sm font-bold transition-all shadow-lg active:scale-95">
                            Enable Live alerts
                        </button>
                      )}
                    </div>
                </div>

                <div className="space-y-3 sm:space-y-5 overflow-x-auto sm:overflow-x-visible pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 flex-1">
                    <div className="w-full space-y-3 sm:space-y-5">
                        {isFetchingActivity ? (
                            /* Skeleton */
                            <div className="space-y-3 sm:space-y-5">
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="flex items-center gap-4 py-1">
                                        <SkeletonBox className="w-5 h-5 rounded-full" />
                                        <SkeletonBox className="w-6 h-6 rounded-full" />
                                        <SkeletonBox className="h-4 flex-1 rounded-full" />
                                        <SkeletonBox className="w-20 h-4 rounded-full" />
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
        </>
      )}

      {/* Alert Manager Full-Screen View */}
      {isAlertManagerView && (
        <AlertManagerPage 
          alertWallets={profile?.alert_wallets || []}
        />
      )}
    </div>
  </div>
);
}

function AlertManagerPage({ alertWallets }: { alertWallets: string[] }) {
  const [isAddWalletOpen, setIsAddWalletOpen] = useState(false);

  return (
    <div className="pt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        
        <div className="w-full lg:w-[45%] space-y-6">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-white text-lg font-medium">Tracked wallets</h3>
            <div className="relative">
              <button 
                onClick={() => setIsAddWalletOpen(!isAddWalletOpen)}
                className="bg-[#246AFC] hover:bg-[#1C54CB] text-white px-6 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 shadow-lg active:scale-95"
              >
                <Plus size={16} /> Add wallet
              </button>

              {isAddWalletOpen && (
                <div className="absolute top-full right-0 mt-3 w-80 bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl z-50 p-6 animate-in zoom-in-95 duration-200 origin-top-right">
                  <h4 className="text-sm font-medium mb-3 text-center">Enter a wallet to subscribe to live alerts</h4>
                  <div className="bg-[#141414] rounded-xl p-3 mb-4 border border-white/5">
                    <input 
                      type="text" 
                      placeholder="0x..." 
                      className="w-full bg-transparent border-none focus:outline-none text-xs text-white"
                    />
                  </div>
                  <p className="text-[10px] text-gray-600 text-center mb-6">You can subscribe to up to 3 wallets</p>
                  <div className="flex items-center justify-between gap-4">
                    <button onClick={() => setIsAddWalletOpen(false)} className="text-rose-500 text-xs font-medium px-2">Cancel</button>
                    <button className="flex-1 bg-[#246AFC] text-white py-2.5 rounded-full text-xs font-bold transition-all active:scale-95">Subscribe</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] p-6 space-y-0 divide-y divide-white/5">
            {alertWallets.length > 0 ? alertWallets.map((wallet, idx) => (
              <div key={idx} className="py-6 first:pt-0 last:pb-0 group">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-sm text-white/90 truncate mr-4">{wallet}</span>
                  <button className="text-rose-500/40 hover:text-rose-500 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-white/40">Last activity: 2 minutes ago</span>
                  <button className="text-[#246AFC] hover:underline font-bold transition-colors">View</button>
                </div>
              </div>
            )) : (
              [1, 2, 3].map((_, i) => (
                <div key={i} className="py-6 first:pt-0 last:pb-0 group">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-mono text-sm text-white/90 truncate mr-4">0x1a2...{i}</span>
                    <button className="text-rose-500/40 hover:text-rose-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-white/40">Last activity: 2 minutes ago</span>
                    <button className="text-[#246AFC] hover:underline font-bold transition-colors">View</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="w-full lg:w-[55%] space-y-6">
          <h3 className="text-white text-xl font-medium mb-8 ">Recent alerts</h3>
          <div className="bg-[#0A0A0A] border border-white/10 rounded-[32px] p-6 space-y-6 h-full min-h-[500px]">
            {[
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
              { type: 'sent', amount: '10 USDC', to: '0x1a2B3C4d5E6f...', time: '2 minutes ago' },
            ].map((alert, idx) => (
              <div key={idx} className="flex items-center justify-between group">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <ArrowUpRight className="text-rose-500 shrink-0" size={18} />
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                    <img src="/assets/icons/sui.svg" className="w-5 h-5 opacity-40 grayscale" alt="SUI" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm min-w-0">
                    <span className="text-gray-400 capitalize">{alert.type}</span>
                    <span className="font-bold text-white whitespace-nowrap">{alert.amount}</span>
                    <span className="text-gray-500">to</span>
                    <span className="font-mono text-white/70 truncate max-w-[120px]">{alert.to}</span>
                    <span className="text-gray-500 ml-2 whitespace-nowrap">{alert.time}</span>
                  </div>
                </div>
                <button className="text-[#246AFC] hover:underline text-sm font-bold ml-4 shrink-0 transition-colors">View</button>
              </div>
            ))}
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
    const displayAddr = tx.digest ? tx.digest.slice(0, 8) + "..." : "Unknown";

    return (
        <a 
            href={`https://suiscan.xyz/testnet/tx/${tx.digest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 sm:gap-4 text-sm group hover:bg-white/5 p-1.5 sm:p-2 rounded-xl transition-all border border-transparent hover:border-white/5"
        >
            <div className="w-5 flex justify-center flex-shrink-0">
                {tx.txType === 'received' ? (
                    <ArrowDownLeft className="text-[#34D399]" size={16} />
                ) : (
                    <ArrowUpRight className="text-[#EF4444]" size={16} />
                )}
            </div>
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                <div className="w-6 h-6 flex items-center justify-center">
                    <img src="/assets/icons/sui.svg" className="w-full h-full object-contain" alt="SUI" />
                </div>
            </div>
            <div className="flex flex-1 flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="capitalize font-medium text-white/90 truncate">{tx.txType}</span>
                    <span className="font-bold text-white whitespace-nowrap">{amountStr}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400 text-xs sm:text-sm min-w-0">
                    <span className="hidden sm:inline">{addr}</span>
                    <span className="text-white/60 font-mono truncate">{displayAddr}</span>
                    <span className="text-gray-600 sm:text-gray-500 ml-auto sm:ml-0 whitespace-nowrap">
                        {tx.timestampMs ? new Date(Number(tx.timestampMs)).toLocaleDateString(undefined, { 
                            month: 'short', 
                            day: 'numeric' 
                        }) : '—'}
                    </span>
                </div>
            </div>
        </a>
    );
}
