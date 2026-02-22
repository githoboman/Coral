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

export interface UserRank {
  rank: number | null;
  points: number;
  total_participants: number;
}

interface LeaderboardState {
  entries: LeaderboardEntry[];
  userRank: UserRank | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  lastWalletAddress: string | null;
}

const initialState: LeaderboardState = {
  entries: [],
  userRank: null,
  loading: false,
  error: null,
  lastFetch: null,
  lastWalletAddress: null,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Async thunk to fetch leaderboard with optional force refresh
export const fetchLeaderboard = createAsyncThunk(
  "leaderboard/fetchLeaderboard",
  async ({ forceRefresh = false, walletAddress }: { forceRefresh?: boolean; walletAddress?: string } = {}, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { leaderboard: LeaderboardState };

      // WALLET-AWARE CACHE VALIDATION:
      // Skip cache if:
      // 1. forceRefresh is true
      // 2. Cache expired
      // 3. Wallet address changed (e.g. guest -> connected, or user changed accounts)
      const walletChanged = walletAddress !== state.leaderboard.lastWalletAddress;

      if (
        !forceRefresh &&
        !walletChanged &&
        isCacheValid(state.leaderboard.lastFetch, CACHE_TTL) &&
        state.leaderboard.entries.length > 0
      ) {
        return {
          entries: state.leaderboard.entries,
          userRank: state.leaderboard.userRank,
          walletAddress: state.leaderboard.lastWalletAddress,
          fromCache: true
        };
      }

      const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
      const url = new URL(`${apiBaseUrl}/api/leaderboard`);
      if (walletAddress) {
        url.searchParams.set('wallet_address', walletAddress);
      }
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error("Failed to fetch leaderboard");
      }

      const data = await response.json();
      return {
        entries: data.leaderboard || [],
        userRank: data.user_rank || null,
        walletAddress: walletAddress || null,
        fromCache: false
      };
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
      state.lastWalletAddress = null;
    },
    clearLeaderboard: (state) => {
      state.entries = [];
      state.lastFetch = null;
      state.lastWalletAddress = null;
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
          state.userRank = action.payload.userRank;
          state.lastWalletAddress = action.payload.walletAddress;
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
