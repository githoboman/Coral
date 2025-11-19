import { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, FileCheck, X, Loader2 } from "lucide-react"
import { taskApi, eventApi, Task, Event } from '@/hooks/taskApi'
import { useAuth } from '@/hooks/useAuth';

type Item = {
  id: number;
  type: 'event' | 'task';
  dateKey: string;               // YYYY-MM-DD
  title: string;
  time?: string;                 // HH:MM for events, optional for tasks
  desc?: string;
  color?: string;                // only for events
  completed?: boolean;           // only for tasks
  priority?: string;             // task priority
  tags?: string[];               // task tags
};

// Separate loading states for better UX
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

  // ────────────────────────────────────── UI states ──────────────────────────────────────
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

  // ────────────────────────────────────── Data ──────────────────────────────────────
  const [items, setItems] = useState<Item[]>([]);

  const views = ['Month', 'Week', 'Day', 'Schedule'];

  // ────────────────────────────────────── Load data from backend ──────────────────────────────────────
  const loadTasks = useCallback(async () => {
    if (!userId) return;

    try {
      setLoadingStates(prev => ({ ...prev, tasksLoading: true }));
      const response = await taskApi.getTasks(userId, { limit: 500 });

      // Convert backend tasks to frontend items
      const taskItems: Item[] = response.tasks.map(task => ({
        id: task.id!,
        type: 'task' as const,
        dateKey: task.due_date ? task.due_date.split('T')[0] : new Date().toISOString().split('T')[0],
        title: task.task_name,
        desc: task.description,
        completed: task.status === 'completed',
        priority: task.priority,
        tags: task.tags
      }));

      // Update items state - preserve events, replace tasks
      setItems(prev => [
        ...prev.filter(i => i.type === 'event'),
        ...taskItems
      ]);
    } catch (err) {
      console.error('Failed to load tasks:', err);
      setError('Failed to load tasks. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, tasksLoading: false, initialLoad: false }));
    }
  }, [userId]);

  const loadEvents = useCallback(async () => {
    if (!userId) return;

    try {
      setLoadingStates(prev => ({ ...prev, eventsLoading: true }));
      const response = await eventApi.getEvents(userId, { limit: 500 });

      // Convert backend events to frontend items
      const eventItems: Item[] = response.events.map(event => ({
        id: event.id!,
        type: 'event' as const,
        dateKey: event.event_date.split('T')[0],
        title: event.event_name,
        time: event.event_time,
        desc: event.description,
        color: event.color || 'bg-blue-500',
        tags: event.tags
      }));

      // Update items state - preserve tasks, replace events
      setItems(prev => [
        ...prev.filter(i => i.type === 'task'),
        ...eventItems
      ]);
    } catch (err) {
      console.error('Failed to load events:', err);
      setError('Failed to load events. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, eventsLoading: false, initialLoad: false }));
    }
  }, [userId]);

  const loadAllData = useCallback(async () => {
    if (!userId) return;

    setLoadingStates(prev => ({ ...prev, initialLoad: true }));
    await Promise.all([loadTasks(), loadEvents()]);
    setLoadingStates(prev => ({ ...prev, initialLoad: false }));
  }, [userId, loadTasks, loadEvents]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ────────────────────────────────────── Helpers ──────────────────────────────────────
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

  // ────────────────────────────────────── Grid data ──────────────────────────────────────
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

  // ────────────────────────────────────── Item helpers ──────────────────────────────────────
  const itemsForDateKey = (key: string) => items.filter(i => i.dateKey === key);
  const eventsForDateKey = (key: string) => items.filter(i => i.type === 'event' && i.dateKey === key);
  const tasksForDateKey = (key: string) => items.filter(i => i.type === 'task' && i.dateKey === key);

  // ────────────────────────────────────── Navigation ──────────────────────────────────────
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

  // ────────────────────────────────────── Modal actions ──────────────────────────────────────
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

      // Create a date at noon in local timezone to avoid timezone shifting
      const localDate = new Date(
        selectedDateForModal.getFullYear(),
        selectedDateForModal.getMonth(),
        selectedDateForModal.getDate(),
        12, 0, 0, 0 // Set to noon to avoid timezone issues
      );

      if (modalMode === 'event') {
        // Create event via API
        const eventData: Event = {
          user_id: userId,
          event_name: title,
          description: fd.get('desc')?.toString() || undefined,
          event_date: localDate.toISOString(),
          event_time: fd.get('time')?.toString() || undefined,
          color: (fd.get('color')?.toString() as Event['color']) || 'bg-blue-500',
          tags: fd.get('tags')?.toString().split(',').map(t => t.trim()).filter(Boolean) || [],
        };

        const createdEvent = await eventApi.createEvent(eventData);

        // Add to local state - use the original selected date key
        const newItem: Item = {
          id: createdEvent.id!,
          type: 'event',
          dateKey: dateToKey(selectedDateForModal), // Use original date to ensure correct day
          title: createdEvent.event_name,
          time: createdEvent.event_time,
          desc: createdEvent.description,
          color: createdEvent.color || 'bg-blue-500',
          tags: createdEvent.tags
        };
        setItems(prev => [...prev, newItem]);
      } else {
        // Create task via API
        const taskData: Task = {
          user_id: userId,
          task_name: title,
          description: fd.get('desc')?.toString() || undefined,
          due_date: localDate.toISOString(),
          priority: (fd.get('priority')?.toString() as 'low' | 'medium' | 'high') || 'medium',
          tags: fd.get('tags')?.toString().split(',').map(t => t.trim()).filter(Boolean) || [],
        };

        const createdTask = await taskApi.createTask(taskData);

        // Add to local state - use the original selected date key
        const newItem: Item = {
          id: createdTask.id!,
          type: 'task',
          dateKey: dateToKey(selectedDateForModal), // Use original date to ensure correct day
          title: createdTask.task_name,
          desc: createdTask.description,
          completed: false,
          priority: createdTask.priority,
          tags: createdTask.tags
        };
        setItems(prev => [...prev, newItem]);
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

      if (!task.completed) {
        await taskApi.completeTask(id, userId);
      } else {
        await taskApi.updateTask(id, userId, { status: 'pending' });
      }

      // Update local state
      setItems(prev => prev.map(i =>
        i.id === id && i.type === 'task'
          ? { ...i, completed: !i.completed }
          : i
      ));
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
        await taskApi.deleteTask(id, userId);
      } else {
        await eventApi.deleteEvent(id, userId);
      }

      // Remove from local state
      setItems(prev => prev.filter(i => i.id !== id));
      closeModal();
    } catch (err) {
      console.error('Failed to delete item:', err);
      setError('Failed to delete item. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, deleting: false }));
    }
  };

  // ────────────────────────────────────── Formatting ──────────────────────────────────────
  const fmtMonthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const fmtShortDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' });
  const fmtDayNumber = (d: Date) => d.getDate();
  const fmtFullDate = (key: string) => {
    const [y, m, day] = key.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtHour = (h: number) => `${pad(h)}:00`;

  // ────────────────────────────────────── Effects ──────────────────────────────────────
  useEffect(() => setIsDropdownOpen(false), [activeView]);

  // Show loading spinner only on initial load
  if (!userId || loadingStates.initialLoad) {
    return (
      <div className="h-dvh w-full flex justify-center items-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <p className="text-sm text-gray-400">Loading your calendar...</p>
        </div>
      </div>
    );
  }

  // Check if any operation is in progress
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

      {/* Small loading indicator for background operations */}
      {isAnyOperationInProgress && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-blue-500/90 backdrop-blur text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
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

      {/* ───────────────────── Main content ───────────────────── */}
      <div className="flex-1">
        {activeTab === 'Calendar' && (
          <>
            {/* Range header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">
                {activeView === 'Month' && fmtMonthYear(displayedDate)}
                {activeView === 'Week' && `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                {activeView === 'Day' && displayedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                {activeView === 'Schedule' && `Schedule – ${fmtMonthYear(displayedDate)}`}
              </h3>

              {/* Prev / Today / Next */}
              <div className="flex items-center space-x-2">
                <button onClick={goPrev} className="cursor-pointer p-2 rounded-md hover:bg-white/5 text-gray-500" title="Previous"><ChevronLeft /></button>
                <button onClick={goToday} className="cursor-pointer px-3 py-1 rounded-md bg-white/5 text-sm" title="Today">Today</button>
                <button onClick={goNext} className="cursor-pointer p-2 rounded-md hover:bg-white/5 text-gray-500" title="Next"><ChevronRight /></button>
              </div>
            </div>

            {/* Calendar views - keeping the same rendering logic as before */}
            {/* ─────── Month ─────── */}
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
                          {/* Events */}
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
                          {/* Tasks */}
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

            {/* ─────── Week ─────── */}
            {activeView === 'Week' && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-8 gap-0 border-b border-gray-200/30">
                  <div className="p-2 text-xs text-gray-500" /> {/* empty corner */}
                  {weekDays.map(d => (
                    <div key={dateToKey(d)} className="p-2 text-center">
                      <div className="text-xs text-gray-500">{fmtShortDay(d)}</div>
                      <div className="text-lg font-semibold">{fmtDayNumber(d)}</div>
                    </div>
                  ))}
                </div>

                {/* 24-hour rows */}
                <div className="relative h-[1400px]"> {/* fixed height → all 24 h visible */}
                  {HOURS.map(h => (
                    <div key={h} className="grid grid-cols-8 gap-0 border-b border-gray-200/20" style={{ height: '58px' }}>
                      {/* Hour label */}
                      <div className="flex items-center justify-end pr-2 text-xs text-gray-500">
                        {fmtHour(h)}
                      </div>

                      {/* Day columns */}
                      {weekDays.map(d => {
                        const key = dateToKey(d);
                        const dayEvs = eventsForDateKey(key).filter(e => e.time?.split(':')[0] === String(h).padStart(2, '0'));
                        const dayTasks = tasksForDateKey(key);

                        return (
                          <div
                            key={key}
                            className="relative border-l border-gray-200/20 hover:bg-white/5 cursor-pointer"
                            onClick={() => openAddModal(d)}
                          >
                            {/* All-day area (top of column) */}
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

                            {/* Timed events */}
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

            {/* ─────── Day ─────── */}
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
                        {/* All-day (top) */}
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

                        {/* Timed events */}
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

            {/* ─────── Schedule ─────── */}
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

        {/* ─────── Tasks Tab ─────── */}
        {activeTab === 'Tasks' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-sm p-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <span className="mr-2">Tasks</span>
            </h3>

            <ul className="space-y-3">
              {items
                .filter(i => i.type === 'task')
                .map(t => (
                  <li key={t.id} className="flex items-start space-x-3 p-3 bg-white/5 rounded-md">
                    <input
                      type="checkbox"
                      checked={t.completed}
                      onChange={() => toggleTaskComplete(t.id)}
                      className="mt-1 rounded"
                    />
                    <div className="flex-1">
                      <span className={`${t.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                        {t.title}
                      </span>
                      <div className="text-xs text-gray-500 mt-1">
                        {fmtFullDate(t.dateKey)}
                        {t.priority && ` • ${t.priority} priority`}
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
                  </li>
                ))}
            </ul>

            <button
              onClick={() => openAddModal(new Date(), 'task')}
              className="mt-6 w-full py-3 px-4 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              + Add Task
            </button>
          </div>
        )}
      </div>

      {/* ───────────────────── Modal (with priority and tags fields for tasks) ───────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-50">
          <div className="bg-[#2B2B2B] rounded-[20px] shadow-lg p-6 w-full max-w-md relative">
            <button onClick={closeModal} className="cursor-pointer absolute top-3 right-3 text-gray-500 hover:text-gray-700">
              <X />
            </button>

            {/* ───── Add modal: Always show toggle when adding ───── */}
            {!selectedItem && selectedDateForModal && (
              <>
                <h3 className="text-lg font-semibold mb-3">Add New</h3>
                <div className="text-sm text-gray-500 mb-4">
                  {selectedDateForModal.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>

                {/* Toggle: Event vs Task */}
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

            {/* ───── View modal (unchanged) ───── */}
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
      )}
    </div>
  );
};

export default Activity;