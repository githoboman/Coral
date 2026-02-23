
import { supabase } from "@/lib/supabase";

export interface AnalyticsData {
  totalUsers: number;
  totalInteractions: number;
  totalCheckins: number; // Placeholder
  dau: number;
}

export interface ChartData {
  name: string;
  users: number;
  interactions: number;
}

export async function fetchAnalyticsData(): Promise<AnalyticsData> {
  // Fetch total users directly from Supabase
  const { count: totalUsers } = await supabase
    .from("user_profiles")
    .select("*", { count: "exact", head: true });

  const { count: totalInteractions } = await supabase
    .from("chat_messages")
    .select("*", { count: "exact", head: true });

  // Estimate DAU based on interactions (chats + messages + profile updates) in last 24h
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const [activeChats, activeMessages, activeProfiles] = await Promise.all([
    supabase.from("chats").select("user_id").gte("last_updated", yesterday.toISOString()),
    supabase.from("chat_messages").select("user_id").gte("timestamp", yesterday.toISOString()),
    supabase.from("user_profiles").select("wallet_address").gte("updated_at", yesterday.toISOString())
  ]);

  const activeUserIds = new Set([
    ...(activeChats.data?.map(c => c.user_id) || []),
    ...(activeMessages.data?.map(m => m.user_id) || []),
    ...(activeProfiles.data?.map(p => p.wallet_address) || [])
  ]);

  const dau = activeUserIds.size;

  return {
    totalUsers: totalUsers || 0,
    totalInteractions: totalInteractions || 0,
    totalCheckins: 0,
    dau: dau || 0
  };
}

export async function fetchGrowthData(days: number = 7): Promise<ChartData[]> {
  const isAllTime = days === 0;
  const now = new Date();

  // Testnet started on Feb 11, 2026
  const TESTNET_START = new Date("2026-02-11T00:00:00Z");
  const startDate = isAllTime ? TESTNET_START : new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

  const [profilesRes, messagesRes, eventsRes] = await Promise.all([
    supabase.from('user_profiles').select('created_at').gte('created_at', startDate.toISOString()),
    supabase.from('chat_messages').select('timestamp').gte('timestamp', startDate.toISOString()),
    supabase.from('revenue_events').select('timestamp').gte('timestamp', startDate.toISOString())
  ]);

  const profiles = profilesRes.data || [];
  const messages = messagesRes.data || [];
  const events = eventsRes.data || [];

  // Group by stable YYYY-MM-DD key first
  const dataByDay = new Map<string, { users: number; interactions: number }>();

  if (isAllTime) {
    // Initialize every day from Testnet Start to Today for a clean timeline
    let current = new Date(TESTNET_START);
    while (current <= now) {
      const key = current.toISOString().split('T')[0];
      dataByDay.set(key, { users: 0, interactions: 0 });
      current.setDate(current.getDate() + 1);
    }
  } else {
    // Initialize specific number of days
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      const key = d.toISOString().split('T')[0];
      dataByDay.set(key, { users: 0, interactions: 0 });
    }
  }

  const startKey = TESTNET_START.toISOString().split('T')[0];

  profiles.forEach(p => {
    const key = new Date(p.created_at).toISOString().split('T')[0];
    if (isAllTime && key < startKey) return; // Strictly ignore pre-testnet data
    if (dataByDay.has(key)) dataByDay.get(key)!.users++;
    else if (isAllTime) dataByDay.set(key, { users: 1, interactions: 0 });
  });

  messages.forEach(m => {
    const key = new Date(m.timestamp).toISOString().split('T')[0];
    if (isAllTime && key < startKey) return;
    if (dataByDay.has(key)) dataByDay.get(key)!.interactions++;
    else if (isAllTime) dataByDay.set(key, { users: 0, interactions: 1 });
  });

  events.forEach(e => {
    const key = new Date(e.timestamp).toISOString().split('T')[0];
    if (isAllTime && key < startKey) return;
    if (dataByDay.has(key)) dataByDay.get(key)!.interactions++;
    else if (isAllTime) dataByDay.set(key, { users: 0, interactions: 1 });
  });

  // Convert to chart format
  const result = Array.from(dataByDay.entries())
    .map(([key, data]) => {
      const d = new Date(key);
      const name = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return {
        key, // keep stable key for sorting
        name,
        users: data.users,
        interactions: data.interactions
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return result;
}

export async function fetchUserGrowth(days: number = 30): Promise<ChartData[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('created_at')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });

  const dayMap = new Map<string, number>();

  // Initialize days
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dayMap.set(dateStr, 0);
  }

  profiles?.forEach((p: { created_at: string }) => {
    const d = new Date(p.created_at);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (dayMap.has(dateStr)) {
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + 1);
    }
  });

  return Array.from(dayMap.entries()).map(([name, users]) => ({
    name,
    users,
    interactions: 0 // Placeholder or separate query if needed
  })).reverse();
}

