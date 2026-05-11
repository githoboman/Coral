
"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { fetchUserGrowth, ChartData, fetchTopUsers, UserDetail } from "@/lib/data";
import { User, Shield, MessageSquare, Award } from "lucide-react";

export default function UserGrowthPage() {
  const [data, setData] = useState<ChartData[]>([]);
  const [topUsers, setTopUsers] = useState<UserDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [growth, users] = await Promise.all([
        fetchUserGrowth(range),
        fetchTopUsers(15)
      ]);
      setData(growth);
      setTopUsers(users);
      setLoading(false);
    }
    load();
  }, [range]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">User Growth</h2>
            <p className="text-white/60">New user signups over time.</p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${range === r
                    ? "bg-primary text-black"
                    : "bg-surface border border-white/10 text-white/60 hover:text-white"
                  }`}
              >
                {r} Days
              </button>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-white/10 rounded-3xl p-8">
          <div className="h-[400px] w-full min-h-[400px]">
            <h3 className="text-white font-bold text-lg mb-6">User Signups ({range} Days)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: '#ffffff05' }}
                  contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#ffffff10', borderRadius: '12px', color: '#fff' }}
                />
                <Bar dataKey="users" fill="#B7FC0D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Users Table */}
        <div className="bg-surface border border-white/10 rounded-3xl overflow-hidden">
          <div className="p-8 border-b border-white/10 flex justify-between items-center">
            <div>
              <h3 className="text-white font-bold text-lg">Most Active Users</h3>
              <p className="text-white/40 text-sm">Based on points and interactions.</p>
            </div>
            <Award className="text-primary" size={24} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5">
                  <th className="px-8 py-4 text-white/40 text-xs font-bold uppercase tracking-wider">User</th>
                  <th className="px-8 py-4 text-white/40 text-xs font-bold uppercase tracking-wider">Status</th>
                  <th className="px-8 py-4 text-white/40 text-xs font-bold uppercase tracking-wider">Points</th>
                  <th className="px-8 py-4 text-white/40 text-xs font-bold uppercase tracking-wider">Interactions</th>
                  <th className="px-8 py-4 text-white/40 text-xs font-bold uppercase tracking-wider">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-8 py-6 h-16 bg-white/[0.02]" />
                    </tr>
                  ))
                ) : topUsers.map((user, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                          <User size={18} className="text-white/40" />
                        </div>
                        <div>
                          <p className="text-white font-medium">{user.username}</p>
                          <p className="text-white/20 font-mono text-[10px]">{user.wallet_address}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      {user.subscription_tier > 0 ? (
                        <div className="flex items-center gap-1.5 text-primary text-xs font-bold">
                          <Shield size={14} />
                          Premium
                        </div>
                      ) : (
                        <span className="text-white/30 text-xs">Free</span>
                      )}
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-1.5 text-white font-bold">
                        <Award size={14} className="text-yellow-500" />
                        {user.points.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-1.5 text-white/60">
                        <MessageSquare size={14} className="text-blue-400" />
                        {user.interactions_count.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-8 py-5 text-white/40 text-sm">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
