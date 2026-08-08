import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  isAuthenticated: boolean;
  address: string | null;
  pubkeyHex: string | null;
  loading: boolean;
  message: string | null;
  isSupported: boolean;
  profile: any | null;
  profileLoading: boolean;
  profileFetched: boolean;
}

const initialState: AuthState = {
  isAuthenticated: false,
  address: null,
  pubkeyHex: null,
  loading: false,
  message: null,
  isSupported: false,
  profile: null,
  profileLoading: false,
  profileFetched: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth: (state, action: PayloadAction<{ address: string; pubkeyHex: string }>) => {
      state.isAuthenticated = true;
      state.address = action.payload.address;
      state.pubkeyHex = action.payload.pubkeyHex;
    },
    clearAuth: (state) => {
      state.isAuthenticated = false;
      state.address = null;
      state.pubkeyHex = null;
      state.message = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setMessage: (state, action: PayloadAction<string | null>) => {
      state.message = action.payload;
    },
    setSupported: (state, action: PayloadAction<boolean>) => {
      state.isSupported = action.payload;
    },
    updateAuthState: (state, action: PayloadAction<Partial<AuthState>>) => {
      return { ...state, ...action.payload };
    },
    setProfile: (state, action: PayloadAction<any | null>) => {
      state.profile = action.payload;
      state.profileLoading = false;
      state.profileFetched = true;
    },
    setProfileLoading: (state, action: PayloadAction<boolean>) => {
      state.profileLoading = action.payload;
    },
  },
});

export const { setAuth, clearAuth, setLoading, setMessage, setSupported, updateAuthState, setProfile, setProfileLoading } = authSlice.actions;
export default authSlice.reducer;
