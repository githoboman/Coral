import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import chatsReducer from './slices/chatsSlice';
import tasksReducer from './slices/tasksSlice';
import eventsReducer from './slices/eventsSlice';
import uiReducer from './slices/uiSlice';
import leaderboardReducer from './slices/leaderboardSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chats: chatsReducer,
    tasks: tasksReducer,
    events: eventsReducer,
    ui: uiReducer,
    leaderboard: leaderboardReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for Date serialization
        ignoredActions: ['ui/openModal', 'ui/setSelectedItem'],
        // Ignore these field paths in all actions
        ignoredActionPaths: ['payload.date', 'payload.item'],
        // Ignore these paths in the state
        ignoredPaths: ['ui.selectedDateForModal', 'ui.selectedItem'],
      },
    }),
});

// Expose dispatch to window for useAuth hook compatibility
if (typeof window !== 'undefined') {
  (window as any).__REDUX_DISPATCH__ = store.dispatch;
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
