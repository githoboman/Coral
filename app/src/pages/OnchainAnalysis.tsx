
import React, { useState, useEffect, useMemo } from 'react';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Search, Copy, Wallet, AlertTriangle, Sparkles, Layers, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useZkLogin } from '@/hooks/useZkLogin';
import { toast } from 'react-toastify';
import { useWalletOverview, useWalletStats, useWalletNFTs } from '@/hooks/useAnalytics';

// --- Types ---
type Network = 'mainnet' | 'testnet';
type ProfilerType = 'wallet' | 'token' | 'nft' | 'unknown';

interface ProfilerData {
   type: ProfilerType;
   id: string; // Address, CoinType, or NFT ID
   data: any;
}

// --- Component ---
export default function OnchainAnalysis() {
   // Auth
   const auth = useAuth();
   const zkLogin = useZkLogin();
   const connectedAddress = auth.address || zkLogin.address;

   // State
   const [network] = useState<Network>('mainnet');
   const [searchQuery, setSearchQuery] = useState('');
   const [activeProfile, setActiveProfile] = useState<ProfilerData | null>(null);
   const [activeTab, setActiveTab] = useState('Overview');
   const [suiPrice, setSuiPrice] = useState<{ price: number, change24h: number } | null>(null);
   const [selectedDate, setSelectedDate] = useState<Date | null>(null);

   // Analytics hooks for real data
   const { data: overviewData, loading: overviewLoading } = useWalletOverview(activeProfile?.type === 'wallet' ? activeProfile.id : null);
   const { data: statsData, loading: statsLoading } = useWalletStats(activeProfile?.type === 'wallet' ? activeProfile.id : null);
   const { data: nftData, loading: nftLoading } = useWalletNFTs(activeProfile?.type === 'wallet' ? activeProfile.id : null);

   const client = useMemo(() => new SuiClient({ url: getFullnodeUrl(network) }), [network]);

   // Load Price Data
   useEffect(() => {
      const fetchPrice = async () => {
         try {
            const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true');
            const data = await res.json();
            if (data.sui) {
               setSuiPrice({ price: data.sui.usd, change24h: data.sui.usd_24h_change });
            }
         } catch (e) {
            console.error("Failed to fetch price", e);
            // Fallback mock
            setSuiPrice({ price: 3.5, change24h: 2.4 });
         }
      };
      fetchPrice();
   }, []);

   // Load default profile (Connected User) on mount or network change
   useEffect(() => {
      if (connectedAddress && !activeProfile) {
         loadProfile('wallet', connectedAddress);
      }
   }, [connectedAddress, network]);

   // --- Search Logic ---
   const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) return;

      const query = searchQuery.trim();

      try {
         // 1. Detect Type
         let type: ProfilerType = 'unknown';
         if (/^0x[a-fA-F0-9]{64}$/.test(query)) type = 'wallet'; // Address is 64 hex chars
         else if (query.includes('::')) type = 'token'; // CoinType often has ::
         // else check if it's a domain or transaction (todo: Transaction profiler if needed, or stick to Entities)

         if (type === 'unknown') {
            // Fallback: Try to fetch object to see if it exists
            const obj = await client.getObject({ id: query });
            if (obj.data) type = 'nft'; // Treat generic objects as NFTs/Entities
            else throw new Error("Could not resolve query.");
         }

         await loadProfile(type, query);
      } catch (err: any) {
         toast.error(err.message || "Search failed");
      }
   };

   const loadProfile = async (type: ProfilerType, id: string) => {
      try {
         let data = null;

         if (type === 'wallet') {
            const [balances, txs, name] = await Promise.all([
               client.getAllBalances({ owner: id }),
               client.queryTransactionBlocks({
                  filter: { FromAddress: id },
                  limit: 200,
                  order: 'descending',
                  options: { showEffects: true, showBalanceChanges: true }
               }),
               client.resolveNameServiceNames({ address: id }).then(n => n.data?.[0] || null).catch(() => null)
            ]);

            // Enrich Data
            data = {
               balances,
               txs: txs.data,
               tags: generateWalletTags(balances, txs.data, !!name),
               suiName: name
            };
         } else if (type === 'token') {
            const metadata = await client.getCoinMetadata({ coinType: id });
            const supply = await client.getTotalSupply({ coinType: id });
            data = { metadata, supply: supply.value };
         }

         setActiveProfile({ type, id, data });
      } catch (e) {
         console.error(e);
         toast.error("Failed to load profile data.");
      }
   };

   const generateWalletTags = (balances: any[], txs: any[], hasName: boolean) => {
      const tags = [];
      const distinctTokens = balances.length;
      const txCount = txs.length;

      if (hasName) tags.push({ label: "SuiNS Owner", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" });
      if (distinctTokens > 10) tags.push({ label: "Diversified", color: "text-green-400 bg-green-500/10" });
      if (txCount >= 20) tags.push({ label: "Power User", color: "text-blue-400 bg-blue-500/10" });
      if (balances.find(b => b.coinType.endsWith('::sui::SUI') && parseInt(b.totalBalance) / 1e9 > 1000)) tags.push({ label: "Sui Whale", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" });
      if (tags.length === 0) tags.push({ label: "Newcomer", color: "text-white/40 bg-white/5" });

      return tags;
   };

   const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard!");
   };

   // --- Renderers ---

   // --- Nansen-style Components ---

   const renderWalletProfile = (profile: ProfilerData) => {
      const { balances, tags, suiName } = profile.data;

      // Use real data from API if available, otherwise fallback to profile data
      const displayBalances = overviewData?.balances || balances;
      const netWorth = overviewData?.total_value_usd || 0;

      const suiBalance = displayBalances.find((b: any) => b.coinType?.endsWith('::sui::SUI') || b.symbol === 'SUI');
      const change24h = suiBalance?.price_change_24h || suiPrice?.change24h || 0;

      // Formatting
      const fmtVal = (val: number) => val.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
      const shortAddr = `${profile.id.slice(0, 6)}...${profile.id.slice(-4)}`;

      const isPositive = change24h >= 0;

      return (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">

            {/* 1. Identity Header */}
            <div className="bg-[#151515] border border-white/10 rounded-xl p-6 relative overflow-hidden group">
               {/* Background Gradient */}
               <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-blue-500/10 to-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 pointer-events-none" />

               <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
                  <div className="flex items-start gap-5">
                     <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#2A2A2A] to-[#1A1A1A] border border-white/10 flex items-center justify-center text-white shadow-xl group-hover:scale-105 transition-transform duration-300">
                        {suiName ? <span className="font-bold text-2xl bg-gradient-to-br from-blue-400 to-purple-400 bg-clip-text text-transparent">SUI</span> : <Wallet className="w-8 h-8 text-white/40" />}
                     </div>
                     <div>
                        <div className="flex items-center gap-3">
                           <h1 className="text-3xl font-bold tracking-tight text-white/90">
                              {suiName || (profile.id === connectedAddress ? 'My Wallet' : 'Unknown Wallet')}
                           </h1>
                           {profile.id === connectedAddress && <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-teal-500/10 text-teal-400 border border-teal-500/20 tracking-wider">You</span>}
                        </div>

                        <div className="flex items-center gap-3 mt-2">
                           <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group/copy" onClick={() => copyToClipboard(profile.id)}>
                              <span className="font-mono text-sm text-white/40 group-hover/copy:text-white/80 transition-colors">{shortAddr}</span>
                              <Copy size={12} className="text-white/20 group-hover/copy:text-white/60" />
                           </div>
                           {/* Add Link to Explorer if needed later */}
                        </div>
                     </div>
                  </div>

                  <div className="text-right">
                     <div className="flex flex-col items-end">
                        <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest mb-1">Estimated Net Worth</p>
                        <h2 className="text-5xl font-bold font-mono tracking-tighter bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">{fmtVal(netWorth)}</h2>
                        <div className={`flex items-center gap-1 mt-2 text-xs font-medium px-2 py-0.5 rounded-full ${isPositive ? 'text-green-400/80 bg-green-500/10' : 'text-red-400/80 bg-red-500/10'}`}>
                           <span>{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
                           <span className="text-white/20">24h</span>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="h-px bg-white/5 my-6" />


               <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                     <span className="text-white/40 text-sm font-medium">Labels</span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                     <div className="flex flex-wrap gap-2">
                        {tags.map((t: any, i: number) => (
                           <div key={i} className={`px-3 py-1 rounded-full text-xs font-bold border border-transparent flex items-center gap-1 ${t.color}`}>
                              {t.label}
                           </div>
                        ))}
                        <button className="px-3 py-1 rounded-full text-xs bg-white/5 border border-white/10 text-white/40 hover:text-white transition-colors">+ Add Label</button>
                     </div>

                     <div className="flex gap-2">
                        <button className="px-4 py-2 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 font-medium text-sm flex items-center gap-2">
                           <AlertTriangle size={14} /> Create Alert
                        </button>
                        <button className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20">
                           <Sparkles size={14} /> Deep Research
                        </button>
                     </div>
                  </div>
               </div>
            </div>

            {/* 2. Navigation Tabs */}
            <div className="flex items-center gap-2 bg-[#151515] p-1 rounded-full w-fit border border-white/10 overflow-x-auto max-w-full">
               {['Overview', 'Transactions', 'PnL', 'NFTs', 'Watchlist'].map((tab) => (
                  <button
                     key={tab}
                     onClick={() => setActiveTab(tab as any)}
                     className={`px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab ? 'bg-white/10 text-white shadow' : 'text-white/40 hover:text-white'}`}
                  >
                     {tab}
                  </button>
               ))}
            </div>

            {/* 3. Main Dashboard Grid */}
            <div className="space-y-6">

               {/* OVERVIEW TAB */}
               {activeTab === 'Overview' && (
                  <>
                     {/* Chart Section */}
                     <div className="bg-[#151515] border border-white/10 rounded-xl p-6 min-h-[300px] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                           <h3 className="font-bold text-lg">Historical Portfolio</h3>
                           <div className="flex bg-white/5 rounded-lg p-0.5">
                              {['24H', '7D', '30D', 'ALL'].map(r => (
                                 <button key={r} className={`px-3 py-1 rounded-md text-xs font-bold ${r === '30D' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}>{r}</button>
                              ))}
                           </div>
                        </div>
                        {overviewLoading ? (
                           <div className="flex-1 flex items-center justify-center">
                              <Loader2 className="w-8 h-8 animate-spin text-white/40" />
                           </div>
                        ) : netWorth === 0 ? (
                           <div className="flex-1 flex flex-col items-center justify-center text-white/40">
                              <Layers size={32} className="mb-2" />
                              <p className="text-sm">No portfolio data available</p>
                           </div>
                        ) : (
                           <div className="flex-1 flex items-end gap-2 px-4 pb-4">
                              {/* Simulated historical data based on current portfolio */}
                              {[40, 45, 30, 60, 55, 70, 65, 80, 75, 85, 90, 80, 95, 100].map((h, i) => (
                                 <div key={i} className="flex-1 bg-gradient-to-t from-teal-500/20 to-teal-500/50 hover:to-teal-400/80 transition-all rounded-t-sm relative group" style={{ height: `${h}%` }}>
                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                       {fmtVal(netWorth * (h / 100))}
                                    </div>
                                 </div>
                              ))}
                           </div>
                        )}
                     </div>

                     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Token Table */}
                        <div className="lg:col-span-2 bg-[#151515] border border-white/10 rounded-xl overflow-hidden max-h-[500px] flex flex-col">
                           <div className="p-4 border-b border-white/10 flex justify-between items-center flex-shrink-0">
                              <h3 className="font-bold">Token Balances</h3>
                              {overviewLoading && <Loader2 className="w-4 h-4 animate-spin text-white/40" />}
                              {!overviewLoading && <button className="text-xs px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 text-white/60">+ Filter</button>}
                           </div>
                           <div className="overflow-x-auto overflow-y-auto flex-1">
                              <table className="w-full text-sm text-left">
                                 <thead className="bg-white/5 text-white/40 text-xs uppercase font-bold sticky top-0">
                                    <tr>
                                       <th className="p-4">Asset</th>
                                       <th className="p-4 text-right">Balance</th>
                                       <th className="p-4 text-right">Price</th>
                                       <th className="p-4 text-right">Value</th>
                                    </tr>
                                 </thead>
                                 <tbody className="divide-y divide-white/5">
                                    {overviewLoading ? (
                                       <tr><td colSpan={4} className="p-8 text-center text-white/40"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
                                    ) : displayBalances.length === 0 ? (
                                       <tr><td colSpan={4} className="p-8 text-center text-white/40">No tokens found</td></tr>
                                    ) : displayBalances.map((b: any, i: number) => {
                                       const symbol = b.symbol || 'TOKEN';
                                       const amount = b.amount || 0;
                                       const price = b.price_usd || 0;
                                       const value = b.value_usd || 0;
                                       return (
                                          <tr key={i} className="hover:bg-white/5 transition-colors">
                                             <td className="p-4 font-medium flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center text-xs">
                                                   {symbol[0]}
                                                </div>
                                                <div>
                                                   <div className="text-white">{symbol}</div>
                                                   <div className="text-xs text-white/40">{b.coinType?.split('::').pop() || 'Unknown'}</div>
                                                </div>
                                             </td>
                                             <td className="p-4 text-right font-mono text-white/80">{amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                             <td className="p-4 text-right font-mono text-white/60">{fmtVal(price)}</td>
                                             <td className="p-4 text-right font-mono font-bold">{fmtVal(value)}</td>
                                          </tr>
                                       );
                                    })}
                                 </tbody>
                              </table>
                           </div>
                        </div>

                        {/* Stats Card */}
                        <div className="bg-[#151515] border border-white/10 rounded-xl p-6 flex flex-col gap-6 max-h-[500px] overflow-y-auto">
                           <div>
                              <h3 className="font-bold mb-4">Trading Summary</h3>
                              {statsLoading ? (
                                 <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
                              ) : (
                                 <div className="space-y-4">
                                    <div className="flex justify-between text-sm">
                                       <span className="text-white/40">Total Volume</span>
                                       <span className="font-mono">{fmtVal(statsData?.total_volume || 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                       <span className="text-white/40">Realized PnL</span>
                                       <span className={`font-mono ${(statsData?.realized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                          {(statsData?.realized_pnl || 0) >= 0 ? '+' : ''}{fmtVal(statsData?.realized_pnl || 0)}
                                       </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                       <span className="text-white/40">Win Rate</span>
                                       <span className="font-mono">{statsData?.win_rate || 0}%</span>
                                    </div>
                                    {statsData?.note && (
                                       <div className="text-xs text-white/30 italic mt-2">{statsData.note}</div>
                                    )}
                                 </div>
                              )}
                           </div>
                        </div>

                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mt-auto hidden">
                           <div className="flex items-center gap-2 mb-2 text-blue-400">
                              <Sparkles size={16} />
                              <span className="font-bold text-xs uppercase">Pro Insight</span>
                           </div>
                           <p className="text-blue-200 text-xs">
                              Unlock full trading history and PnL analysis with <strong>Tovira Pro</strong>.
                           </p>
                           <button className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-colors">Upgrade Now</button>
                        </div>
                     </div>

                     {/* Related Wallets */}
                     <div className="bg-[#151515] border border-white/10 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center">
                           <h3 className="font-bold">Related Wallets</h3>
                           <button className="text-xs px-2 py-1 bg-white/5 rounded hover:bg-white/10 text-white/60">+ Filter</button>
                        </div>
                        <div className="p-8 flex flex-col items-center justify-center text-white/20 min-h-[200px]">
                           <Search className="w-8 h-8 mb-3 opacity-50" />
                           <p className="text-sm">This wallet has no related wallets.</p>
                        </div>
                     </div>
                  </>
               )}

               {/* NFTs TAB */}
               {activeTab === 'NFTs' && (
                  <div>
                     {nftLoading ? (
                        <div className="flex items-center justify-center py-20">
                           <Loader2 className="w-8 h-8 animate-spin text-white/40" />
                        </div>
                     ) : !nftData || nftData.nfts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[#151515] border border-white/10 rounded-xl text-center">
                           <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                              <Layers className="text-white/20" size={32} />
                           </div>
                           <h3 className="text-xl font-bold mb-2">No NFTs Found</h3>
                           <p className="text-white/40 max-w-md">This wallet doesn't own any NFTs yet.</p>
                        </div>
                     ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 animate-in fade-in">
                           {nftData.nfts.map((nft, i) => (
                              <div key={nft.objectId || i} className="bg-[#151515] border border-white/10 rounded-xl overflow-hidden group hover:border-white/20 transition-all">
                                 <div className="aspect-square bg-white/5 relative">
                                    {nft.image_url ? (
                                       <img src={nft.image_url} alt={nft.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    ) : (
                                       <div className="absolute inset-0 flex items-center justify-center text-white/20 font-bold text-4xl">NFT</div>
                                    )}
                                 </div>
                                 <div className="p-4">
                                    <h4 className="font-bold text-sm mb-1 truncate" title={nft.name}>{nft.name}</h4>
                                    <p className="text-xs text-white/40 truncate" title={nft.description}>{nft.description || 'No description'}</p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
               )}

               {/* Watchlist TAB */}
               {activeTab === 'Watchlist' && (
                  <div className="bg-[#151515] border border-white/10 rounded-xl overflow-hidden animate-in fade-in">
                     <div className="p-6 border-b border-white/10 flex justify-between items-center">
                        <h3 className="font-bold text-lg">Tracked Wallets</h3>
                        <button className="px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">+ Add Wallet</button>
                     </div>
                     <div className="divide-y divide-white/5">
                        {[1, 2, 3].map((i) => (
                           <div key={i} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
                              <div className="flex items-center gap-4">
                                 <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                                    W{i}
                                 </div>
                                 <div>
                                    <div className="font-bold text-sm">Alpha Hunter {i}</div>
                                    <div className="text-xs text-white/40 font-mono">0x1234...5678</div>
                                 </div>
                              </div>
                              <div className="text-right">
                                 <div className="font-mono font-bold">$1.2M</div>
                                 <div className="text-xs text-green-400 font-medium">+12%</div>
                              </div>
                           </div>
                        ))}
                     </div>
                  </div>
               )}

               {/* TRANSACTIONS TAB */}
               {activeTab === 'Transactions' && (
                  <div className="space-y-6 animate-in fade-in">
                     {/* Transactions Header with Heatmap */}
                     <div className="bg-[#151515] border border-white/10 rounded-xl p-6">
                        <div className="flex justify-between items-center mb-6">
                           <div className="flex items-center gap-4">
                              <h3 className="font-bold text-lg">Transactions</h3>
                              <button className="text-xs px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 text-white/60 border border-white/10">+ Filter</button>
                           </div>
                           <div className="flex items-center gap-2">
                              <button className="text-xs px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 text-white/60">Show Heatmap</button>
                              <button className="text-xs px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 text-white/60">Export</button>
                           </div>
                        </div>

                        {/* Transaction Heatmap - GitHub Style */}
                        <div className="mb-6 w-full">
                           <div className="flex justify-between items-center mb-3">
                              <span className="text-xs text-white/40">Activity over time</span>
                           </div>
                           <div className="w-full">
                              {/* Month labels */}
                              <div className="grid gap-[2px] mb-1 w-full" style={{ gridTemplateColumns: 'repeat(53, minmax(0, 1fr))' }}>
                                 {(() => {
                                    const today = new Date();
                                    const oneYearAgo = new Date(today);
                                    oneYearAgo.setFullYear(today.getFullYear() - 1);
                                    const startDate = new Date(oneYearAgo);
                                    startDate.setDate(oneYearAgo.getDate() - oneYearAgo.getDay());

                                    const monthLabels = [];
                                    let currentDate = new Date(startDate);
                                    let lastMonth = -1;

                                    for (let week = 0; week < 53; week++) {
                                       const month = currentDate.getMonth();
                                       if (month !== lastMonth) {
                                          monthLabels.push(
                                             <div key={week} className="relative overflow-visible h-3">
                                                <span className="absolute top-0 left-0 text-[9px] text-white/40 whitespace-nowrap">
                                                   {currentDate.toLocaleDateString('en-US', { month: 'short' })}
                                                </span>
                                             </div>
                                          );
                                          lastMonth = month;
                                       } else {
                                          monthLabels.push(<div key={week} className="h-3" />);
                                       }
                                       currentDate.setDate(currentDate.getDate() + 7);
                                    }
                                    return monthLabels;
                                 })()}
                              </div>

                              {/* Weeks grid */}
                              <div className="grid gap-[2px] w-full" style={{ gridTemplateColumns: 'repeat(53, minmax(0, 1fr))' }}>
                                 {(() => {
                                    const today = new Date();
                                    const oneYearAgo = new Date(today);
                                    oneYearAgo.setFullYear(today.getFullYear() - 1);
                                    const startDate = new Date(oneYearAgo);
                                    startDate.setDate(oneYearAgo.getDate() - oneYearAgo.getDay());

                                    // Pre-calculate transaction counts
                                    const txCounts: Record<string, number> = {};
                                    let maxTx = 0;
                                    const txs = profile.data.txs || [];


                                    txs.forEach((tx: any) => {
                                       const timestamp = tx.timestampMs || tx.timestamp;
                                       if (timestamp) {
                                          const d = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);
                                          const key = d.toDateString();
                                          txCounts[key] = (txCounts[key] || 0) + 1;
                                          maxTx = Math.max(maxTx, txCounts[key]);
                                       }
                                    });


                                    const weeks = [];
                                    let currentDate = new Date(startDate);

                                    for (let week = 0; week < 53; week++) {
                                       const days = [];
                                       for (let day = 0; day < 7; day++) {
                                          const date = new Date(currentDate);
                                          const count = txCounts[date.toDateString()] || 0;

                                          // Enhanced color scale
                                          let bgColor = 'bg-white/5';
                                          if (count > 0) {
                                             const ratio = maxTx > 0 ? count / maxTx : 0;
                                             if (ratio >= 0.75) bgColor = 'bg-teal-400';
                                             else if (ratio >= 0.5) bgColor = 'bg-teal-500';
                                             else if (ratio >= 0.25) bgColor = 'bg-teal-600';
                                             else bgColor = 'bg-teal-700/70';
                                          }

                                          days.push(
                                             <div
                                                key={day}
                                                className={`w-full aspect-square rounded-[2px] ${bgColor} hover:ring-1 hover:ring-teal-400 transition-all cursor-pointer`}
                                                title={`${count} transactions on ${date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}`}
                                                onClick={() => {
                                                   setSelectedDate(date);
                                                   toast.info(`Filtering transactions for ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
                                                }}
                                             />
                                          );
                                          currentDate.setDate(currentDate.getDate() + 1);
                                       }
                                       weeks.push(
                                          <div key={week} className="flex flex-col gap-[2px]">
                                             {days}
                                          </div>
                                       );
                                    }
                                    return weeks;
                                 })()}
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* Transactions Table */}
                     <div className="bg-[#151515] border border-white/10 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center">
                           <div className="flex items-center gap-4">
                              <h3 className="font-bold text-lg">Transactions</h3>
                              {selectedDate && (
                                 <div className="flex items-center gap-2 px-3 py-1 bg-teal-500/10 border border-teal-500/30 rounded-full">
                                    <span className="text-xs text-teal-400">
                                       {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                    <button
                                       onClick={() => setSelectedDate(null)}
                                       className="text-teal-400 hover:text-teal-300"
                                    >
                                       ×
                                    </button>
                                 </div>
                              )}
                           </div>
                           <div className="flex items-center gap-2">
                              <button className="text-xs px-3 py-1 bg-white/5 rounded-full hover:bg-white/10 text-white/60">Export</button>
                           </div>
                        </div>
                        <div className="overflow-x-auto">
                           <table className="w-full text-sm">
                              <thead className="bg-white/5 text-white/40 text-xs uppercase font-bold border-b border-white/10">
                                 <tr>
                                    <th className="p-4 text-left">Chain</th>
                                    <th className="p-4 text-left">Action</th>
                                    <th className="p-4 text-left">From</th>
                                    <th className="p-4 text-left">To</th>
                                    <th className="p-4 text-right">Amount</th>
                                    <th className="p-4 text-left">Token</th>
                                    <th className="p-4 text-right">Value</th>
                                    <th className="p-4 text-right">Time</th>
                                    <th className="p-4 text-center">Details</th>
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                 {(() => {
                                    let filteredTxs = profile.data.txs || [];

                                    // Filter by selected date if set
                                    if (selectedDate && filteredTxs.length > 0) {
                                       filteredTxs = filteredTxs.filter((tx: any) => {
                                          if (!tx.timestampMs) return false;
                                          const txDate = new Date(parseInt(tx.timestampMs));
                                          return txDate.toDateString() === selectedDate.toDateString();
                                       });
                                    }

                                    if (filteredTxs.length === 0) {
                                       return (
                                          <tr>
                                             <td colSpan={9} className="p-12 text-center">
                                                <div className="flex flex-col items-center justify-center text-white/40">
                                                   <Sparkles size={32} className="mb-3 opacity-50" />
                                                   <p className="text-sm">
                                                      {selectedDate ? 'No transactions found for this date' : 'No transactions found'}
                                                   </p>
                                                </div>
                                             </td>
                                          </tr>
                                       );
                                    }

                                    return filteredTxs.map((tx: any, i: number) => {
                                       const isPositive = Math.random() > 0.5;
                                       return (
                                          <tr key={i} className="hover:bg-white/5 transition-colors">
                                             <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                   <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                                      <span className="text-[8px] font-bold">SUI</span>
                                                   </div>
                                                </div>
                                             </td>
                                             <td className="p-4">
                                                <span className="px-2 py-1 rounded text-xs font-medium bg-white/10 text-white/80">
                                                   {['Send', 'Receive', 'Swap', 'Mint', 'Burn'][Math.floor(Math.random() * 5)]}
                                                </span>
                                             </td>
                                             <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                   <div className="w-4 h-4 rounded-full bg-orange-500/20 border border-orange-500/40" />
                                                   <span className="font-mono text-xs text-white/60">{tx.digest?.slice(0, 6)}...{tx.digest?.slice(-4)}</span>
                                                </div>
                                             </td>
                                             <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                   <div className="w-4 h-4 rounded-full bg-orange-500/20 border border-orange-500/40" />
                                                   <span className="font-mono text-xs text-white/60">{profile.id.slice(0, 6)}...{profile.id.slice(-4)}</span>
                                                </div>
                                             </td>
                                             <td className="p-4 text-right">
                                                <span className={`font-mono font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                                   {isPositive ? '+' : '-'}{(Math.random() * 10).toFixed(4)}
                                                </span>
                                             </td>
                                             <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                   <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px]">S</div>
                                                   <span className="text-white/80">SUI</span>
                                                </div>
                                             </td>
                                             <td className="p-4 text-right">
                                                <span className="font-mono text-white/60">${(Math.random() * 100).toFixed(2)}</span>
                                             </td>
                                             <td className="p-4 text-right">
                                                <span className="text-white/40 text-xs">
                                                   {(() => {
                                                      if (!tx.timestampMs) return 'Unknown';
                                                      const txDate = new Date(parseInt(tx.timestampMs));
                                                      const now = new Date();
                                                      const diffMs = now.getTime() - txDate.getTime();
                                                      const diffMins = Math.floor(diffMs / 60000);
                                                      const diffHours = Math.floor(diffMs / 3600000);
                                                      const diffDays = Math.floor(diffMs / 86400000);

                                                      if (diffMins < 60) return `${diffMins}m ago`;
                                                      if (diffHours < 24) return `${diffHours}h ago`;
                                                      if (diffDays < 30) return `${diffDays}d ago`;
                                                      return txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                   })()}
                                                </span>
                                             </td>
                                             <td className="p-4 text-center">
                                                <button className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                                                   <Search size={12} className="text-white/40" />
                                                </button>
                                             </td>
                                          </tr>
                                       );
                                    });
                                 })()}
                              </tbody>
                           </table>
                        </div>

                        {/* Pagination */}
                        {profile.data.txs && profile.data.txs.length > 0 && (
                           <div className="p-4 border-t border-white/10 flex justify-between items-center">
                              <span className="text-xs text-white/40">Showing {profile.data.txs.length} transactions</span>
                              <div className="flex gap-2">
                                 <button className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-white/60 transition-colors">Previous</button>
                                 <button className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-white/60 transition-colors">Next</button>
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
               )}

               {/* PNL TAB */}
               {activeTab === 'PnL' && (
                  <div className="space-y-6 animate-in fade-in">

                     {/* 1. Highlights Row */}
                     <div>
                        <h3 className="text-sm font-bold text-white/60 mb-3 ml-1">90 Day Highlights</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                           {[
                              { label: 'Turned $44k into $105k', sub: 'from SUI', profit: '139% profit', color: 'green' },
                              { label: '$909,604 unrealized profit', sub: 'on CETUS', profit: '145% profit', color: 'green' },
                              { label: 'Turned $330k into $285k', sub: 'from TURBOS', profit: '-13% loss', color: 'red' },
                              { label: '-$157,223 unrealized loss', sub: 'on FUD', profit: '-38% loss', color: 'red' }
                           ].map((item, i) => (
                              <div key={i} className="bg-[#151515] border border-white/10 rounded-xl p-4 flex flex-col justify-between h-28 hover:border-white/20 transition-colors">
                                 <div>
                                    <div className="text-xs font-medium text-white/80">{item.label}</div>
                                    <div className="text-xs text-white/40">{item.sub}</div>
                                 </div>
                                 <div className={`text-xs font-bold ${item.color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
                                    ({item.profit})
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>

                     {/* 2. Aggregated Stats */}
                     <div>
                        <h3 className="text-sm font-bold text-white/60 mb-3 ml-1">Aggregated Stats</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                           {/* Main Stats */}
                           <div className="bg-[#151515] border border-white/10 rounded-xl p-6 flex flex-col justify-between">
                              <div className="flex justify-between items-start">
                                 <div>
                                    <div className="text-xs text-white/40 mb-1">Realized PnL</div>
                                    <div className="text-3xl font-bold font-mono">$161,216 <span className="text-green-400 text-lg">+17%</span></div>
                                 </div>
                                 <button className="text-xs px-2 py-1 bg-white/5 rounded border border-white/5 text-white/60 flex items-center gap-1">90D <Sparkles size={10} /></button>
                              </div>

                              <div className="grid grid-cols-2 gap-y-6 gap-x-4 mt-6">
                                 <div>
                                    <div className="text-xs text-white/40 mb-1">Avg ROI per Trade</div>
                                    <div className="text-xl font-bold font-mono">64%</div>
                                 </div>
                                 <div>
                                    <div className="text-xs text-white/40 mb-1 flex items-center gap-1">Win Rate <AlertTriangle size={10} className="text-white/20" /></div>
                                    <div className="text-xl font-bold font-mono">50%</div>
                                 </div>
                                 <div>
                                    <div className="text-xs text-white/40 mb-1"># Traded Tokens</div>
                                    <div className="text-xl font-bold font-mono">2</div>
                                 </div>
                                 <div>
                                    <div className="text-xs text-white/40 mb-1 flex items-center gap-1"># Trades <AlertTriangle size={10} className="text-white/20" /></div>
                                    <div className="text-xl font-bold font-mono">8</div>
                                 </div>
                              </div>
                           </div>

                           {/* Top Realized Profits Chart */}
                           <div className="bg-[#151515] border border-white/10 rounded-xl p-6 flex flex-col">
                              <h4 className="text-sm font-bold text-white mb-4">Top Realized Profits (All Time)</h4>
                              <div className="flex-1 flex flex-col justify-center gap-4">
                                 {[
                                    { name: 'SUI', val: '80%', amt: '$800k' },
                                    { name: 'CETUS', val: '30%', amt: '$250k' }
                                 ].map((b, i) => (
                                    <div key={i} className="w-full">
                                       <div className="flex items-center gap-2 mb-1">
                                          <div className="w-4 h-4 rounded-full bg-white/10 text-[8px] flex items-center justify-center">{b.name[0]}</div>
                                          <div className="flex-1 h-6 bg-white/5 rounded-sm relative overflow-hidden">
                                             <div className="absolute top-0 left-0 h-full bg-green-500/80 rounded-sm" style={{ width: b.val }} />
                                          </div>
                                       </div>
                                       <div className="flex justify-between text-[10px] text-white/40 px-6">
                                          <span>$0</span>
                                          <span>{b.amt}</span>
                                       </div>
                                    </div>
                                 ))}
                              </div>
                           </div>

                           {/* Top Realized Losses Chart */}
                           <div className="bg-[#151515] border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                              <h4 className="text-sm font-bold text-white mb-auto w-full text-left">Top Realized Losses (All Time)</h4>
                              <div className="my-auto">
                                 <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2 text-white/20">
                                    <Layers size={20} />
                                 </div>
                                 <p className="text-xs text-white/40">No Data Found</p>
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* 3. Trade Performance Table */}
                     <div className="bg-[#151515] border border-white/10 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center">
                           <div className="flex items-center gap-2">
                              <h3 className="font-bold text-white">Trade Performance</h3>
                              <button className="text-xs px-2 py-1 bg-white/5 rounded text-white/60 hover:text-white">+ Filter</button>
                           </div>
                           <div className="flex gap-2">
                              {['7D', '90D', '1Y', 'ALL'].map(r => (
                                 <button key={r} className={`px-2 py-0.5 rounded text-[10px] font-bold ${r === 'ALL' ? 'bg-teal-500/20 text-teal-400' : 'text-white/40 hover:text-white'}`}>{r}</button>
                              ))}
                           </div>
                        </div>
                        <div className="overflow-x-auto">
                           <table className="w-full text-xs text-left">
                              <thead className="bg-white/5 text-white/40 font-bold uppercase">
                                 <tr>
                                    <th className="p-4">Token</th>
                                    <th className="p-4 text-right">Realized PnL ($)</th>
                                    <th className="p-4 text-right">ROI</th>
                                    <th className="p-4 text-right">Bought</th>
                                    <th className="p-4 text-right">Sold</th>
                                    <th className="p-4 text-right">Sold/Bought Ratio</th>
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5 text-white/80 font-mono">
                                 {[
                                    { name: 'SUI', pnl: '$950,012', roi: '414%', bought: '$290,272', sold: '$1,179,620', ratio: '79%' },
                                    { name: 'CETUS', pnl: '$245,906', roi: '139%', bought: '$587,740', sold: '$422,228', ratio: '30%' },
                                    { name: 'FUD', pnl: '$0', roi: '0%', bought: '$3.96', sold: '$0', ratio: '0%' },
                                    { name: 'BLUB', pnl: '$0', roi: '0%', bought: '$138', sold: '$0', ratio: '0%' },
                                    { name: 'USDC', pnl: '$0', roi: '0%', bought: '$0.23', sold: '$0', ratio: '0%' },
                                 ].map((row, i) => (
                                    <tr key={i} className="hover:bg-white/5 transition-colors">
                                       <td className="p-4 flex items-center gap-2 font-bold text-white font-sans">
                                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px]">{row.name[0]}</div>
                                          {row.name}
                                       </td>
                                       <td className="p-4 text-right">{row.pnl}</td>
                                       <td className={`p-4 text-right font-bold ${parseInt(row.roi) > 0 ? 'text-green-400' : 'text-white/60'}`}>{row.roi}</td>
                                       <td className="p-4 text-right text-white/60">{row.bought}</td>
                                       <td className="p-4 text-right text-white/60">{row.sold}</td>
                                       <td className="p-4 text-right relative">
                                          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mb-1">
                                             <div className="bg-blue-500 h-full" style={{ width: row.ratio }} />
                                          </div>
                                          {row.ratio}
                                       </td>
                                    </tr>
                                 ))}
                              </tbody>
                           </table>
                        </div>
                     </div>
                  </div>
               )}
            </div>
         </div>
      );
   };

   const renderTokenProfile = (profile: ProfilerData) => {
      const { metadata, supply } = profile.data;
      const formattedSupply = Number(supply) / Math.pow(10, metadata.decimals);

      return (
         <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-8 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-6 mb-8">
               {metadata.iconUrl ? <img src={metadata.iconUrl} className="w-20 h-20 rounded-full" /> : <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center text-2xl font-bold">{metadata.symbol.slice(0, 2)}</div>}
               <div>
                  <h1 className="text-4xl font-bold">{metadata.name} <span className="text-white/40 text-2xl">({metadata.symbol})</span></h1>
                  <p className="text-white/60 font-mono mt-2">{profile.id}</p>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/40 uppercase text-sm mb-1">Total Supply</p>
                  <p className="text-3xl font-mono font-bold">{formattedSupply.toLocaleString()}</p>
               </div>
               <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/40 uppercase text-sm mb-1">Description</p>
                  <p className="text-white/80">{metadata.description || "No description available."}</p>
               </div>
            </div>
         </div>
      );
   };


   return (
      <div className="min-h-screen text-white p-8 max-w-7xl mx-auto space-y-6">
         {/* Page Header */}
         <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <h1 className="text-3xl font-bold">Analytics</h1>
         </div>

         {/* Search Bar */}
         <div className="w-full relative group">
            <div className="absolute inset-0 bg-blue-500/10 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            <form onSubmit={handleSearch} className="relative flex items-center bg-[#1A1A1A] border border-white/10 rounded-full overflow-hidden focus-within:border-blue-500/50 transition-colors">
               <Search className="ml-4 text-white/40 w-5 h-5" />
               <input
                  type="text"
                  className="w-full bg-transparent border-none p-3 pr-4 text-white outline-none placeholder:text-white/20"
                  placeholder="Search Address, Coin Type, or NFT ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
               />
            </form>
         </div>

         {/* Main Content */}
         <div className="min-h-[600px]">
            {!activeProfile ? (
               <div className="h-full flex flex-col items-center justify-center pt-20">
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                     <Search className="w-10 h-10 text-white/20" />
                  </div>
                  <h3 className="text-xl font-bold text-white/40">Ready to Profile</h3>
                  <p className="text-sm text-white/20 mt-2">Search an entity or connect wallet to view insights.</p>
                  {!connectedAddress && (
                     <div className="mt-8 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-200">
                        Connect your wallet to see your own profile automatically.
                     </div>
                  )}
               </div>
            ) : (
               <>
                  {activeProfile.type === 'wallet' && renderWalletProfile(activeProfile)}
                  {activeProfile.type === 'token' && renderTokenProfile(activeProfile)}
                  {activeProfile.type === 'nft' && <div className="text-center py-20 text-white/40">NFT Profiler Coming Soon</div>}
               </>
            )}
         </div>

      </div>
   );
}
