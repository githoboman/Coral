import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, FileCheck, X } from "lucide-react"
import { Task, Event } from '@/hooks/taskApi'
import { useAuth } from '@/hooks/useAuth';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchTasks, createTask as createReduxTask, updateTaskStatus, removeTask } from '@/store/slices/tasksSlice';
import { fetchEvents, createEvent as createReduxEvent, removeEvent } from '@/store/slices/eventsSlice';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type Item = {
  id: number;
  type: 'event' | 'task';
  dateKey: string;
  title: string;
  time?: string;
  desc?: string;
  color?: string;
  completed?: boolean;
  priority?: string;
  tags?: string[];
};

type LoadingStates = {
  initialLoad: boolean;
  tasksLoading: boolean;
  eventsLoading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const Activity = () => {
  const { pubkeyHex } = useAuth();
  const userId = pubkeyHex || "";

  // Redux state
  const dispatch = useAppDispatch();
  const tasks = useAppSelector(state => state.tasks.tasks);
  const events = useAppSelector(state => state.events.events);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeView, setActiveView] = useState<'Month' | 'Week' | 'Day' | 'Schedule'>('Month');
  const [activeTab, setActiveTab] = useState<'Calendar' | 'Tasks'>('Calendar');
  const [displayedDate, setDisplayedDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'event' | 'task'>('event');
  const [selectedDateForModal, setSelectedDateForModal] = useState<Date | null>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Improved loading states
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    initialLoad: true,
    tasksLoading: false,
    eventsLoading: false,
    creating: false,
    updating: false,
    deleting: false,
  });

  // Phase 1 & 2: New state for enhancements
  const [showStats, setShowStats] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'none' | 'priority' | 'date' | 'status'>('none');
  const [sortBy, setSortBy] = useState<'date' | 'priority' | 'alpha'>('date');

  // Phase 3: Bulk actions state
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());

  // Convert Redux state to items format
  const items = useMemo(() => {
    const taskItems: Item[] = tasks.map(task => ({
      id: task.id!,
      type: 'task' as const,
      dateKey: task.due_date ? task.due_date.split('T')[0] : new Date().toISOString().split('T')[0],
      title: task.task_name,
      desc: task.description,
      completed: task.status === 'completed',
      priority: task.priority,
      tags: task.tags
    }));

    const eventItems: Item[] = events.map(event => ({
      id: event.id!,
      type: 'event' as const,
      dateKey: event.event_date.split('T')[0],
      title: event.event_name,
      time: event.event_time,
      desc: event.description,
      color: event.color || 'bg-blue-500',
      tags: event.tags
    }));

    return [...taskItems, ...eventItems];
  }, [tasks, events]);

  // Phase 1: Statistics calculations
  const stats = useMemo(() => {
    const taskList = items.filter(i => i.type === 'task');
    const today = new Date().toISOString().split('T')[0];

    const totalTasks = taskList.length;
    const completedTasks = taskList.filter(t => t.completed).length;
    const pendingTasks = totalTasks - completedTasks;
    const overdueTasks = taskList.filter(t => !t.completed && t.dateKey < today).length;

    const upcomingEvents = items.filter(i => i.type === 'event' && i.dateKey >= today).length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      totalTasks,
      completedTasks,
      pendingTasks,
      overdueTasks,
      upcomingEvents,
      completionRate
    };
  }, [items]);

  // Phase 2: Get all unique tags for filter
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    items.forEach(item => {
      item.tags?.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [items]);

  // Phase 2: Filtered items based on search and filters
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Search filter
      if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !item.desc?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Priority filter (tasks only)
      if (priorityFilter !== 'all' && item.type === 'task' && item.priority !== priorityFilter) {
        return false;
      }

      // Status filter (tasks only)
      if (statusFilter === 'completed' && item.type === 'task' && !item.completed) return false;
      if (statusFilter === 'pending' && item.type === 'task' && item.completed) return false;

      // Tag filter
      if (tagFilter !== 'all' && !item.tags?.includes(tagFilter)) {
        return false;
      }

      return true;
    });
  }, [items, searchQuery, priorityFilter, statusFilter, tagFilter]);

  const views = ['Month', 'Week', 'Day', 'Schedule'];

  // Load data from Redux
  useEffect(() => {
    if (!userId) return;

    setLoadingStates(prev => ({ ...prev, initialLoad: true }));
    Promise.all([
      dispatch(fetchTasks(userId)),
      dispatch(fetchEvents(userId))
    ]).finally(() => {
      setLoadingStates(prev => ({ ...prev, initialLoad: false }));
    });
  }, [userId, dispatch]);

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const dateToKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const cloneDate = (d: Date) => new Date(d.getTime());

  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const startOfWeek = (d: Date) => {
    const copy = cloneDate(d);
    const day = copy.getDay();
    copy.setDate(copy.getDate() - day);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  const todayKey = useMemo(() => dateToKey(new Date()), []);

  const monthGrid = useMemo(() => {
    const start = startOfMonth(displayedDate);
    const firstWeekday = start.getDay();
    const grid: Date[] = [];
    const startDate = new Date(displayedDate.getFullYear(), displayedDate.getMonth(), 1 - firstWeekday);
    for (let i = 0; i < 42; i++) {
      const cell = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      grid.push(cell);
    }
    return grid;
  }, [displayedDate]);

  const weekDays = useMemo(() => {
    const s = startOfWeek(displayedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
      return d;
    });
  }, [displayedDate]);

  const dayKey = useMemo(() => dateToKey(displayedDate), [displayedDate]);

  const scheduleList = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  }, [items]);

  const eventsForDateKey = (key: string) => items.filter(i => i.type === 'event' && i.dateKey === key);
  const tasksForDateKey = (key: string) => items.filter(i => i.type === 'task' && i.dateKey === key);

  const goPrev = () => {
    const d = cloneDate(displayedDate);
    if (activeView === 'Month' || activeView === 'Schedule') d.setMonth(d.getMonth() - 1);
    else if (activeView === 'Week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setDisplayedDate(d);
  };
  const goNext = () => {
    const d = cloneDate(displayedDate);
    if (activeView === 'Month' || activeView === 'Schedule') d.setMonth(d.getMonth() + 1);
    else if (activeView === 'Week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setDisplayedDate(d);
  };
  const goToday = () => setDisplayedDate(new Date());

  const openAddModal = (date: Date, mode: 'event' | 'task' = 'event') => {
    setSelectedDateForModal(date);
    setModalMode(mode);
    setSelectedItem(null);
    setIsModalOpen(true);
  };
  const openViewModal = (item: Item) => {
    setSelectedItem(item);
    setSelectedDateForModal(null);
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedDateForModal(null);
    setSelectedItem(null);
  };

  const handleAddSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = fd.get('title')?.toString().trim();
    if (!title || !selectedDateForModal) return;

    try {
      setLoadingStates(prev => ({ ...prev, creating: true }));
      setError(null);

      const localDate = new Date(
        selectedDateForModal.getFullYear(),
        selectedDateForModal.getMonth(),
        selectedDateForModal.getDate(),
        12, 0, 0, 0 // Has been set to noon to avoid timezone issues
      );

      if (modalMode === 'event') {
        const eventData: Event = {
          user_id: userId,
          event_name: title,
          description: fd.get('desc')?.toString() || undefined,
          event_date: localDate.toISOString(),
          event_time: fd.get('time')?.toString() || undefined,
          color: (fd.get('color')?.toString() as Event['color']) || 'bg-blue-500',
          tags: fd.get('tags')?.toString().split(',').map(t => t.trim()).filter(Boolean) || [],
        };

        await dispatch(createReduxEvent(eventData));
      } else {
        const taskData: Task = {
          user_id: userId,
          task_name: title,
          description: fd.get('desc')?.toString() || undefined,
          due_date: localDate.toISOString(),
          priority: (fd.get('priority')?.toString() as 'low' | 'medium' | 'high') || 'medium',
          tags: fd.get('tags')?.toString().split(',').map(t => t.trim()).filter(Boolean) || [],
        };

        await dispatch(createReduxTask(taskData));
      }

      closeModal();
    } catch (err) {
      console.error(`Failed to create ${modalMode}:`, err);
      setError(`Failed to create ${modalMode}. Please try again.`);
    } finally {
      setLoadingStates(prev => ({ ...prev, creating: false }));
    }
  };

  const toggleTaskComplete = async (id: number) => {
    const task = items.find(i => i.id === id && i.type === 'task');
    if (!task) return;

    try {
      setLoadingStates(prev => ({ ...prev, updating: true }));
      setError(null);

      await dispatch(updateTaskStatus({ taskId: id, userId, completed: !task.completed }));
    } catch (err) {
      console.error('Failed to toggle task:', err);
      setError('Failed to update task. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, updating: false }));
    }
  };

  const deleteItem = async (id: number) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    try {
      setLoadingStates(prev => ({ ...prev, deleting: true }));
      setError(null);

      if (item.type === 'task') {
        await dispatch(removeTask({ taskId: id, userId }));
      } else {
        await dispatch(removeEvent({ eventId: id, userId }));
      }

      closeModal();
    } catch (err) {
      console.error('Failed to delete item:', err);
      setError('Failed to delete item. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, deleting: false }));
    }
  };

  // Phase 3: Bulk action handlers
  const toggleTaskSelection = (taskId: number) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const selectAllTasks = () => {
    const taskIds = filteredItems.filter(i => i.type === 'task').map(t => t.id);
    setSelectedTaskIds(new Set(taskIds));
  };

  const deselectAllTasks = () => {
    setSelectedTaskIds(new Set());
  };

  const bulkCompleteSelected = async () => {
    if (selectedTaskIds.size === 0) return;

    try {
      setLoadingStates(prev => ({ ...prev, updating: true }));
      await Promise.all(
        Array.from(selectedTaskIds).map(id =>
          dispatch(updateTaskStatus({ taskId: id, userId, completed: true }))
        )
      );
      setSelectedTaskIds(new Set());
      setBulkSelectMode(false);
    } catch (err) {
      console.error('Failed to complete tasks:', err);
      setError('Failed to complete selected tasks');
    } finally {
      setLoadingStates(prev => ({ ...prev, updating: false }));
    }
  };

  const bulkDeleteSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    if (!confirm(`Delete ${selectedTaskIds.size} selected tasks?`)) return;

    try {
      setLoadingStates(prev => ({ ...prev, deleting: true }));
      await Promise.all(
        Array.from(selectedTaskIds).map(id =>
          dispatch(removeTask({ taskId: id, userId }))
        )
      );
      setSelectedTaskIds(new Set());
      setBulkSelectMode(false);
    } catch (err) {
      console.error('Failed to delete tasks:', err);
      setError('Failed to delete selected tasks');
    } finally {
      setLoadingStates(prev => ({ ...prev, deleting: false }));
    }
  };

  const duplicateTask = async (taskId: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      setLoadingStates(prev => ({ ...prev, creating: true }));
      const newTask: Task = {
        user_id: userId,
        task_name: `${task.task_name} (Copy)`,
        description: task.description,
        due_date: task.due_date,
        priority: task.priority,
        tags: task.tags,
      };
      await dispatch(createReduxTask(newTask));
    } catch (err) {
      console.error('Failed to duplicate task:', err);
      setError('Failed to duplicate task');
    } finally {
      setLoadingStates(prev => ({ ...prev, creating: false }));
    }
  };

  const fmtMonthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const fmtShortDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' });
  const fmtDayNumber = (d: Date) => d.getDate();
  const fmtFullDate = (key: string) => {
    const [y, m, day] = key.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtHour = (h: number) => `${pad(h)}:00`;

  useEffect(() => setIsDropdownOpen(false), [activeView]);

  if (!userId || loadingStates.initialLoad) {
    return <LoadingSpinner fullScreen text="Loading your calendar..." />;
  }

  const isAnyOperationInProgress = loadingStates.creating || loadingStates.updating || loadingStates.deleting;

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto px-4 pb-6">
      {/* Error notification */}
      {error && (
        <div className="fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-md shadow-lg z-50 flex items-center gap-2 animate-slide-in">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:bg-red-600 rounded p-1 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading indicator for background operations */}
      {isAnyOperationInProgress && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-blue-500/90 backdrop-blur text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2">
          <LoadingSpinner size="sm" />
          <span className="text-sm">
            {loadingStates.creating && 'Creating...'}
            {loadingStates.updating && 'Updating...'}
            {loadingStates.deleting && 'Deleting...'}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 pt-6 z-10 flex w-full gap-6 items-center mb-8 bg-transparent">
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(s => !s)}
            className="cursor-pointer flex items-center px-4 py-2 bg-[#2D2D2D] border border-white/10 rounded-full text-sm font-medium hover:bg-white/10"
          >
            {activeView}
            <svg className={`ml-2 w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 bg-[#2D2D2D] backdrop-blur rounded-md shadow-lg border border-gray-200/50 w-40 z-20">
              {views.map(v => (
                <button
                  key={v}
                  onClick={() => { setActiveView(v as any); setIsDropdownOpen(false); }}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100/50 rounded-md"
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex bg-[#2D2D2D] border border-white/10 overflow-hidden rounded-full">
          {([{ title: 'Calendar', icon: <CalendarDays /> }, { title: 'Tasks', icon: <FileCheck /> }] as const).map(t => (
            <button
              key={t.title}
              onClick={() => setActiveTab(t.title)}
              className={`cursor-pointer flex-1 py-2 px-4 text-sm font-medium transition-colors ${activeTab === t.title ? 'bg-blue-500/10 text-white' : 'text-white/40 hover:text-white/80'}`}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Phase 1: Statistics Dashboard */}
      {showStats && (
        <div className="mb-6 bg-white/5 backdrop-blur-sm rounded-[20px] border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Overview</h3>
            <button
              onClick={() => setShowStats(false)}
              className="text-sm text-white/60 hover:text-white/80 transition-colors"
            >
              Hide
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.totalTasks}</div>
              <div className="text-xs text-white/60 mt-1">Total Tasks</div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.completedTasks}</div>
              <div className="text-xs text-white/60 mt-1">Completed</div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.pendingTasks}</div>
              <div className="text-xs text-white/60 mt-1">Pending</div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.overdueTasks}</div>
              <div className="text-xs text-white/60 mt-1">Overdue</div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.upcomingEvents}</div>
              <div className="text-xs text-white/60 mt-1">Events</div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-2xl font-bold text-white">{stats.completionRate}%</div>
              <div className="text-xs text-white/60 mt-1">Completion</div>
              <div className="mt-2 w-full bg-white/10 rounded-full h-1.5">
                <div
                  className="bg-white h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${stats.completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {!showStats && (
        <button
          onClick={() => setShowStats(true)}
          className="mb-6 w-full py-2 text-sm text-white/60 hover:text-white/80 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
        >
          Show Statistics
        </button>
      )}

      {/* Phase 2: Filter Panel */}
      {activeTab === 'Tasks' && (
        <div className="mb-6 bg-white/5 backdrop-blur-sm rounded-[20px] border border-white/10 p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>

            {/* Tag Filter */}
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              <option value="all">All Tags</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {(searchQuery || priorityFilter !== 'all' || statusFilter !== 'all' || tagFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setPriorityFilter('all');
                setStatusFilter('all');
                setTagFilter('all');
              }}
              className="mt-4 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      <div className="flex-1">
        {activeTab === 'Calendar' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">
                {activeView === 'Month' && fmtMonthYear(displayedDate)}
                {activeView === 'Week' && `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                {activeView === 'Day' && displayedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                {activeView === 'Schedule' && `Schedule – ${fmtMonthYear(displayedDate)}`}
              </h3>

              <div className="flex items-center space-x-2">
                <button onClick={goPrev} className="cursor-pointer p-2 rounded-md hover:bg-white/5 text-gray-500" title="Previous"><ChevronLeft /></button>
                <button onClick={goToday} className="cursor-pointer px-3 py-1 rounded-md bg-white/5 text-sm" title="Today">Today</button>
                <button onClick={goNext} className="cursor-pointer p-2 rounded-md hover:bg-white/5 text-gray-500" title="Next"><ChevronRight /></button>
              </div>
            </div>

            {activeView === 'Month' && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-4">
                <div className="grid grid-cols-7 gap-1 mb-2 text-center">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="text-sm font-medium text-gray-500 py-2">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {monthGrid.map((cell, idx) => {
                    const key = dateToKey(cell);
                    const isCurrent = cell.getMonth() === displayedDate.getMonth();
                    const isToday = key === todayKey;
                    const evs = eventsForDateKey(key);
                    const tsks = tasksForDateKey(key);

                    return (
                      <div
                        key={idx}
                        onClick={() => openAddModal(cell)}
                        className={`relative rounded-lg p-2 h-24 border border-gray-200/50 transition-colors cursor-pointer ${isToday ? 'bg-blue-50/50 border-blue-200/50' : ''} ${isCurrent ? 'hover:bg-white/5' : 'bg-gray-50/50 text-gray-400'}`}
                      >
                        <div className={`text-sm font-medium ${isToday ? 'text-blue-600' : ''}`}>{cell.getDate()}</div>

                        <div className="mt-1 space-y-0.5 overflow-hidden">
                          {evs.slice(0, 2).map(ev => (
                            <div
                              key={ev.id}
                              onClick={e => { e.stopPropagation(); openViewModal(ev); }}
                              className={`text-xs truncate rounded px-1 py-0.5 ${ev.color} text-white cursor-pointer`}
                              title={`${ev.title} ${ev.time ?? ''}`}
                            >
                              {ev.title}
                            </div>
                          ))}
                          {tsks.slice(0, 2).map(t => (
                            <div
                              key={t.id}
                              onClick={e => { e.stopPropagation(); openViewModal(t); }}
                              className={`text-xs truncate rounded px-1 py-0.5 ${t.completed ? 'bg-gray-400 line-through' : 'bg-gray-300'} text-gray-800 cursor-pointer flex items-center`}
                            >
                              <input type="checkbox" checked={t.completed} readOnly className="w-3 h-3 mr-1" />
                              {t.title}
                            </div>
                          ))}
                          {(evs.length + tsks.length > 4) && <div className="text-xs text-gray-500">+{evs.length + tsks.length - 4} more</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeView === 'Week' && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm overflow-hidden">
                <div className="grid grid-cols-8 gap-0 border-b border-gray-200/30">
                  <div className="p-2 text-xs text-gray-500" />
                  {weekDays.map(d => (
                    <div key={dateToKey(d)} className="p-2 text-center">
                      <div className="text-xs text-gray-500">{fmtShortDay(d)}</div>
                      <div className="text-lg font-semibold">{fmtDayNumber(d)}</div>
                    </div>
                  ))}
                </div>

                <div className="relative h-[1400px]">
                  {HOURS.map(h => (
                    <div key={h} className="grid grid-cols-8 gap-0 border-b border-gray-200/20" style={{ height: '58px' }}>
                      <div className="flex items-center justify-end pr-2 text-xs text-gray-500">
                        {fmtHour(h)}
                      </div>

                      {weekDays.map(d => {
                        const key = dateToKey(d);
                        const dayEvs = eventsForDateKey(key).filter(e => e.time?.split(':')[0] === String(h).padStart(2, '0'));

                        return (
                          <div
                            key={key}
                            className="relative border-l border-gray-200/20 hover:bg-white/5 cursor-pointer"
                            onClick={() => openAddModal(d)}
                          >
                            {h === 0 && (
                              <div className="absolute inset-x-0 top-0 h-6 flex flex-col gap-1 px-1 overflow-hidden">
                                {eventsForDateKey(key).filter(e => !e.time).map(ev => (
                                  <div
                                    key={ev.id}
                                    onClick={e => { e.stopPropagation(); openViewModal(ev); }}
                                    className={`text-xs truncate rounded px-1 ${ev.color} text-white`}
                                  >
                                    {ev.title}
                                  </div>
                                ))}
                                {tasksForDateKey(key).map(t => (
                                  <div
                                    key={t.id}
                                    onClick={e => { e.stopPropagation(); openViewModal(t); }}
                                    className={`text-xs truncate rounded px-1 ${t.completed ? 'bg-gray-400 line-through' : 'bg-gray-300'} text-gray-800 flex items-center`}
                                  >
                                    <input type="checkbox" checked={t.completed} readOnly className="w-3 h-3 mr-1" />
                                    {t.title}
                                  </div>
                                ))}
                              </div>
                            )}

                            {dayEvs.map(ev => (
                              <div
                                key={ev.id}
                                onClick={e => { e.stopPropagation(); openViewModal(ev); }}
                                className={`absolute inset-x-1 top-1 h-5 rounded px-1 text-xs ${ev.color} text-white flex items-center truncate`}
                              >
                                {ev.time} {ev.title}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeView === 'Day' && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200/30">
                  <div className="text-sm text-gray-500">{displayedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                </div>

                <div className="relative h-[1400px]">
                  {HOURS.map(h => (
                    <div key={h} className="flex border-b border-gray-200/20" style={{ height: '58px' }}>
                      <div className="w-16 flex items-center justify-end pr-2 text-xs text-gray-500">{fmtHour(h)}</div>
                      <div
                        className="flex-1 relative hover:bg-white/5 cursor-pointer"
                        onClick={() => openAddModal(displayedDate)}
                      >
                        {h === 0 && (
                          <div className="absolute inset-x-0 top-0 h-6 flex flex-col gap-1 px-1 overflow-hidden">
                            {eventsForDateKey(dayKey).filter(e => !e.time).map(ev => (
                              <div
                                key={ev.id}
                                onClick={e => { e.stopPropagation(); openViewModal(ev); }}
                                className={`text-xs truncate rounded px-1 ${ev.color} text-white`}
                              >
                                {ev.title}
                              </div>
                            ))}
                            {tasksForDateKey(dayKey).map(t => (
                              <div
                                key={t.id}
                                onClick={e => { e.stopPropagation(); openViewModal(t); }}
                                className={`text-xs truncate rounded px-1 ${t.completed ? 'bg-gray-400 line-through' : 'bg-gray-300'} text-gray-800 flex items-center`}
                              >
                                <input type="checkbox" checked={t.completed} readOnly className="w-3 h-3 mr-1" />
                                {t.title}
                              </div>
                            ))}
                          </div>
                        )}

                        {eventsForDateKey(dayKey)
                          .filter(e => e.time?.split(':')[0] === String(h).padStart(2, '0'))
                          .map(ev => (
                            <div
                              key={ev.id}
                              onClick={e => { e.stopPropagation(); openViewModal(ev); }}
                              className={`absolute inset-x-1 top-1 h-5 rounded px-1 text-xs ${ev.color} text-white flex items-center truncate`}
                            >
                              {ev.time} {ev.title}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeView === 'Schedule' && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-4">
                <ul className="space-y-3">
                  {scheduleList.length === 0 && <div className="text-gray-500">No items</div>}
                  {scheduleList.map(it => (
                    <li
                      key={it.id}
                      onClick={() => openViewModal(it)}
                      className="p-3 bg-white/5 rounded-md flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {it.type === 'task' && (
                            <input
                              type="checkbox"
                              checked={it.completed}
                              onChange={e => { e.stopPropagation(); toggleTaskComplete(it.id); }}
                              className="rounded"
                            />
                          )}
                          {it.title}
                        </div>
                        <div className="text-sm text-gray-400">
                          {it.time ? `${it.time} • ` : ''}{fmtFullDate(it.dateKey)}
                        </div>
                      </div>
                      {it.type === 'event' && <div className={`w-3 h-3 rounded-full ${it.color}`} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {activeTab === 'Tasks' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center">
                <span className="mr-2">Tasks</span>
                <span className="text-sm text-white/60">({filteredItems.filter(i => i.type === 'task').length})</span>
              </h3>

              {/* Group By and Sort By Controls */}
              <div className="flex gap-2">
                {/* Phase 3: Bulk Select Toggle */}
                <button
                  onClick={() => {
                    setBulkSelectMode(!bulkSelectMode);
                    setSelectedTaskIds(new Set());
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${bulkSelectMode
                      ? 'bg-blue-500 text-white'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/15'
                    }`}
                >
                  {bulkSelectMode ? 'Cancel' : 'Select'}
                </button>

                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as any)}
                  className="px-3 py-1.5 text-sm bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                >
                  <option value="none">No Grouping</option>
                  <option value="priority">Group by Priority</option>
                  <option value="status">Group by Status</option>
                  <option value="date">Group by Date</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-1.5 text-sm bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                >
                  <option value="date">Sort by Date</option>
                  <option value="priority">Sort by Priority</option>
                  <option value="alpha">Sort Alphabetically</option>
                </select>
              </div>
            </div>

            {/* Phase 3: Bulk Action Buttons */}
            {bulkSelectMode && (
              <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={selectAllTasks}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Select All
                  </button>
                  <span className="text-white/40">|</span>
                  <button
                    onClick={deselectAllTasks}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Deselect All
                  </button>
                  <span className="text-white/40 ml-2">
                    {selectedTaskIds.size} selected
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={bulkCompleteSelected}
                    disabled={selectedTaskIds.size === 0}
                    className="px-3 py-1.5 text-sm bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Complete Selected
                  </button>
                  <button
                    onClick={bulkDeleteSelected}
                    disabled={selectedTaskIds.size === 0}
                    className="px-3 py-1.5 text-sm bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            )}

            {filteredItems.filter(i => i.type === 'task').length === 0 ? (
              <div className="text-center py-12 text-white/40">
                <p>No tasks found</p>
                {(searchQuery || priorityFilter !== 'all' || statusFilter !== 'all' || tagFilter !== 'all') && (
                  <p className="text-sm mt-2">Try adjusting your filters</p>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredItems
                  .filter(i => i.type === 'task')
                  .sort((a, b) => {
                    if (sortBy === 'date') return a.dateKey.localeCompare(b.dateKey);
                    if (sortBy === 'priority') {
                      const priorityOrder = { high: 0, medium: 1, low: 2 };
                      return (priorityOrder[a.priority as keyof typeof priorityOrder] || 3) -
                        (priorityOrder[b.priority as keyof typeof priorityOrder] || 3);
                    }
                    return a.title.localeCompare(b.title);
                  })
                  .map(t => (
                    <li key={t.id} className="flex items-start space-x-3 p-3 bg-white/5 rounded-md hover:bg-white/10 transition-colors group">
                      {/* Phase 3: Bulk select checkbox or regular checkbox */}
                      {bulkSelectMode ? (
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.has(t.id)}
                          onChange={() => toggleTaskSelection(t.id)}
                          className="mt-1 rounded w-5 h-5"
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={t.completed}
                          onChange={() => toggleTaskComplete(t.id)}
                          className="mt-1 rounded"
                        />
                      )}

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`${t.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                            {t.title}
                          </span>
                          {t.priority && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${t.priority === 'high' ? 'bg-white/20 text-white' :
                                t.priority === 'medium' ? 'bg-white/15 text-white/80' :
                                  'bg-white/10 text-white/60'
                              }`}>
                              {t.priority}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {fmtFullDate(t.dateKey)}
                        </div>
                        {t.tags && t.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {t.tags.map(tag => (
                              <span key={tag} className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Phase 3: Duplicate button */}
                      {!bulkSelectMode && (
                        <button
                          onClick={() => duplicateTask(t.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs bg-white/10 text-white/60 hover:bg-white/20 hover:text-white rounded"
                          title="Duplicate task"
                        >
                          Duplicate
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}

            <button
              onClick={() => openAddModal(new Date(), 'task')}
              className="mt-6 w-full py-3 px-4 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              + Add Task
            </button>
          </div>
        )}
      </div>

      {
        isModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-50">
            <div className="bg-[#2B2B2B] rounded-[20px] shadow-lg p-6 w-full max-w-md relative">
              <button onClick={closeModal} className="cursor-pointer absolute top-3 right-3 text-gray-500 hover:text-gray-700">
                <X />
              </button>

              {!selectedItem && selectedDateForModal && (
                <>
                  <h3 className="text-lg font-semibold mb-3">Add New</h3>
                  <div className="text-sm text-gray-500 mb-4">
                    {selectedDateForModal.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>

                  <div className="flex mb-4 border border-white/20 rounded-full overflow-hidden">
                    {(['event', 'task'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModalMode(m)}
                        className={`cursor-pointer flex-1 py-2 text-sm font-medium transition-colors ${modalMode === m
                          ? 'bg-blue-500 text-white'
                          : 'bg-white/10 text-white/40'
                          }`}
                      >
                        {m === 'event' ? 'Event' : 'Task'}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={handleAddSubmit} className="space-y-3">
                    <input
                      name="title"
                      placeholder={modalMode === 'event' ? 'Event title' : 'Task name'}
                      required
                      className="w-full px-3 py-2 bg-transparent border-b-2 border-gray-100 text-white focus:ring-0 focus:outline-none"
                    />

                    {modalMode === 'event' && (
                      <>
                        <input
                          type="time"
                          name="time"
                          defaultValue="00:00"
                          className="w-fit px-3 py-2 bg-white/10 rounded-md cursor-pointer border border-white/20 text-white bg-[#2D2D2D] focus:ring-0 focus:outline-none"
                        />
                        <select name="color" className="w-full px-3 py-2 bg-[#2D2D2D] rounded-md cursor-pointer border border-white/20 text-white focus:ring-0 focus:outline-none">
                          <option value="bg-blue-500">Blue</option>
                          <option value="bg-red-500">Red</option>
                          <option value="bg-green-500">Green</option>
                          <option value="bg-purple-500">Purple</option>
                        </select>
                      </>
                    )}

                    <textarea
                      name="desc"
                      placeholder="Description (optional)"
                      className="w-full px-3 py-2 rounded-md bg-white/10 text-white/40 resize-none focus:ring-0 focus:outline-none"
                      rows={4}
                    />

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="cursor-pointer px-4 py-2 rounded-md border border-white/20 text-white/50 hover:bg-white/15"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                      >
                        Add {modalMode === 'event' ? 'Event' : 'Task'}
                      </button>
                    </div>
                  </form>
                </>
              )}

              {selectedItem && (
                <>
                  <h3 className="text-lg font-semibold mb-2">
                    {selectedItem.type === 'event' ? 'Event' : 'Task'} Details
                  </h3>
                  <div className="text-sm text-gray-500 mb-4">
                    {fmtFullDate(selectedItem.dateKey)} {selectedItem.time ? `• ${selectedItem.time}` : ''}
                  </div>

                  <div className="mb-4">
                    {selectedItem.type === 'task' && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedItem.completed}
                          onChange={() => toggleTaskComplete(selectedItem.id)}
                          className="rounded w-4 h-4"
                        />
                        <span className={`${selectedItem.completed ? 'line-through text-gray-500' : ''}`}>
                          {selectedItem.title}
                        </span>
                      </label>
                    )}
                    {selectedItem.type === 'event' && (
                      <>
                        <div className="font-medium">{selectedItem.title}</div>
                        {selectedItem.desc && <div className="text-sm text-gray-600 mt-1">{selectedItem.desc}</div>}
                      </>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    {selectedItem.type === 'event' && (
                      <div className={`w-4 h-4 rounded-full ${selectedItem.color}`} />
                    )}
                    <div className="flex gap-2">
                      <button onClick={closeModal} className="px-3 py-2 rounded-md border">
                        Close
                      </button>
                      <button
                        onClick={() => deleteItem(selectedItem.id)}
                        className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Activity;