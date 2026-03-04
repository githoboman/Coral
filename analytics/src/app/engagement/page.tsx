
"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchEngagementData, EngagementMetrics } from "@/lib/data";
import { Award, Target } from "lucide-react";

const COLORS = ['#333333', '#B7FC0D', '#97D600', '#76A800'];

export default function EngagementPage() {
  const [metrics, setMetrics] = useState<EngagementMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await fetchEngagementData();
      setMetrics(data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Engagement</h2>
          <p className="text-white/60">User retention and streak activity.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Average Streak Card */}
          <div className="bg-surface border border-white/10 rounded-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <Target className="text-primary" size={24} />
              </div>
            </div>
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider">Avg. Streak</h3>
            <p className="text-4xl font-bold text-white mt-2">{loading ? "..." : metrics?.averageStreak} <span className="text-lg text-white/40 font-normal">days</span></p>
          </div>

          {/* Streak Distribution Chart */}
          <div className="md:col-span-2 bg-surface border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
              <Award size={20} className="text-primary" />
              Active Streak Distribution
            </h3>
            <div className="h-[250px] w-full min-h-[250px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics?.streakDistribution || []}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {metrics?.streakDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
        </div>
      </div>
    </DashboardLayout>
  );
}
