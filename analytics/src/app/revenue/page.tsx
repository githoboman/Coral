
"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { fetchRevenueMetrics, RevenueMetrics } from "@/lib/data";
import { DollarSign, CreditCard, Users } from "lucide-react";

const TIER_COLORS = ['#B7FC0D', '#333333']; // Premium, Free

export default function RevenuePage() {
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await fetchRevenueMetrics();
      setMetrics(data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Revenue & Subscriptions</h2>
          <p className="text-white/60">Financial metrics and subscription tiers.</p>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-green-500/10 rounded-xl">
                <DollarSign className="text-green-400" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Monthly Revenue (MRR)</h3>
            <p className="text-3xl font-bold text-white mt-1">${loading ? "..." : metrics?.mrr.toLocaleString()}</p>
            <p className="text-white/40 text-xs mt-2">Lifetime Revenue: ${metrics?.arr.toLocaleString()}</p>
          </div>

          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <CreditCard className="text-primary" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Active Subscribers</h3>
            <p className="text-3xl font-bold text-white mt-1">{loading ? "..." : metrics?.activeSubscribers}</p>
            <p className="text-white/40 text-xs mt-2">Premium Tier</p>
          </div>

          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-blue-500/10 rounded-xl">
                <Users className="text-blue-400" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Free Users</h3>
            <p className="text-3xl font-bold text-white mt-1">{loading ? "..." : metrics?.freeUsers.toLocaleString()}</p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Tier Distribution */}
          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
              <Users size={20} className="text-gray-400" />
              Subscriber Distribution
            </h3>
            <div className="h-[300px] w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics?.tierDistribution || []}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {metrics?.tierDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={TIER_COLORS[index % TIER_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#ffffff10', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Fee Breakdown (Placeholder/Simulated) */}
          {/* Revenue Breakdown */}
          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
              <DollarSign size={20} className="text-gray-400" />
              Revenue History (Last 30 Days)
            </h3>
            <div className="h-[300px] w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics?.revenueHistory || []}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B7FC0D" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#B7FC0D" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSub" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#ffffff40"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis
                    stroke="#ffffff40"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#ffffff10', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{ stroke: '#ffffff20' }}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Legend iconType="circle" />
                  <Area type="monotone" dataKey="total" stroke="#B7FC0D" fillOpacity={1} fill="url(#colorTotal)" strokeWidth={2} name="Total" />
                  <Area type="monotone" dataKey="subscription" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSub)" strokeWidth={2} name="Subscriptions" />
                  <Area type="monotone" dataKey="checkin_fee" stroke="#f43f5e" fillOpacity={0.5} fill="#f43f5e" strokeWidth={2} name="Check-in Fees" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
