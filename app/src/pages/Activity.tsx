import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, Filter, X } from "lucide-react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchTasks, removeTask, invalidateCache } from "@/store/slices/tasksSlice";
import { fetchEvents } from "@/store/slices/eventsSlice";
import { ActivitySkeleton } from "@/components/ui/SkeletonLoader";
import { Toast, ToastType } from "@/components/ui/Toast";
import { useDebounce } from "@/hooks/useDebounce";
import { confirmTaskClaim } from "@/services/chatService";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

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

const Activity = () => {
  const currentAccount = useCurrentAccount();
  const userId = currentAccount?.address || "";

  const dispatch = useAppDispatch();
  const tasks = useAppSelector((state) => state.tasks.tasks);
  const events = useAppSelector((state) => state.events.events);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    initialLoad: true,
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

    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.desc?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, debouncedSearchQuery]);

  // Load data from Redux - OPTIMIZED
  useEffect(() => {
    if (!userId) {
      setLoadingStates((prev) => ({ ...prev, initialLoad: false }));
      return;
    }

    // Start loading immediately
    setLoadingStates((prev) => ({ ...prev, initialLoad: true }));

    // Load tasks and events in parallel
    Promise.all([
      dispatch(fetchTasks(userId)),
      dispatch(fetchEvents(userId)),
    ]).finally(() => {
      // Quick transition out of loading state
      setTimeout(() => {
        setLoadingStates((prev) => ({ ...prev, initialLoad: false }));
      }, 100);
    });
  }, [userId, dispatch]);

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

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: currentPrompt, // Use captured prompt
          agent_id: "task_agent",
          stream: false,
        }),
      });

      if (!response.ok) throw new Error("Failed to process task prompt");

      const data = await response.json();

      if (data.task_created) {
        dispatch(invalidateCache());
        await dispatch(fetchTasks(userId));
        // Success! Remove optimistic task as real one is now in the list
        setOptimisticTasks(prev => prev.filter(t => t.id !== tempId));
        setToast({ message: "Task created successfully!", type: "success" });
      } else {
        // Task creation failed
        console.warn("Task creation denied:", data.response);
        const errorMsg = data.response || "Agent declined to create task.";

        // Update optimistic task to failed state
        setOptimisticTasks(prev => prev.map(t =>
          t.id === tempId ? { ...t, status: "failed", error: errorMsg } : t
        ));
        setToast({ message: errorMsg, type: "error" });
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
      setToast({ message: errorMsg, type: "error" });
    } finally {
      setIsPromptLoading(false);
    }
  };



  const toggleTaskComplete = async (id: string | number) => {
    // Cannot toggle optimistic tasks
    if (typeof id === 'string') {
      const optimisticTask = optimisticTasks.find(t => t.id === id);
      if (optimisticTask?.status === "failed") {
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

      // Instead of direct API call, use the chat agent as requested
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: `Complete task ${id}`,
          agent_id: "task_agent",
          stream: false,
        }),
      });

      if (!response.ok) throw new Error("Failed to complete task via agent");

      // Refresh tasks after agent processing
      dispatch(invalidateCache());
      await dispatch(fetchTasks(userId));
    } catch (err) {
      console.error("Failed to toggle task:", err);
      setToast({ message: "Failed to update task. Please try again.", type: "error" });
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

      if (typeof id === 'string') {
        // Optimistic deletion - just remove from state
        setOptimisticTasks(prev => prev.filter(t => t.id !== id));
      } else {
        // Real backend deletion
        await dispatch(removeTask({ taskId: id, userId }));
      }

      closeModal();
      setToast({ message: "Task deleted successfully", type: "success" });
    } catch (err) {
      console.error("Failed to delete item:", err);
      setToast({ message: "Failed to delete item.", type: "error" });
    } finally {
      setLoadingStates((prev) => ({ ...prev, deleting: false }));
    }
  };



  const TaskPointsClaimSection = () => {
    const currentAccount = useCurrentAccount();
    const { mutateAsync: signAndExecuteTransaction } =
      useSignAndExecuteTransaction();
    const [claimable, setClaimable] = useState<{
      tasks_created_today: number;
      tasks_claimed_today: number;
      claimable_tasks: number;
      total_claimable_points: number;
    } | null>(null);
    const [isClaiming, setIsClaiming] = useState(false);

    useEffect(() => {
      if (!currentAccount?.address) return;

      fetch(
        `${API_BASE_URL}/api/task-points/claimable?user_id=${currentAccount.address}`,
      )
        .then((res) => res.json())
        .then((data) => setClaimable(data))
        .catch(console.error);
    }, [currentAccount]);

    const handleClaim = async () => {
      if (
        !currentAccount?.address ||
        !claimable ||
        claimable.claimable_tasks === 0
      )
        return;

      setIsClaiming(true);

      try {
        console.log(
          "[CLAIM] Starting claim process for",
          claimable.claimable_tasks,
          "tasks",
        );

        const response = await fetch(
          `${API_BASE_URL}/api/task-points/request-claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: currentAccount.address,
              task_count: claimable.claimable_tasks,
            }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || "Failed to request claim ticket");
        }

        const data = await response.json();
        const { ticket_object_id } = data;

        if (!ticket_object_id || typeof ticket_object_id !== "string") {
          console.error("[CLAIM] Invalid ticket object ID received:", data);
          throw new Error("Failed to mint claim ticket. Please try again.");
        }

        console.log("[CLAIM] Got ticket:", ticket_object_id);

        const tx = new Transaction();

        const packageId = import.meta.env.VITE_SUI_PACKAGE_ID;
        const taskPointsRegistryId = import.meta.env
          .VITE_SUI_TASK_POINTS_REGISTRY_ID;
        const pointsRegistryId = import.meta.env.VITE_POINTS_REGISTRY_ID;

        if (!packageId || !taskPointsRegistryId || !pointsRegistryId) {
          throw new Error(
            "Missing required environment variables for claiming. Please check your .env file.",
          );
        }

        tx.moveCall({
          target: `${packageId}::task_points::claim_task_points`,
          arguments: [
            tx.object(taskPointsRegistryId),
            tx.object(pointsRegistryId),
            tx.object(ticket_object_id),
            tx.object("0x6"),
          ],
        });

        console.log("[CLAIM] Signing transaction...");
        const result = await signAndExecuteTransaction({ transaction: tx });

        console.log("[CLAIM] Transaction successful:", result.digest);

        await confirmTaskClaim(
          currentAccount.address,
          claimable.claimable_tasks,
        );

        window.dispatchEvent(new Event("pointsUpdated"));

        const refreshResponse = await fetch(
          `${API_BASE_URL}/api/task-points/claimable?user_id=${currentAccount.address}`,
        );
        const refreshData = await refreshResponse.json();
        setClaimable(refreshData);

        alert(
          `🎉 Successfully claimed ${claimable.total_claimable_points} points!\n\nTransaction: ${result.digest.slice(0, 10)}...`,
        );

        console.log("[CLAIM] Claim completed successfully");
      } catch (error: any) {
        console.error("[CLAIM] Claim failed:", error);

        let errorMessage = "Failed to claim points. ";

        if (error.message?.includes("ticket")) {
          errorMessage +=
            "There was an issue minting your claim ticket. Please try again.";
        } else if (error.message?.includes("environment")) {
          errorMessage += "Configuration error. Please contact support.";
        } else if (error.message?.includes("User rejected")) {
          errorMessage += "Transaction was cancelled.";
        } else {
          errorMessage += error.message || "Please try again.";
        }

        alert(errorMessage);
      } finally {
        setIsClaiming(false);
      }
    };

    if (!claimable || claimable.claimable_tasks === 0) return null;

    return (
      <div className="bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">
              Task Points Available
            </h3>
            <p className="text-white/60 text-sm">
              You have {claimable.claimable_tasks} unclaimed task
              {claimable.claimable_tasks !== 1 ? "s" : ""}
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
  };

  const getPriorityColor = (p?: string) => {
    switch (p) {
      case "high":
        return "bg-[#3E1A1A] text-[#FF4444] border-[#FF4444]/20";
      case "medium":
        return "bg-[#3A2E14] text-[#FFAA00] border-[#FFAA00]/20";
      case "low":
        return "bg-[#143A22] text-[#00FF88] border-[#00FF88]/20";
      default:
        return "bg-white/5 text-white/60 border-white/5";
    }
  };

  const getPriorityLabel = (p?: string) => {
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : "Normal";
  };

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

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div className="mb-8 text-center md:text-left">
          <h1 className="text-2xl md:text-3xl font-bold">
            Tasks
          </h1>
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
                    Tap to view pending tasks
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

      <TaskPointsClaimSection />

      {/* Middle Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-[22px] font-bold text-white self-start md:self-auto">
          Tasks overview
        </h2>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <button className="flex items-center gap-2 bg-[#0A0A0A] border border-white/10 px-4 py-2.5 rounded-full text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all min-w-[120px] justify-between">
              <span>Filter by</span>
              <Filter size={14} className="opacity-50" />
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
                className={`group flex items-center justify-between py-6 ${index !== filteredItems.length - 1 ? "border-b border-white/5" : ""} transition-all duration-300 hover:bg-white/[0.02] -mx-4 px-4 lg:-mx-6 lg:px-6 rounded-xl`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <button
                    onClick={() => toggleTaskComplete(item.id)}
                    disabled={togglingItems.has(item.id)}
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${item.completed ? "bg-[#246AFC] border-[#246AFC]" : "border-white/20 hover:border-white/40"} ${togglingItems.has(item.id) ? "opacity-50 cursor-wait" : ""}`}
                  >
                    {togglingItems.has(item.id) ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : item.completed && (
                      <div className="w-1.5 h-3 border-r-2 border-b-2 border-white rotate-45 mb-1" />
                    )}
                  </button>

                  <span
                    className={`text-[16px] font-medium truncate ${item.completed ? "text-white/30 line-through" : "text-white/80"} ${item.isOptimistic ? "text-white/50 italic" : ""} ${item.desc?.startsWith("Failed") ? "text-red-400" : ""}`}
                  >
                    {item.title}
                  </span>
                  {item.isOptimistic && !item.desc?.startsWith("Failed") && (
                    <div className="ml-3 w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  )}
                  {item.isOptimistic && item.desc?.startsWith("Failed") && (
                    <div className="ml-3 text-red-500 text-xs font-bold">!</div>
                  )}
                </div>

                <div className="flex items-center gap-8 md:gap-12 flex-shrink-0 ml-4">
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-bold border capitalize min-w-[80px] text-center ${getPriorityColor(item.priority)}`}
                  >
                    {getPriorityLabel(item.priority)}
                  </span>

                  <div className="hidden md:flex items-center gap-2 text-white/80 font-mono text-sm">
                    <span></span>
                  </div>

                  <button
                    onClick={() => openViewModal(item)}
                    className="flex items-center gap-1 text-[11px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-wider group-hover/btn:translate-x-1"
                  >
                    View details <ChevronRight size={12} />
                  </button>
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
                    <h3 className="text-xl font-bold text-white pr-8">
                      {selectedItem.title}
                    </h3>
                    <button
                      onClick={closeModal}
                      className="text-white/40 hover:text-white"
                    >
                      <ChevronRight className="rotate-90" />
                    </button>
                  </div>
                  <div className="space-y-4 mb-8 text-white/70 text-sm">
                    {selectedItem.desc && (
                      <p className="bg-white/5 p-4 rounded-xl">
                        {selectedItem.desc}
                      </p>
                    )}
                    <div className="flex gap-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold border capitalize ${getPriorityColor(selectedItem.priority)}`}
                      >
                        {getPriorityLabel(selectedItem.priority)}
                      </span>
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
    </div >
  );
};

export default Activity;