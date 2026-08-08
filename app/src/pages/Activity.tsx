import { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronRight, Search, X, ChevronDown } from "lucide-react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchTasks, removeTask, updateTaskStatus, invalidateCache as invalidateTasksCache } from "@/store/slices/tasksSlice";
import { fetchEvents } from "@/store/slices/eventsSlice";
import { ActivitySkeleton } from "@/components/ui/SkeletonLoader";
import { Toast, ToastType } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { sileo } from "sileo";


const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

type ClaimableApi = {
  claimable_tasks: number;
  claimable_research: number;
  total_activities: number;
  total_claimable_points: number;
};

async function fetchClaimableStatus(
  userId: string,
): Promise<ClaimableApi | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/task-points/claimable?user_id=${encodeURIComponent(userId)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as ClaimableApi;
  } catch {
    return null;
  }
}

type Item = {
  id: string | number;
  type: "event" | "task";
  dateKey: string;
  title: string;
  time?: string;
  desc?: string;
  color?: string;
  completed?: boolean;
  priority?: string;
  tags?: string[];
  dueDate?: string;
  isOptimistic?: boolean;
};

type LoadingStates = {
  initialLoad: boolean;
  tasksLoading: boolean;
  eventsLoading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
};

type OptimisticTask = {
  id: string;
  title: string;
  status: "creating" | "failed";
  error?: string;
};

type FilterState = {
  status: "all" | "pending" | "completed";
  priority: "all" | "high" | "medium" | "low";
  date: "all" | "today" | "upcoming" | "overdue";
};

const defaultFilterState: FilterState = {
  status: "all",
  priority: "all",
  date: "all",
};

/**
 * Utility to calculate the time-state label for tasks based on due date.
 * Rules:
 * 1. No due date -> show nothing
 * 2. Due > 7 days away -> "Due Jan 12" or "Due Jan 12, 4:00 PM" (if time exists)
 * 3. Due in 2–7 days -> "Due in 4d · Jan 12"
 * 4. Due tomorrow -> "Due tomorrow" or "Due tomorrow · 9:00 AM" (if time exists)
 * 5. Due today, > 12 hours away -> "Due today · 11:00 PM"
 * 6. Due today, within 12 hours -> "Due in 11h · 11:00 PM"
 * 7. Due within 1 hour -> "Due in 45m · 4:00 PM"
 * 8. Overdue < 24 hours -> "Overdue by 2h · due 7:00 PM"
 * 9. Overdue >= 1 day -> "Overdue · Jan 5"
 */
function getTaskTimeState(dueDate: string | null | undefined): string {
  if (!dueDate) return '';

  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60_000);
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ (AM|PM)/, ' $1');

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Rule 8 & 9 — Overdue
  if (diffMs < 0) {
    const overdueMs = Math.abs(diffMs);
    const overdueMins = Math.round(overdueMs / 60_000);
    const overdueHours = overdueMs / (1000 * 60 * 60);
    const overdueDays = overdueMs / (1000 * 60 * 60 * 24);

    if (overdueDays >= 1) {
      return `Overdue · ${formatDate(due)}`; // Rule 9
    }
    if (overdueHours >= 1) {
      return `Overdue by ${Math.floor(overdueHours)}h · due ${formatTime(due)}`; // Rule 8
    }
    return `Overdue by ${overdueMins}m · due ${formatTime(due)}`; // Rule 8
  }

  // Rule 7 — Within 1 hour
  if (diffMins <= 60) {
    return `Due in ${diffMins}m · ${formatTime(due)}`;
  }

  // Rule 6 — Today within 12 hours
  const isToday = due.toDateString() === now.toDateString();
  if (isToday && diffHours <= 12) {
    return `Due in ${Math.floor(diffHours)}h · ${formatTime(due)}`;
  }

  // Rule 5 — Today more than 12 hours away
  if (isToday) {
    return `Due today · ${formatTime(due)}`;
  }

  // Rule 4 — Tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = due.toDateString() === tomorrow.toDateString();
  if (isTomorrow) {
    return hasTime ? `Due tomorrow · ${formatTime(due)}` : 'Due tomorrow';
  }

  // Rule 3 — 2 to 7 days away
  if (diffDays <= 7) {
    return `Due in ${Math.floor(diffDays)}d · ${formatDate(due)}`;
  }

  // Rule 2 — More than 7 days away
  return hasTime ? `Due ${formatDate(due)}, ${formatTime(due)}` : `Due ${formatDate(due)}`;
}

