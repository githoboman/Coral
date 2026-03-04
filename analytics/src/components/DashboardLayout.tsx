
import React from 'react';
import { LayoutDashboard, PieChart, Users, TrendingUp, CheckSquare, Bot, DollarSign } from 'lucide-react';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-white/10 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-white tracking-tighter">
            Tovira<span className="text-primary">Analytics</span>
          </h1>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 text-primary font-medium">
            <LayoutDashboard size={20} />
            Overview
          </Link>
          <Link href="/users" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white/60 hover:text-white transition-colors">
            <Users size={20} />
            User Growth
          </Link>
          <Link href="/engagement" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white/60 hover:text-white transition-colors">
            <TrendingUp size={20} />
            Engagement
          </Link>
          <Link href="/tasks" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white/60 hover:text-white transition-colors">
            <CheckSquare size={20} />
            Task Analytics
          </Link>
          <div className="my-4 border-t border-white/10" />
          <Link href="/agents" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white/60 hover:text-white transition-colors">
            <Bot size={20} />
            Agent Performance
          </Link>
          <Link href="/revenue" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-white/60 hover:text-white transition-colors">
            <DollarSign size={20} />
            Revenue
          </Link>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="px-4 py-2 text-xs text-white/40 uppercase font-bold tracking-widest">
            Pitch Deck Mode
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