export interface EngagementMetrics {
  streakDistribution: { name: string; value: number }[];
  averageStreak: number;
}

export async function fetchEngagementData(): Promise<EngagementMetrics> {
  // Use 'profiles' table if it has streak info, or fallback/mock if not available in Supabase yet
  // Assuming 'profiles' has 'current_streak' column based on Walrus integration
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('current_streak');

  const distribution = [
    { name: '0 Days', value: 0 },
    { name: '1-3 Days', value: 0 },
    { name: '4-7 Days', value: 0 },
    { name: '7+ Days', value: 0 },
  ];

  let totalStreak = 0;
  let count = 0;

  profiles?.forEach((p: any) => {
    const streak = p.current_streak || 0;
    totalStreak += streak;
    count++;

    if (streak === 0) distribution[0].value++;
    else if (streak <= 3) distribution[1].value++;
    else if (streak <= 7) distribution[2].value++;
    else distribution[3].value++;
  });

  return {
    streakDistribution: distribution,
    averageStreak: count > 0 ? parseFloat((totalStreak / count).toFixed(1)) : 0
  };
}


export interface TaskMetrics {
  priorityDistribution: { name: string; value: number }[];
  statusDistribution: { name: string; value: number }[];
  actionTypeDistribution: { name: string; value: number }[];
  topTags: { name: string; value: number }[];
  overdueCount: number;
  completionRate: number;
  totalTasks: number;
}

export async function fetchTaskMetrics(): Promise<TaskMetrics> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('priority, status, action_type, tags, due_date');

  const priorityMap = { low: 0, medium: 0, high: 0 };
  const statusMap = { pending: 0, completed: 0 };
  const actionMap = new Map<string, number>();
  const tagMap = new Map<string, number>();
  let overdueCount = 0;
  const now = new Date();

  tasks?.forEach((t: any) => {
    // Priority
    if (t.priority === 'high') priorityMap.high++;
    else if (t.priority === 'medium') priorityMap.medium++;
    else priorityMap.low++;

    // Status
    if (t.status === 'completed') statusMap.completed++;
    else statusMap.pending++;

    // Action Type
    const action = t.action_type || 'none';
    actionMap.set(action, (actionMap.get(action) || 0) + 1);

    // Tags
    if (Array.isArray(t.tags)) {
      t.tags.forEach((tag: string) => {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      });
    }

    // Overdue
    if (t.status === 'pending' && t.due_date) {
      if (new Date(t.due_date) < now) {
        overdueCount++;
      }
    }
  });

  const totalTasks = (tasks?.length || 0);
  const completionRate = totalTasks > 0 ? (statusMap.completed / totalTasks) * 100 : 0;

  // sort tags
  const sortedTags = Array.from(tagMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    priorityDistribution: [
      { name: 'High', value: priorityMap.high },
      { name: 'Medium', value: priorityMap.medium },
      { name: 'Low', value: priorityMap.low },
    ],
    statusDistribution: [
      { name: 'Completed', value: statusMap.completed },
      { name: 'Pending', value: statusMap.pending },
    ],
    actionTypeDistribution: Array.from(actionMap.entries()).map(([name, value]) => ({ name, value })),
    topTags: sortedTags,
    overdueCount,
    completionRate,
    totalTasks
  };
}


export interface EconomyMetrics {
  totalPoints: number;
  premiumUsers: number;
}

export async function fetchEconomyMetrics(): Promise<EconomyMetrics> {
  // Fetch from user_profiles
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('points, subscription_tier');

  let totalPoints = 0;
  let premiumUsers = 0;

  profiles?.forEach((p: any) => {
    totalPoints += (p.points || 0);
    if (p.subscription_tier === 1) premiumUsers++;
  });

  return {
    totalPoints,
    premiumUsers
  };
}

export interface AgentMetrics {
  agentDistribution: { name: string; value: number }[];
  topAgents: { name: string; value: number }[];
  totalInteractions: number;
}

export async function fetchAgentMetrics(): Promise<AgentMetrics> {
  const { data: chats } = await supabase
    .from('chats')
    .select('agent_id');

  const agentMap = new Map<string, number>();

  chats?.forEach((c: any) => {
    const agent = c.agent_id || 'unknown';
    // Normalize agent names
    let name = agent;
    if (agent === 'task_agent') name = 'Task Manager';
    else if (agent === 'task') name = 'Task Manager';
    else if (agent === 'research') name = 'Research';
    else if (agent === 'tovira') name = 'Tovira';
    else if (agent === 'alert') name = 'Alert';

    agentMap.set(name, (agentMap.get(name) || 0) + 1);
  });

  const dist = Array.from(agentMap.entries()).map(([name, value]) => ({ name, value }));
  const sorted = [...dist].sort((a, b) => b.value - a.value);

  return {
    agentDistribution: dist,
    topAgents: sorted.slice(0, 5),
    totalInteractions: chats?.length || 0
  };
}

