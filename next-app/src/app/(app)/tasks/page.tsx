'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, Filter } from "lucide-react"
import { Task, Event } from '@/hooks/taskApi'
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchTasks, createTask as createReduxTask, updateTaskStatus, removeTask } from '@/store/slices/tasksSlice';
import { fetchEvents, createEvent as createReduxEvent } from '@/store/slices/eventsSlice';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useDebounce } from '@/hooks/useDebounce';

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
  dueDate?: string;
};

type LoadingStates = {
  initialLoad: boolean;
  tasksLoading: boolean;
  eventsLoading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
};

export default function ActivityPage() {
  const currentAccount = useCurrentAccount();
  const userId = currentAccount?.address || "";

  // Redux state
  const dispatch = useAppDispatch();
  const tasks = useAppSelector(state => state.tasks.tasks);
  const events = useAppSelector(state => state.events.events);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'event' | 'task'>('task');
  const [selectedDateForModal, setSelectedDateForModal] = useState<Date | null>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    setSelectedDateForModal(new Date());
    // Give wallet auto-connect time to complete
    const timer = setTimeout(() => setWalletLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  // improved loading states
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    initialLoad: true,
    tasksLoading: false,
    eventsLoading: false,
    creating: false,
    updating: false,
    deleting: false,
  });

  const [searchQuery, setSearchQuery] = useState('');

  // Debounce search query (300ms delay)
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

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
      tags: task.tags,
      dueDate: task.due_date
    }));

    const eventItems: Item[] = events.map(event => ({
      id: event.id!,
      type: 'event' as const,
      dateKey: event.event_date.split('T')[0],
      title: event.event_name,
      time: event.event_time,
      desc: event.description,
      color: event.color || 'bg-blue-500',
      tags: event.tags,
      dueDate: event.event_date
    }));

    return [...taskItems, ...eventItems];
  }, [tasks, events]);

  // Stats calculations
  const stats = useMemo(() => {
    const taskList = items.filter(i => i.type === 'task');
    const totalTasks = taskList.length;
    const completedTasks = taskList.filter(t => t.completed).length;
    const pendingTasks = taskList.filter(t => !t.completed).length;

    const completedHigh = taskList.filter(t => t.completed && t.priority === 'high').length;
    const completedMedium = taskList.filter(t => t.completed && t.priority === 'medium').length;
    const completedLow = taskList.filter(t => t.completed && (t.priority === 'low' || !t.priority)).length;

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
    let result = items.filter(i => i.type === 'task'); // Only tasks for the main list

    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.desc?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, debouncedSearchQuery]);

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


  const openAddModal = (mode: 'event' | 'task' = 'task') => {
    setSelectedDateForModal(new Date());
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
        12, 0, 0, 0
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
    try {
      setLoadingStates(prev => ({ ...prev, deleting: true }));
      setError(null);
      await dispatch(removeTask({ taskId: id, userId }));
      closeModal();
    } catch (err) {
      console.error('Failed to delete item:', err);
      setError('Failed to delete item. Please try again.');
    } finally {
      setLoadingStates(prev => ({ ...prev, deleting: false }));
    }
  };

  const countdown = "58:58:59";

  const getPriorityColor = (p?: string) => {
    switch (p) {
      case 'high': return 'bg-[#3E1A1A] text-[#FF4444] border-[#FF4444]/20';
      case 'medium': return 'bg-[#3A2E14] text-[#FFAA00] border-[#FFAA00]/20';
      case 'low': return 'bg-[#143A22] text-[#00FF88] border-[#00FF88]/20';
      default: return 'bg-white/5 text-white/60 border-white/5';
    }
  };

  const getPriorityLabel = (p?: string) => {
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Normal';
  };

  if (!mounted || walletLoading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60dvh] text-center px-4">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
          <Search size={40} className="text-white/20" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Connect your wallet</h2>
        <p className="text-white/40 max-w-xs mb-8">
          Please connect your Sui wallet to view and manage your tasks.
        </p>
      </div>
    );
  }

  if (loadingStates.initialLoad) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto px-4 pb-6 pt-6 animate-in fade-in duration-500">
      {/* Error notification */}
      {error && (
        <div className="fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-md shadow-lg z-50 flex items-center gap-2 animate-slide-in">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:bg-red-600 rounded p-1 transition-colors">
            <div className="w-4 h-4 flex items-center justify-center font-bold">×</div>
          </button>
        </div>
      )}

      {/* Top Section Cards */}
      <div className="flex flex-col md:flex-row gap-6 mb-10">
        {/* Countdown Card - Left */}
        <div className="w-full md:w-[280px] bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#246AFC]/10 blur-[50px] rounded-full pointer-events-none" />
          <div>
            <div className="text-[32px] font-mono font-bold text-white tracking-wider mb-1">
              {countdown}
            </div>
            <div className="text-[13px] text-white/40 font-medium">
              Countdown to next task
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between">
            <span className="text-[11px] text-white/30 font-bold uppercase tracking-wider">
              Check SUI price...
            </span>
            <button className="bg-[#246AFC] hover:bg-[#1a55cc] text-white text-[10px] font-bold px-3 py-1.5 rounded-full transition-all flex items-center gap-1">
              View <ChevronRight size={10} />
            </button>
          </div>
        </div>

        {/* Stats & Progress Card - Right */}
        <div className="flex-1 bg-[#0A0A0A] border border-white/5 rounded-[30px] p-6 relative overflow-hidden">
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-[#B7FC0D]/5 blur-[60px] rounded-full pointer-events-none" />
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-4">
              <span className="text-[40px] font-light text-white leading-none">
                {stats.totalTasks}
              </span>
              <span className="text-[15px] text-white font-medium max-w-[100px] leading-tight">
                Total number of tasks
              </span>
            </div>
            <button
              onClick={() => openAddModal('task')}
              className="bg-[#246AFC] hover:bg-[#1a55cc] text-white px-5 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 transition-all shadow-[0_4px_20px_rgba(36,106,252,0.3)] hover:shadow-[0_6px_25px_rgba(36,106,252,0.4)] active:scale-95"
            >
              <Plus size={16} /> New Task
            </button>
          </div>

          <div className="w-full h-12 bg-[#1A1A1A] rounded-full p-1.5 flex relative z-0">
            {stats.completedLow > 0 && (
              <div
                className={`h-full bg-[#00C853] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-30 ${(stats.completedMedium > 0 || stats.completedHigh > 0 || stats.pendingTasks > 0) ? '-mr-8' : ''}`}
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
            {stats.completedMedium > 0 && (
              <div
                className={`h-full bg-[#FFAA00] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-20 ${(stats.completedHigh > 0 || stats.pendingTasks > 0) ? '-mr-8' : ''}`}
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
            {stats.completedHigh > 0 && (
              <div
                className={`h-full bg-[#D32F2F] rounded-full relative flex items-center justify-end px-3 transition-all duration-500 hover:brightness-110 z-10 ${(stats.pendingTasks > 0) ? '-mr-8' : ''}`}
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
            {stats.pendingTasks > 0 && (
              <div className="h-full bg-[#424242] rounded-full relative flex-1 flex items-center justify-end px-4 transition-all duration-500 hover:brightness-110 z-0">
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

      {/* Middle Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-[22px] font-bold text-white self-start md:self-auto">Tasks overview</h2>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <button className="flex items-center gap-2 bg-[#0A0A0A] border border-white/10 px-4 py-2.5 rounded-full text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all min-w-[120px] justify-between">
              <span>Filter by</span>
              <Filter size={14} className="opacity-50" />
            </button>
          </div>
          <div className="relative flex-1 md:w-[300px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={16} />
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
                className={`group flex items-center justify-between py-6 ${index !== filteredItems.length - 1 ? 'border-b border-white/5' : ''} transition-all duration-300 hover:bg-white/[0.02] -mx-4 px-4 lg:-mx-6 lg:px-6 rounded-xl`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <button
                    onClick={() => toggleTaskComplete(item.id)}
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${item.completed ? 'bg-[#246AFC] border-[#246AFC]' : 'border-white/20 hover:border-white/40'}`}
                  >
                    {item.completed && <div className="w-1.5 h-3 border-r-2 border-b-2 border-white rotate-45 mb-1" />}
                  </button>
                  <span className={`text-[16px] font-medium truncate ${item.completed ? 'text-white/30 line-through' : 'text-white/80'}`}>
                    {item.title}
                  </span>
                </div>
                <div className="flex items-center gap-8 md:gap-12 flex-shrink-0 ml-4">
                  <span className={`px-3 py-1 rounded-full text-[11px] font-bold border capitalize min-w-[80px] text-center ${getPriorityColor(item.priority)}`}>
                    {getPriorityLabel(item.priority)}
                  </span>
                  <div className="hidden md:flex items-center gap-2 text-white/80 font-mono text-sm">
                    <span>59:59:59</span>
                  </div>
                  <button
                    onClick={() => openViewModal(item)}
                    className="flex items-center gap-1 text-[11px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-wider"
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
            <button
              onClick={() => openAddModal('task')}
              className="mt-4 text-[#246AFC] hover:underline text-sm"
            >
              Create a new task
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            {selectedItem ? (
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-xl font-bold text-white pr-8">{selectedItem.title}</h3>
                  <button onClick={closeModal} className="text-white/40 hover:text-white"><Plus className="rotate-45" size={24} /></button>
                </div>
                <div className="space-y-4 mb-8 text-white/70 text-sm">
                  {selectedItem.desc && <p className="bg-white/5 p-4 rounded-xl">{selectedItem.desc}</p>}
                  <div className="flex gap-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border capitalize ${getPriorityColor(selectedItem.priority)}`}>
                      {getPriorityLabel(selectedItem.priority)}
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/5 text-white/60 border border-white/5">
                      {selectedItem.dueDate ? new Date(selectedItem.dueDate).toLocaleDateString() : 'No date'}
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
                <h3 className="text-lg font-bold text-white mb-6">Create New {modalMode === 'task' ? 'Task' : 'Event'}</h3>
                <form onSubmit={handleAddSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/40 font-bold mb-2">Name</label>
                    <input name="title" autoFocus className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#246AFC] transition-colors" placeholder={`Enter ${modalMode} name...`} required />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/40 font-bold mb-2">Description</label>
                    <textarea name="desc" rows={3} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#246AFC] transition-colors" placeholder="Add details..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-white/40 font-bold mb-2">Priority</label>
                      <select name="priority" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#246AFC] transition-colors appearance-none cursor-pointer">
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white font-bold transition-colors">Cancel</button>
                    <button type="submit" className="px-6 py-2.5 rounded-xl bg-[#246AFC] hover:bg-[#1a55cc] text-white font-bold transition-colors shadow-lg shadow-blue-500/20">Create {modalMode === 'task' ? 'Task' : 'Event'}</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
