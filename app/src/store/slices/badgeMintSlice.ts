import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getCacheTimestamp, isCacheValid } from '../utils/cacheUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

interface UserBadgeInfo {
  hasMinted: boolean;
  badgeId: string | null;
  serial: number | null;
  totalMinted: number;
}

interface BadgeMintState {
  info: UserBadgeInfo | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  lastWalletAddress: string | null;
}

const initialState: BadgeMintState = {
  info: null,
  loading: false,
  error: null,
  lastFetch: null,
  lastWalletAddress: null,
};

export const fetchBadgeStatus = createAsyncThunk(
  'badgeMint/fetchBadgeStatus',
  async ({ address, suiClient, packageId, registryId }: { 
    address: string; 
    suiClient: any; 
    packageId: string; 
    registryId: string 
  }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { badgeMint: BadgeMintState };
      
      // Cache validation: check TTL and if wallet changed
      const walletChanged = address !== state.badgeMint.lastWalletAddress;
      if (!walletChanged && isCacheValid(state.badgeMint.lastFetch) && state.badgeMint.info) {
        return { info: state.badgeMint.info, fromCache: true, address };
      }

      // Fetch from chain
      const [registryObj, ownedBadges] = await Promise.all([
        suiClient.getObject({
          id: registryId,
          options: { showContent: true },
        }),
        suiClient.getOwnedObjects({
          owner: address,
          filter: {
            StructType: `${packageId}::testnet_badge::TestnetBadge`,
          },
          options: { showContent: true },
        })
      ]);

      const content = registryObj.data?.content as any;
      const totalMinted = Number(content?.fields?.total_minted ?? 0);
      
      const hasMinted = ownedBadges.data.length > 0;
      const badge = ownedBadges.data[0];
      const badgeContent = badge?.data?.content as any;

      const info: UserBadgeInfo = {
        hasMinted,
        badgeId: badge?.data?.objectId ?? null,
        serial: badgeContent?.fields?.serial ? Number(badgeContent.fields.serial) : null,
        totalMinted,
      };

      return { info, fromCache: false, address };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch badge status');
    }
  }
);

const badgeMintSlice = createSlice({
  name: 'badgeMint',
  initialState,
  reducers: {
    invalidateBadgeCache: (state) => {
      state.lastFetch = null;
    },
    updateTotalMinted: (state, action: PayloadAction<number>) => {
      if (state.info) {
        state.info.totalMinted = action.payload;
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBadgeStatus.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBadgeStatus.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.info = action.payload.info;
          state.lastFetch = getCacheTimestamp();
          state.lastWalletAddress = action.payload.address;
        }
      })
      .addCase(fetchBadgeStatus.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { invalidateBadgeCache, updateTotalMinted } = badgeMintSlice.actions;
export default badgeMintSlice.reducer;
