'use client';

import { Search } from 'lucide-react';

export default function AnalysisPage() {
  return (
    <div className="min-h-screen text-white p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Onchain Analytics</h1>
          <p className="text-white/60 mt-2">Insightful data and trends from the Sui blockchain</p>
        </div>
      </div>

      {/* Search Bar Placeholder */}
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-white/40 group-focus-within:text-blue-400 transition-colors" />
        </div>
        <input
          type="text"
          placeholder="Search objects, addresses, or transactions..."
          className="block w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-white/20 text-lg"
          disabled
        />
        <div className="absolute inset-y-0 right-4 flex items-center">
          <span className="px-2 py-1 rounded-md bg-white/10 text-[10px] font-bold text-white/40 uppercase tracking-wider">
            Coming Soon
          </span>
        </div>
      </div>

      {/* Placeholder Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-50">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-[#151515] border border-white/10 rounded-[30px] p-8 h-64 flex flex-col justify-center items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 animate-pulse" />
            <div className="h-4 w-3/4 bg-white/5 rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-white/5 rounded animate-pulse" />
          </div>
        ))}
      </div>

      <div className="text-center py-20 pb-40">
        <p className="text-white/40 font-medium">Detailed onchain analysis features are currently being developed.</p>
        <p className="text-white/20 text-sm mt-2 font-mono italic">Powered by Sui RPC & Indexer</p>
      </div>
    </div>
  );
}
