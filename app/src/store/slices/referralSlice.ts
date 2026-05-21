import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export interface ReferralHistoryItem {
  id: string;
  status: 'pending' | 'claimable' | 'completed' | 'abandoned';
  points: number;
  email: string;
}

export interface ReferralStats {
  referral_code: string | null;
  successful_referrals: number;
  pending_referrals: number;
  points_earned: number;
  history: ReferralHistoryItem[];
}

interface ReferralState {
  stats: ReferralStats | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  lastWallet: string | null;
}

const initialState: ReferralState = {
  stats: null,
  loading: false,
  error: null,
  lastFetch: null,
  lastWallet: null,
};

const CACHE_TTL = 5 * 60 * 1000;

export const fetchReferralStats = createAsyncThunk<
  ReferralStats,
  { walletAddress: string },
  { state: { referral: ReferralState }; rejectValue: string }
>(
  "referral/fetchReferralStats",
  async ({ walletAddress }, { getState, rejectWithValue }) => {
    const cached = getState().referral;
    const walletChanged = walletAddress !== cached.lastWallet;
    const cacheValid =
      cached.lastFetch !== null && Date.now() - cached.lastFetch < CACHE_TTL;

    if (!walletChanged && cacheValid && cached.stats) {
      return cached.stats;
    }

    try {
      const base =
        (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:3000";
      const res = await fetch(`${base}/api/referrals/stats`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch referral stats");
      return (await res.json()) as ReferralStats;
    } catch (err: any) {
      return rejectWithValue(err.message ?? "Fetch error");
    }
  }
);

export const claimReferralPoints = createAsyncThunk<
  { id: string; points: number },
  string,
  { rejectValue: string }
>(
  "referral/claimReferralPoints",
  async (referralId, { rejectWithValue }) => {
    try {
      const base =
        (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:3000";
      const res = await fetch(`${base}/api/referrals/claim/${referralId}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to claim referral");
      return { id: referralId, points: data.points };
    } catch (err: any) {
      return rejectWithValue(err.message ?? "Claim error");
    }
  }
);

const referralSlice = createSlice({
  name: "referral",
  initialState,
  reducers: {
    clearReferral(state) {
      state.stats = null;
      state.lastFetch = null;
      state.lastWallet = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReferralStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchReferralStats.fulfilled, (state, action) => {
          state.loading = false;
          state.stats = action.payload;
          state.lastFetch = Date.now();
          state.lastWallet = action.meta.arg.walletAddress;
        })
      .addCase(fetchReferralStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Unknown error";
      })
      .addCase(claimReferralPoints.fulfilled, (state, action) => {
        if (state.stats) {
          const item = state.stats.history.find(h => h.id === action.payload.id);
          if (item) {
            item.status = 'completed';
            item.points = action.payload.points;
            state.stats.points_earned += action.payload.points;
            state.stats.successful_referrals += 1;
            if (state.stats.pending_referrals > 0) {
              state.stats.pending_referrals -= 1;
            }
          }
        }
      });
  },
});

export const { clearReferral } = referralSlice.actions;
export default referralSlice.reducer;
