
"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Users, CheckSquare, Zap, Activity } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchAnalyticsData, fetchGrowthData, AnalyticsData, ChartData } from "@/lib/data";

export default function Home() {
  const [metrics, setMetrics] = useState<AnalyticsData>({
    totalUsers: 0,
    totalInteractions: 0,
    totalCheckins: 0,
    dau: 0,
  });
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState(7); // 7, 30, 0 (All Time)

  useEffect(() => {
    async function loadKpis() {
      try {
        const kpiData = await fetchAnalyticsData();
        setMetrics(kpiData);
      } catch (error) {
        console.error("Failed to fetch KPIs", error);
      }
    }
    loadKpis();
  }, []);

  useEffect(() => {
    async function loadGrowth() {
      setLoading(true);
      try {
        const growthData = await fetchGrowthData(timeframe);
        setChartData(growthData);
      } catch (error) {
        console.error("Failed to fetch growth data", error);
      } finally {
        setLoading(false);
      }
    }
    loadGrowth();
  }, [timeframe]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Overview</h2>
          <p className="text-white/60">Key performance indicators for Tovira.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <Users className="text-primary" size={24} />
              </div>
              <span className="text-green-400 text-sm font-medium">Live</span>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Total Users</h3>
            <p className="text-3xl font-bold text-white mt-1">{loading ? "..." : metrics.totalUsers}</p>
          </div>

          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-blue-500/10 rounded-xl">
                <Activity className="text-blue-400" size={24} />
              </div>
              <span className="text-white/40 text-xs">24h Active</span>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">DAU (Est)</h3>
            <p className="text-3xl font-bold text-white mt-1">{loading ? "..." : metrics.dau}</p>
          </div>

          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-purple-500/10 rounded-xl">
                <CheckSquare className="text-purple-400" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Total Interactions</h3>
            <p className="text-3xl font-bold text-white mt-1">{loading ? "..." : metrics.totalInteractions}</p>
          </div>

          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-orange-500/10 rounded-xl">
                <Zap className="text-orange-400" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Interactions / User</h3>
            <p className="text-3xl font-bold text-white mt-1">
              {loading ? "..." : (metrics.totalUsers > 0 ? (metrics.totalInteractions / metrics.totalUsers).toFixed(1) : 0)}
            </p>
          </div>
        </div>

        {/* Main Chart */}
        <div className="bg-surface border border-white/10 rounded-3xl p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h3 className="text-white font-bold text-lg">User Growth & Interaction Volume</h3>

            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
              {[
                { label: '7D', value: 7 },
                { label: '30D', value: 30 },
                { label: 'All Time', value: 0 },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => setTimeframe(t.value)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${timeframe === t.value
                    ? "bg-primary text-black shadow-lg"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[400px] w-full min-h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#B7FC0D" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#B7FC0D" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorInteractions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#A855F7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#ffffff40"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: 'Daily Volume', angle: -90, position: 'insideLeft', fill: '#ffffff40', offset: 10 }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#ffffff10', borderRadius: '12px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ paddingBottom: '20px' }} />
                <Area type="monotone" name="New Users" dataKey="users" stroke="#B7FC0D" strokeWidth={3} fillOpacity={1} fill="url(#colorUsers)" />
                <Area type="monotone" name="Interactions" dataKey="interactions" stroke="#A855F7" strokeWidth={3} fillOpacity={1} fill="url(#colorInteractions)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