function getTimeStateStyles(timeState: string): string {
  if (timeState.startsWith('Overdue')) {
    return 'text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded-lg';
  }
  if (timeState.startsWith('Due in') && timeState.includes('m ·')) return 'text-orange-400'; // within 1 hour
  if (timeState.startsWith('Due in') && timeState.includes('h ·')) return 'text-yellow-400'; // within 12 hours
  return 'text-white/50'; // default muted for all other states
}

const PriorityTag = ({ priority }: { priority?: string }) => {
  const getPriorityColor = (p?: string) => {
    switch (p) {
      case "high": return "bg-[#3E1A1A] text-[#FF4444] border-[#FF4444]/20";
      case "medium": return "bg-[#3A2E14] text-[#FFAA00] border-[#FFAA00]/20";
      case "low": return "bg-[#143A22] text-[#00FF88] border-[#00FF88]/20";
      default: return "bg-white/5 text-white/60 border-white/5";
    }
  };
  const getPriorityLabel = (p?: string) => p ? p.charAt(0).toUpperCase() + p.slice(1) : "Normal";

  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize text-center shrink-0 ${getPriorityColor(priority)}`}>
      {getPriorityLabel(priority)}
    </span>
  );
};

const Activity = () => {
  const currentAccount = useCurrentAccount();
  const userId = currentAccount?.address || "";

  const dispatch = useAppDispatch();
  const tasks = useAppSelector((state) => state.tasks.tasks);
  const events = useAppSelector((state) => state.events.events);

  const [claimableState, setClaimableState] = useState<ClaimableApi | null>(null);

  const refreshClaimable = useCallback(async () => {
    if (!userId) {
      setClaimableState(null);
      return;
    }
    const data = await fetchClaimableStatus(userId);
    setClaimableState(data);
  }, [userId]);

  // Fetch claimable on mount and whenever userId changes
  useEffect(() => {
    void refreshClaimable();
  }, [refreshClaimable]);

  // Re-fetch when page becomes visible (covers tab-switch and SPA route navigation)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && userId) {
        void refreshClaimable();
      }
    };
    // Also refetch on focus (covers SPA route back-navigation)
    const handleFocus = () => {
      if (userId) void refreshClaimable();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [userId, refreshClaimable]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterState>(defaultFilterState);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    initialLoad: false,
    tasksLoading: false,
    eventsLoading: false,
    creating: false,
    updating: false,
    deleting: false,
  });

  const [prompt, setPrompt] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingItems, setTogglingItems] = useState<Set<string | number>>(new Set());
  const [optimisticTasks, setOptimisticTasks] = useState<OptimisticTask[]>([]);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const items = useMemo(() => {
    const taskItems: Item[] = tasks.map((task) => ({
      id: task.id!,
      type: "task" as const,
      dateKey: task.due_date
        ? task.due_date.split("T")[0]
        : new Date().toISOString().split("T")[0],
      title: task.task_name,
      desc: task.description,
      completed: task.status === "completed",
      priority: task.priority,
      tags: task.tags,
      dueDate: task.due_date,
    }));

    const eventItems: Item[] = events.map((event) => ({
      id: event.id!,
      type: "event" as const,
      dateKey: event.event_date.split("T")[0],
      title: event.event_name,
      time: event.event_time,
      desc: event.description,
      color: event.color || "bg-blue-500",
      tags: event.tags,
      dueDate: event.event_date,
    }));

    const optimisticItems: Item[] = optimisticTasks.map((task) => ({
      id: task.id,
      type: "task" as const,
      dateKey: new Date().toISOString().split("T")[0],
      title: task.status === "failed" ? `Failed: ${task.title}` : `Creating: ${task.title}`,
      completed: false,
      priority: "medium",
      isOptimistic: true,
      desc: task.status === "failed" ? task.error : "AI is processing your request...",
      color: task.status === "failed" ? "bg-red-500/10" : undefined,
    }));

    return [...optimisticItems, ...taskItems, ...eventItems];
  }, [tasks, events, optimisticTasks]);

  // Stats calculations
  const stats = useMemo(() => {
    const taskList = items.filter((i) => i.type === "task");
    const totalTasks = taskList.length;
    const completedTasks = taskList.filter((t) => t.completed).length;
    const pendingTasks = taskList.filter((t) => !t.completed).length;
    const completedHigh = taskList.filter(
      (t) => t.completed && t.priority === "high",
    ).length;
    const completedMedium = taskList.filter(
      (t) => t.completed && t.priority === "medium",
    ).length;
    const completedLow = taskList.filter(
      (t) => t.completed && t.priority === "low",
    ).length;

    return {
      totalTasks,
      completedTasks,
      pendingTasks,
      completedHigh,
      completedMedium,
      completedLow,
    };
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = items.filter((i) => i.type === "task");

    // Status Filter
    if (activeFilter.status !== "all") {
      if (activeFilter.status === "pending") {
        result = result.filter((i) => !i.completed);
      } else if (activeFilter.status === "completed") {
        result = result.filter((i) => i.completed);
      }
    }

    // Priority Filter
    if (activeFilter.priority !== "all") {
      result = result.filter((i) => i.priority === activeFilter.priority);
    }

    // Date Filter
    if (activeFilter.date !== "all") {
      const today = new Date().toISOString().split("T")[0];
      switch (activeFilter.date) {
        case "today":
          result = result.filter((i) => i.dateKey === today);
          break;
        case "upcoming":
          result = result.filter((i) => i.dateKey > today);
          break;
        case "overdue":
          result = result.filter((i) => i.dateKey < today && !i.completed);
          break;
      }
    }

    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.desc?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, debouncedSearchQuery, activeFilter]);

  // Load data from Redux - OPTIMIZED
  useEffect(() => {
    if (!userId) return;

    const hasTasks = tasks.length > 0;
    const hasEvents = events.length > 0;
    
    // Only show full skeleton if we have NO data at all
    if (!hasTasks && !hasEvents) {
      setLoadingStates((prev) => ({ ...prev, initialLoad: true }));
    }

    // fetchTasks and fetchEvents internally check cache validity
    Promise.all([
      dispatch(fetchTasks(userId)),
      dispatch(fetchEvents(userId)),
    ]).finally(() => {
      setLoadingStates((prev) => ({ ...prev, initialLoad: false }));
    });
  }, [userId, dispatch]); // Removed 'tasks' and 'events' from deps to avoid re-triggering on data change

  const openViewModal = (item: Item) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !userId) return;

    try {
      setIsPromptLoading(true);
      setToast(null);

      // Optimistic update
      const currentPrompt = prompt;
      const tempId = `optimistic-${Date.now()}`;
      setOptimisticTasks(prev => [{
        id: tempId,
        title: currentPrompt,
        status: "creating"
      }, ...prev]);

      setPrompt("");
      closeModal();

      const response = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          task_name: currentPrompt,
          priority: "medium",
          status: "pending"
        }),
      });

      if (!response.ok) throw new Error("Failed to create task");

      const data = await response.json();

      if (data.success) {
        dispatch(invalidateTasksCache());
        await dispatch(fetchTasks(userId));
        const freshClaimable = await fetchClaimableStatus(userId);
        setClaimableState(freshClaimable);
        // Success! Remove optimistic task
        setOptimisticTasks(prev => prev.filter(t => t.id !== tempId));
        sileo.success({ title: "Task Created", description: "Your task was created successfully." });

        if (freshClaimable && freshClaimable.total_activities > 0) {
            setTimeout(() => {
              sileo.info({
                title: "Activity Points Available",
                description: `You have ${freshClaimable.total_claimable_points} points from ${freshClaimable.total_activities} activit${freshClaimable.total_activities !== 1 ? "ies" : "y"} ready to claim.`,
              });
            }, 1500);
        }
      } else {
        throw new Error(data.detail || "Failed to create task");
      }
    } catch (err) {
      console.error("Task creation error:", err);
      const errorMsg = err instanceof Error ? err.message : "Network/Server Error";

      // Update optimistic task to failed state
      setOptimisticTasks(prev => prev.map(t =>
        t.title === prompt || (t.status === "creating" && !t.error) // Fallback matching
          ? { ...t, status: "failed", error: errorMsg }
          : t
      ));
      sileo.error({ title: "Task Creation Failed", description: errorMsg });
    } finally {
      setIsPromptLoading(false);
    }
  };



  const toggleTaskComplete = async (id: string | number) => {


    // Check if it's an optimistic task
    const optimisticTask = optimisticTasks.find(t => t.id === id);
    if (optimisticTask) {
      if (optimisticTask.status === "failed") {
        // Allow retrying failed 
        // Logic to re-submit could go here, or just let user delete it
      }
      return;
    }

    const task = items.find((i) => i.id === id && i.type === "task");
    if (!task || togglingItems.has(id)) return;

    try {
      setTogglingItems((prev) => new Set(prev).add(id));
      setToast(null);

      // Use the thunk for consistency and state management
      await dispatch(updateTaskStatus({ 
        taskId: id, 
        userId, 
        completed: !task.completed 
      })).unwrap();
      
      void refreshClaimable();
    } catch (err) {
      console.error("Failed to toggle task:", err);
      sileo.error({ title: "Update Failed", description: "Failed to update task. Please try again." });
    } finally {
      setTogglingItems((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const deleteItem = async (id: string | number) => {
    try {
      setLoadingStates((prev) => ({ ...prev, deleting: true }));
      setToast(null);

      if (typeof id === 'string' && id.startsWith('optimistic-')) {
        // Optimistic deletion - just remove from state
        setOptimisticTasks(prev => prev.filter(t => t.id !== id));
      } else {
        // Real backend deletion
        await dispatch(removeTask({ taskId: id, userId })).unwrap();
      }

      closeModal();
      sileo.success({ title: "Deleted", description: "Task deleted successfully." });
    } catch (err) {
      console.error("Failed to delete item:", err);
      sileo.error({ title: "Delete Failed", description: "Failed to delete item." });
    } finally {
      setLoadingStates((prev) => ({ ...prev, deleting: false }));
    }
  };



  // Moved to separate component file or defined outside
  // See TaskPointsClaimSection definition below


  // Show skeleton while loading
  if (!userId || loadingStates.initialLoad) {
    return <ActivitySkeleton />;
  }

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto px-4 pb-6 pt-6">
      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center justify-center md:justify-start gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">
            Tasks
          </h1>
          {/* <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#246AFC] hover:bg-[#1a55cc] text-white px-4 py-2 rounded-full font-bold text-sm transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-[#246AFC]/20"
          >
            <Plus size={16} />
            Create Task
          </button> */}
        </div>
      </div>

      {/* Top Section Cards */}
      <div className="flex flex-col md:flex-row gap-6 mb-10">


        {/* Stats & Progress Card - Right */}
        <div className="flex-1 flex flex-col justify-between bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 relative overflow-hidden">
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-[#B7FC0D]/5 blur-[60px] rounded-full pointer-events-none" />

          <div className="flex justify-between mb-4">
            <div className="flex items-center gap-4">
              <span className="text-[40px] font-light text-white leading-none">
                {stats.totalTasks}
              </span>
              <span className="text-[15px] w-fit no-break text-white font-medium max-w-[100px] leading-tight">
                Total number of tasks
              </span>
            </div>
          </div>

          {/* Progress Bar Container */}
          <div className="w-full h-12 bg-[#1A1A1A] rounded-full p-1.5 flex relative z-0">
            {/* Green Segment (Completed Low Priority) */}
            {stats.completedLow > 0 && (
              <div
                className={`h-full bg-[#00C853] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-30 ${(stats.completedMedium > 0 || stats.completedHigh > 0 || stats.pendingTasks > 0) ? '-mr-8' : ''
                  }`}
                style={{
                  width: (stats.completedMedium > 0 || stats.completedHigh > 0 || stats.pendingTasks > 0)
                    ? `calc(${(stats.completedLow / stats.totalTasks) * 100}% + 32px)`
                    : `${(stats.completedLow / stats.totalTasks) * 100}%`
                }}
              >
                <span className="text-black font-bold text-xs sm:text-sm relative z-40">
                  {stats.completedLow}
                </span>
              </div>
            )}

            {/* Orange-Brown Segment (Completed Medium Priority) */}
            {stats.completedMedium > 0 && (
              <div
                className={`h-full bg-[#FFAA00] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-20 ${(stats.completedHigh > 0 || stats.pendingTasks > 0) ? '-mr-8' : ''
                  }`}
                style={{
                  width: (stats.completedHigh > 0 || stats.pendingTasks > 0)
                    ? `calc(${(stats.completedMedium / stats.totalTasks) * 100}% + 32px)`
                    : `${(stats.completedMedium / stats.totalTasks) * 100}%`
                }}
              >
                <span className="text-black font-bold text-xs sm:text-sm relative z-40">
                  {stats.completedMedium}
                </span>
              </div>
            )}

            {/* Red Segment (Completed High Priority) */}
            {stats.completedHigh > 0 && (
              <div
                className={`h-full bg-[#D32F2F] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-10 ${(stats.pendingTasks > 0) ? '-mr-8' : ''
                  }`}
                style={{
                  width: (stats.pendingTasks > 0)
                    ? `calc(${(stats.completedHigh / stats.totalTasks) * 100}% + 32px)`
                    : `${(stats.completedHigh / stats.totalTasks) * 100}%`
                }}
              >
                <span className="text-white font-bold text-xs sm:text-sm relative z-40">
                  {stats.completedHigh}
                </span>
              </div>
            )}

            {/* Gray Segment (Other Pending/Remaining) */}
            {stats.pendingTasks > 0 && (
              <div
                className="h-full bg-[#424242] rounded-full relative flex-1 flex items-center justify-end px-4 transition-all duration-500 hover:brightness-110 z-0"
              >
                <div className="relative z-40 flex items-center gap-2">
                  <span className="text-white/60 font-medium text-[10px] sm:text-xs hidden md:inline truncate">
                    Pending tasks
                  </span>
                  <span className="text-white font-bold text-sm">{stats.pendingTasks}</span>
                </div>
              </div>
            )}
            {stats.totalTasks === 0 && (
              <div className="w-full h-full flex items-center justify-center text-white/30 text-xs italic">No tasks created yet</div>
            )}
          </div>
        </div>
      </div>

      <TaskPointsClaimSection
        userId={userId}
        claimable={claimableState}
        onRefresh={refreshClaimable}
      />

      {/* Middle Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-[22px] font-bold text-white self-start md:self-auto">
          Tasks overview
        </h2>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <button
              onClick={() => setIsFilterModalOpen(true)}
              className="flex items-center gap-2 bg-[#0A0A0A] border border-white/10 px-4 py-2.5 rounded-full text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all min-w-[140px] justify-between cursor-pointer"
            >
              <span>
                {Object.values(activeFilter).every(v => v === "all")
                  ? "Filter by"
                  : `${Object.values(activeFilter).filter(v => v !== "all").length} Active`}
              </span>
              <ChevronDown size={14} className={`opacity-50 ${Object.values(activeFilter).some(v => v !== "all") ? "text-[#B7FC0D] opacity-100" : ""}`} />
            </button>
          </div>

          <div className="relative flex-1 md:w-[300px]">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30"
              size={16}
            />
            <input
              type="text"
              placeholder="Search recent tasks"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0A0A0A] border border-white/10 rounded-full py-2.5 pl-11 pr-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 lg:p-8 min-h-[400px]">
        {filteredItems.length > 0 ? (
          <div className="space-y-0">
            {filteredItems.map((item, index) => (
              <div
                key={item.id}
                className={`group flex items-start md:items-center gap-4 py-6 ${index !== filteredItems.length - 1 ? "border-b border-white/5" : ""} transition-all duration-300 hover:bg-white/[0.02] -mx-4 px-4 lg:-mx-6 lg:px-6 relative cursor-pointer`}
                onClick={() => openViewModal(item)}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0 pt-0.5 md:pt-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleTaskComplete(item.id)}
                    disabled={togglingItems.has(item.id)}
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer relative z-10 ${item.completed ? "bg-[#246AFC] border-[#246AFC]" : "border-white/20 hover:border-white/40"} ${togglingItems.has(item.id) ? "opacity-50 cursor-wait" : ""}`}
                  >
                    {togglingItems.has(item.id) ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : item.completed && (
                      <div className="w-1.5 h-3 border-r-2 border-b-2 border-white rotate-45 mb-1" />
                    )}
                  </button>
                </div>

                {/* Content — switches to two-line layout on mobile */}
                <div className="flex-1 min-w-0">
                  {/* Row 1: Title (Desktop: Title + Actions | Mobile: Title only) */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span
                        className={`text-[16px] font-medium truncate ${item.completed ? "text-white/30" : "text-white/80"} ${item.isOptimistic ? "text-white/50 italic" : ""} ${item.desc?.startsWith("Failed") ? "text-red-400" : ""}`}
                      >
                        {item.title}
                      </span>
                      {item.isOptimistic && !item.desc?.startsWith("Failed") && (
                        <div className="flex-shrink-0 w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      )}
                      {item.isOptimistic && item.desc?.startsWith("Failed") && (
                        <div className="flex-shrink-0 text-red-500 text-xs font-bold">!</div>
                      )}
                    </div>

                    {/* Desktop Actions Row */}
                    <div className="hidden md:flex items-center gap-8 md:gap-12 flex-shrink-0">
                      {/* Time-State Label */}
                      {!item.completed && item.dueDate && (
                        <span className={`text-[11px] font-bold transition-all whitespace-nowrap ${getTimeStateStyles(getTaskTimeState(item.dueDate))}`}>
                          {getTaskTimeState(item.dueDate)}
                        </span>
                      )}

                      <PriorityTag priority={item.priority} />

                      <button
                        className="flex items-center gap-1 text-[11px] font-bold text-white/40 hover:text-white transition-colors capitalize group-hover/btn:translate-x-1"
                      >
                        View details <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Mobile Actions Row (Row 2) */}
                  <div className="flex md:hidden items-center gap-3 mt-1.5">
                    {!item.completed && item.dueDate && (
                      <span className={`text-[10px] font-bold transition-all truncate ${getTimeStateStyles(getTaskTimeState(item.dueDate))}`}>
                        {getTaskTimeState(item.dueDate)}
                      </span>
                    )}
                    <div className="flex items-center gap-3 ml-auto">
                      <PriorityTag priority={item.priority} />
                      <div className="text-white/40">
                        <ChevronRight size={14} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[300px] text-white/30">
            <Search size={40} className="mb-4 opacity-20" />
            <p>No tasks found</p>
          </div>
        )}
      </div>

      {/* Creation/View Detail Modal */}
      {
        isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
              {selectedItem ? (
                <div className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="text-xl font-bold text-white pr-8 break-words line-clamp-2">
                      {selectedItem.title}
                    </h3>
                    <button
                      onClick={closeModal}
                      className="text-white/40 hover:text-white transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="space-y-4 mb-8 text-white/70 text-sm">
                    {selectedItem.desc && (
                      <p className="bg-white/5 p-4 rounded-xl">
                        {selectedItem.desc}
                      </p>
                    )}
                    <div className="flex gap-4">
                      <PriorityTag priority={selectedItem.priority} />
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/5 text-white/60 border border-white/5">
                        {selectedItem.dueDate
                          ? new Date(selectedItem.dueDate).toLocaleDateString()
                          : "No date"}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => deleteItem(selectedItem.id)}
                      className="px-4 py-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-bold transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 text-sm font-bold transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white">
                      AI Task Manager
                    </h3>
                    <button
                      onClick={closeModal}
                      className="text-white/40 hover:text-white"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="mb-8">
                    <p className="text-white/60 text-sm mb-4">
                      Describe what you need to do, and the agent will handle the rest.
                    </p>

                    <form onSubmit={handlePromptSubmit} className="relative group">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., Remind me to check SUI price tomorrow at 10am..."
                        disabled={isPromptLoading}
                        rows={3}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-5 text-white placeholder-white/20 focus:outline-none focus:border-[#246AFC]/50 transition-all text-sm resize-none"
                      />
                      <div className="flex justify-end mt-4">
                        <button
                          type="submit"
                          disabled={isPromptLoading || !prompt.trim()}
                          className="bg-[#246AFC] hover:bg-[#1a55cc] text-white px-6 py-2.5 rounded-full font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {isPromptLoading ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              Create Task
                              <ChevronRight size={16} />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Optional: Show recent activity or tips */}
                  <div className="bg-[#B7FC0D]/5 border border-[#B7FC0D]/10 rounded-2xl p-4">
                    <h4 className="text-[#B7FC0D] text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#B7FC0D] animate-pulse" />
                      Agent Tip
                    </h4>
                    <p className="text-white/40 text-[13px] leading-relaxed">
                      You can specify dates, times, and priority levels directly in your prompt.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

        )
      }

      {/* Filter Modal */}
      {/* Filter Modal */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setIsFilterModalOpen(false)} />
          <div className="relative bg-[#0C0E13] border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl scale-100 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-white">Filter Tasks</h3>
                <div className="flex items-center gap-3">
                  {Object.values(activeFilter).some(v => v !== "all") && (
                    <button
                      onClick={() => setActiveFilter(defaultFilterState)}
                      className="text-xs font-bold text-[#B7FC0D] hover:underline"
                    >
                      Reset
                    </button>
                  )}
                  <button onClick={() => setIsFilterModalOpen(false)} className="text-white/40 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {/* Status Section */}
                <div>
                  <h4 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Status</h4>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "All" },
                      { id: "pending", label: "Pending" },
                      { id: "completed", label: "Completed" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setActiveFilter(prev => ({ ...prev, status: opt.id as any }))}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeFilter.status === opt.id
                          ? "bg-white text-black font-bold"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Priority Section */}
                <div>
                  <h4 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Priority</h4>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "All" },
                      { id: "high", label: "High" },
                      { id: "medium", label: "Medium" },
                      { id: "low", label: "Low" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setActiveFilter(prev => ({ ...prev, priority: opt.id as any }))}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeFilter.priority === opt.id
                          ? "bg-white text-black font-bold"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Section */}
                <div>
                  <h4 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Date</h4>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "Any Time" },
                      { id: "today", label: "Today" },
                      { id: "upcoming", label: "Upcoming" },
                      { id: "overdue", label: "Overdue" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setActiveFilter(prev => ({ ...prev, date: opt.id as any }))}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeFilter.date === opt.id
                          ? "bg-white text-black font-bold"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <button
                  onClick={() => setIsFilterModalOpen(false)}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  Show {filteredItems.length} Result{filteredItems.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

function TaskPointsClaimSection({
  userId,
  claimable,
  onRefresh,
}: {
  userId: string;
  claimable: ClaimableApi | null;
  onRefresh: () => Promise<void>;
}) {
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async () => {
    if (
      !userId ||
      !claimable ||
      claimable.total_activities === 0
    )
      return;

    setIsClaiming(true);

    try {
      const resp = await fetch(`${API_BASE_URL}/api/task-points/confirm-claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId
        })
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(errorData.detail || "Failed to claim points");
      }

      const data = await resp.json();

      window.dispatchEvent(new Event("pointsUpdated"));

      await onRefresh();

      sileo.success({
        title: "Points Claimed!",
        description: `🎉 Successfully claimed ${data.points_awarded} points!`,
      });

    } catch (error: any) {
      console.error("[CLAIM] Claim failed:", error);

      sileo.error({
        title: "Claim Failed",
        description: error.message || "Failed to claim points. Please try again.",
      });
    } finally {
      setIsClaiming(false);
    }
  };

  if (!claimable || claimable.total_activities === 0) return null;

  return (
    <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white mb-1">
            Activity Points Available
          </h3>
          <p className="text-white/60 text-sm">
            You have{" "}
            {claimable.claimable_tasks > 0 && claimable.claimable_research > 0 ? (
              <>
                {claimable.claimable_tasks} unclaimed task
                {claimable.claimable_tasks !== 1 ? "s" : ""} and{" "}
                {claimable.claimable_research} unclaimed research activit
                {claimable.claimable_research !== 1 ? "ies" : "y"}
              </>
            ) : claimable.claimable_tasks > 0 ? (
              <>
                {claimable.claimable_tasks} unclaimed task
                {claimable.claimable_tasks !== 1 ? "s" : ""}
              </>
            ) : (
              <>
                {claimable.claimable_research} unclaimed research activit
                {claimable.claimable_research !== 1 ? "ies" : "y"}
              </>
            )}
          </p>
        </div>
        <button
          onClick={handleClaim}
          disabled={isClaiming}
          className="bg-[#B7FC0D] hover:bg-[#a8ed00] text-black px-6 py-3 rounded-full font-bold text-sm flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isClaiming ? (
            "Claiming..."
          ) : (
            <>
              Claim {claimable.total_claimable_points} Points
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8m4-4H8" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
export default Activity;