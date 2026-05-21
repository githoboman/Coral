import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export interface ReferralStats {
  referral_code: string | null;
  successful_referrals: number;
  pending_referrals: number;
  points_earned: number;
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
      });
  },
});

export const { clearReferral } = referralSlice.actions;
export default referralSlice.reducer;
