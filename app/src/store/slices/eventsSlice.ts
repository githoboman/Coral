import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { eventApi, Event } from '@/hooks/taskApi';
import { getCacheTimestamp, isCacheValid } from '../utils/cacheUtils';

interface EventsState {
  events: Event[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
}

const initialState: EventsState = {
  events: [],
  loading: false,
  error: null,
  lastFetch: null,
};

// Async thunks
export const fetchEvents = createAsyncThunk(
  'events/fetchEvents',
  async (userId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { events: EventsState };

      // Check cache validity
      if (isCacheValid(state.events.lastFetch) && state.events.events.length > 0) {
        return { events: state.events.events, fromCache: true };
      }

      const response = await eventApi.getEvents(userId, { limit: 500 });
      return { events: response.events, fromCache: false };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch events');
    }
  }
);

export const createEvent = createAsyncThunk(
  'events/createEvent',
  async (eventData: Event, { rejectWithValue }) => {
    try {
      const createdEvent = await eventApi.createEvent(eventData);
      return createdEvent;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to create event');
    }
  }
);

export const removeEvent = createAsyncThunk(
  'events/removeEvent',
  async ({ eventId, userId }: { eventId: number; userId: string }, { rejectWithValue }) => {
    try {
      await eventApi.deleteEvent(eventId, userId);
      return eventId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to delete event');
    }
  }
);

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    setEvents: (state, action: PayloadAction<Event[]>) => {
      state.events = action.payload;
      state.lastFetch = getCacheTimestamp();
    },
    addEvent: (state, action: PayloadAction<Event>) => {
      state.events.push(action.payload);
    },
    updateEvent: (state, action: PayloadAction<{ eventId: number; updates: Partial<Event> }>) => {
      const index = state.events.findIndex(e => e.id === action.payload.eventId);
      if (index !== -1) {
        state.events[index] = { ...state.events[index], ...action.payload.updates };
      }
    },
    deleteEvent: (state, action: PayloadAction<number>) => {
      state.events = state.events.filter(e => e.id !== action.payload);
    },
    invalidateCache: (state) => {
      state.lastFetch = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch events
      .addCase(fetchEvents.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEvents.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.events = action.payload.events;
          state.lastFetch = getCacheTimestamp();
        }
      })
      .addCase(fetchEvents.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      // Create event
      .addCase(createEvent.fulfilled, (state, action) => {
        state.events.push(action.payload);
      })
      .addCase(createEvent.rejected, (state, action) => {
        state.error = action.payload as string;
      })
      // Remove event
      .addCase(removeEvent.fulfilled, (state, action) => {
        state.events = state.events.filter(e => e.id !== action.payload);
      })
      .addCase(removeEvent.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const { setEvents, addEvent, updateEvent, deleteEvent, invalidateCache } = eventsSlice.actions;
export default eventsSlice.reducer;
