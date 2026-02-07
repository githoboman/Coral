import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { taskApi, Task } from '@/hooks/taskApi';
import { getCacheTimestamp, isCacheValid } from '../utils/cacheUtils';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
}

const initialState: TasksState = {
  tasks: [],
  loading: false,
  error: null,
  lastFetch: null,
};

// Async thunks
export const fetchTasks = createAsyncThunk(
  'tasks/fetchTasks',
  async (userId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { tasks: TasksState };

      // Check cache validity
      if (isCacheValid(state.tasks.lastFetch) && state.tasks.tasks.length > 0) {
        return { tasks: state.tasks.tasks, fromCache: true };
      }

      const response = await taskApi.getTasks(userId, { limit: 500 });
      return { tasks: response.tasks, fromCache: false };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch tasks');
    }
  }
);

export const createTask = createAsyncThunk(
  'tasks/createTask',
  async (taskData: Task, { rejectWithValue }) => {
    try {
      const createdTask = await taskApi.createTask(taskData);
      return createdTask;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to create task');
    }
  }
);

export const updateTaskStatus = createAsyncThunk(
  'tasks/updateTaskStatus',
  async ({ taskId, userId, completed }: { taskId: number; userId: string; completed: boolean }, { rejectWithValue }) => {
    try {
      let response;
      if (completed) {
        response = await taskApi.completeTask(taskId, userId);
      } else {
        response = await taskApi.updateTask(taskId, userId, { status: 'pending' });
      }
      return { taskId, completed, task: response };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update task');
    }
  }
);

export const removeTask = createAsyncThunk(
  'tasks/removeTask',
  async ({ taskId, userId }: { taskId: number; userId: string }, { rejectWithValue }) => {
    try {
      await taskApi.deleteTask(taskId, userId);
      return taskId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to delete task');
    }
  }
);

// Fetch tasks that have Web3 actions ready to execute
export const fetchActionableTasks = createAsyncThunk(
  'tasks/fetchActionableTasks',
  async (userId: string, { rejectWithValue }) => {
    try {
      const response = await taskApi.getActionableTasks(userId);
      return response.tasks;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch actionable tasks');
    }
  }
);

// Confirm task action after transaction is submitted
export const confirmAction = createAsyncThunk(
  'tasks/confirmAction',
  async (
    { taskId, userId, txDigest }: { taskId: number; userId: string; txDigest: string },
    { rejectWithValue }
  ) => {
    try {
      const result = await taskApi.confirmTaskAction(taskId, userId, txDigest);
      return { taskId, task: result };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to confirm task action');
    }
  }
);


const tasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    setTasks: (state, action: PayloadAction<Task[]>) => {
      state.tasks = action.payload;
      state.lastFetch = getCacheTimestamp();
    },
    addTask: (state, action: PayloadAction<Task>) => {
      state.tasks.push(action.payload);
    },
    updateTask: (state, action: PayloadAction<{ taskId: number; updates: Partial<Task> }>) => {
      const index = state.tasks.findIndex(t => t.id === action.payload.taskId);
      if (index !== -1) {
        state.tasks[index] = { ...state.tasks[index], ...action.payload.updates };
      }
    },
    deleteTask: (state, action: PayloadAction<number>) => {
      state.tasks = state.tasks.filter(t => t.id !== action.payload);
    },
    invalidateCache: (state) => {
      state.lastFetch = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch tasks
      .addCase(fetchTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.tasks = action.payload.tasks;
          state.lastFetch = getCacheTimestamp();
        }
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      // Create task
      .addCase(createTask.fulfilled, (state, action) => {
        state.tasks.push(action.payload);
      })
      .addCase(createTask.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      // Update task status
      .addCase(updateTaskStatus.fulfilled, (state, action) => {
        const index = state.tasks.findIndex(t => t.id === action.payload.taskId);
        if (index !== -1) {
          state.tasks[index] = { ...state.tasks[index], ...action.payload.task };
        }
      })
      .addCase(updateTaskStatus.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      // Remove task
      .addCase(removeTask.fulfilled, (state, action) => {
        state.tasks = state.tasks.filter(t => t.id !== action.payload);
      })
      .addCase(removeTask.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      // Confirm action (update task after tx confirmed)
      .addCase(confirmAction.fulfilled, (state, action) => {
        const index = state.tasks.findIndex(t => t.id === action.payload.taskId);
        if (index !== -1) {
          state.tasks[index] = { ...state.tasks[index], ...action.payload.task };
        }
      })
      .addCase(confirmAction.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const { setTasks, addTask, updateTask, deleteTask, invalidateCache } = tasksSlice.actions;
export default tasksSlice.reducer;
