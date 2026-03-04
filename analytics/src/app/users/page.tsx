
"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { fetchUserGrowth, ChartData } from "@/lib/data";

export default function UserGrowthPage() {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const growth = await fetchUserGrowth(range);
      setData(growth);
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
      </div>
    </DashboardLayout>
  );
}
