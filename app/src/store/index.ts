import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';

import tasksReducer from './slices/tasksSlice';
import eventsReducer from './slices/eventsSlice';
import pointsReducer from './slices/pointsSlice';
import uiReducer from './slices/uiSlice';
import leaderboardReducer from './slices/leaderboardSlice';
import badgeMintReducer from './slices/badgeMintSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    tasks: tasksReducer,
    events: eventsReducer,
    points: pointsReducer,
    ui: uiReducer,
    leaderboard: leaderboardReducer,
    badgeMint: badgeMintReducer,
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
