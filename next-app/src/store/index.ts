'use client';

import { configureStore } from '@reduxjs/toolkit';
import chatsReducer from './slices/chatsSlice';
import leaderboardReducer from './slices/leaderboardSlice';
import eventsReducer from './slices/eventsSlice';
import tasksReducer from './slices/tasksSlice';

export const store = configureStore({
  reducer: {
    chats: chatsReducer,
    leaderboard: leaderboardReducer,
    events: eventsReducer,
    tasks: tasksReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
