import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getCacheTimestamp, isCacheValid } from '../utils/cacheUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export interface ClaimableStatus {
  claimable_tasks: number;
  claimable_research: number;
  total_activities: number;
  total_claimable_points: number;
}

interface PointsState {
  claimable: ClaimableStatus | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
}

const initialState: PointsState = {
  claimable: null,
  loading: false,
  error: null,
  lastFetch: null,
};

export const fetchClaimablePoints = createAsyncThunk(
  'points/fetchClaimablePoints',
  async (userId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { points: PointsState };
      
      // Cache check
      if (isCacheValid(state.points.lastFetch) && state.points.claimable) {
        return { claimable: state.points.claimable, fromCache: true };
      }

      const response = await fetch(`${API_BASE_URL}/api/task-points/claimable?user_id=${userId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Failed to fetch claimable points');
      
      const data = await response.json();
      return { claimable: data, fromCache: false };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch claimable points');
    }
  }
);

const pointsSlice = createSlice({
  name: 'points',
  initialState,
  reducers: {
    invalidateCache: (state) => {
      state.lastFetch = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchClaimablePoints.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchClaimablePoints.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.claimable = action.payload.claimable;
          state.lastFetch = getCacheTimestamp();
        }
      })
      .addCase(fetchClaimablePoints.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { invalidateCache } = pointsSlice.actions;
export default pointsSlice.reducer;
