import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getCacheTimestamp, isCacheValid } from "../utils/cacheUtils";

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  email?: string;
  points: number;
  referral_points: number;
}

interface LeaderboardState {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
}

const initialState: LeaderboardState = {
  entries: [],
  loading: false,
  error: null,
  lastFetch: null,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Async thunk to fetch leaderboard with optional force refresh
export const fetchLeaderboard = createAsyncThunk(
  "leaderboard/fetchLeaderboard",
  async (forceRefresh: boolean = false, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { leaderboard: LeaderboardState };

      // Check cache validity (5 minute TTL) - but skip if forceRefresh is true
      if (
        !forceRefresh &&
        isCacheValid(state.leaderboard.lastFetch, CACHE_TTL) &&
        state.leaderboard.entries.length > 0
      ) {
        return { entries: state.leaderboard.entries, fromCache: true };
      }

      const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      const response = await fetch(`${apiBaseUrl}/api/leaderboard`);

      if (!response.ok) {
        throw new Error("Failed to fetch leaderboard");
      }

      const data = await response.json();
      return { entries: data.leaderboard || [], fromCache: false };
    } catch (error: any) {
      return rejectWithValue(error.message || "Failed to fetch leaderboard");
    }
  },
);

const leaderboardSlice = createSlice({
  name: "leaderboard",
  initialState,
  reducers: {
    invalidateCache: (state) => {
      state.lastFetch = null;
    },
    clearLeaderboard: (state) => {
      state.entries = [];
      state.lastFetch = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLeaderboard.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLeaderboard.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.entries = action.payload.entries;
          state.lastFetch = getCacheTimestamp();
        }
      })
      .addCase(fetchLeaderboard.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { invalidateCache, clearLeaderboard } = leaderboardSlice.actions;
export default leaderboardSlice.reducer;