export interface RevenueMetrics {
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  totalSubscribers: number;
  activeSubscribers: number; // Premium
  freeUsers: number;
  tierDistribution: { name: string; value: number }[];
  revenueBySource: { name: string; value: number }[];
  revenueHistory: { date: string; total: number; subscription: number; checkin_fee: number; task_claim: number }[];
}

export async function fetchRevenueMetrics(): Promise<RevenueMetrics> {
  // 0. Fetch SUI Price directly from Supabase 'prices' table
  let suiPrice = 1.5; // Default fallback
  try {
    const { data: priceData, error: priceError } = await supabase
      .from('prices')
      .select('price')
      .eq('coin_type', '0x2::sui::SUI')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priceData && priceData.price) {
      suiPrice = priceData.price;
      console.log(`[Analytics] Using Supabase fetched price: $${suiPrice}`);
    }
  } catch (err) {
    console.error("[Analytics] Failed to fetch SUI price from Supabase, using fallback:", err);
  }

  // 1. Fetch User Counts directly from Supabase
  let premium = 0;
  let free = 0;

  try {
    const { count: premiumCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_tier', 1);

    const { count: allUsersCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });

    premium = premiumCount || 0;
    free = (allUsersCount || 0) - premium;
  } catch (e) {
    console.error("Failed to fetch user stats via Supabase:", e);
  }

  // 2. Fetch Actual Usage/Revenue from Events
  const { data: revenueEvents } = await supabase
    .from('revenue_events')
    .select('amount, event_type, timestamp');

  let totalRevenue = 0;
  const breakdown = {
    subscription: 0,
    checkin_fee: 0,
    task_claim: 0,
    other: 0
  };

  // Initialize 30-day history buckets
  const historyMap = new Map<string, { total: number; subscription: number; checkin_fee: number; task_claim: number }>();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0); // Start of day

  // Pre-fill last 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    historyMap.set(dateStr, { total: 0, subscription: 0, checkin_fee: 0, task_claim: 0 });
  }

  // let subscriptionRevenue = 0;
  // let feeRevenue = 0;

  let revenueLast30d = 0;

  revenueEvents?.forEach((e: any) => {
    // Only count actual revenue events (include task_claim for breakdown)
    if (e.event_type === 'subscription' || e.event_type === 'checkin_fee' || e.event_type === 'task_claim') {
      const valSui = e.amount / 1_000_000_000;
      const valUsd = valSui * suiPrice;

      // All-time totals
      totalRevenue += valUsd;
      if (e.event_type === 'subscription') breakdown.subscription += valUsd;
      else if (e.event_type === 'checkin_fee') breakdown.checkin_fee += valUsd;
      else if (e.event_type === 'task_claim') breakdown.task_claim += valUsd;
      else breakdown.other += valUsd;

      // History & Last 30d
      if (e.timestamp) {
        const eventDate = new Date(e.timestamp);
        if (eventDate >= thirtyDaysAgo) {
          revenueLast30d += valUsd;
          const dateKey = eventDate.toISOString().split('T')[0];
          const entry = historyMap.get(dateKey);
          if (entry) {
            entry.total += valUsd;
            if (e.event_type === 'subscription') entry.subscription += valUsd;
            else if (e.event_type === 'checkin_fee') entry.checkin_fee += valUsd;
            else if (e.event_type === 'task_claim') entry.task_claim += valUsd;
          }
        }
      }
    }
  });

  // Convert map to array and sort by date
  const revenueHistory = Array.from(historyMap.entries())
    .map(([date, values]) => ({ date, ...values }))
    .sort((a, b) => a.date.localeCompare(b.date));



  // Total Lifetime Revenue (mapped to arr for UI)
  const lifetimeRevenue = totalRevenue;

  return {
    mrr: revenueLast30d, // Now implies Revenue (Last 30d)
    arr: lifetimeRevenue, // Remapped 'arr' to represent Total Lifetime Revenue
    totalSubscribers: premium + free,
    activeSubscribers: premium,
    freeUsers: free,
    tierDistribution: [
      { name: 'Premium ($2/mo)', value: premium },
      { name: 'Free', value: free }
    ],
    revenueBySource: [
      { name: 'Subscriptions', value: breakdown.subscription },
      { name: 'Check-in Fees', value: breakdown.checkin_fee },
      { name: 'Task Fees', value: breakdown.task_claim }, // if any
    ].filter(item => item.value > 0),
    revenueHistory
  };
}
