import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getCacheTimestamp, isCacheValid } from '../utils/cacheUtils';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface Chat {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
}


export interface Artifact {
  id: string;
  type: 'code' | 'markdown' | 'html' | 'svg' | 'react';
  title: string;
  content: string;
  language?: string;
  isOpen?: boolean;
}

export interface Message {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  chat_id?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  agentType?: string;
  agentId?: string;
  originalQuery?: string;
  gasFee?: string;
  variations?: string[];
  currentVariationIndex?: number;
  artifacts?: Artifact[];
}

interface ChatsState {
  chats: Chat[];
  currentChatId: string | null;
  messages: Record<string, Message[]>; // chatId -> messages
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  activeArtifact: Artifact | null;
}

const initialState: ChatsState = {
  chats: [],
  currentChatId: null,
  messages: {},
  loading: false,
  error: null,
  lastFetch: null,
  activeArtifact: null,
};

// Async thunks - Using Mock Data
export const fetchChats = createAsyncThunk(
  'chats/fetchChats',
  async (userId: string, { getState }) => {
    try {
      const state = getState() as { chats: ChatsState };

      // Check cache validity
      if (isCacheValid(state.chats.lastFetch) && state.chats.chats.length > 0) {
        return { chats: state.chats.chats, fromCache: true };
      }

      // Fetch from real API
      const response = await fetch(`${apiBaseUrl}/api/chats/${userId}`);

      // Handle 404 as empty chats (user has no chats yet)
      if (response.status === 404) {
        return { chats: [], fromCache: false };
      }

      if (!response.ok) {
        throw new Error('Failed to fetch chats');
      }

      const chats = await response.json();

      return { chats, fromCache: false };
    } catch (error: any) {
      // Return empty array on error instead of rejecting
      console.warn('Failed to fetch chats:', error.message);
      return { chats: [], fromCache: false };
    }
  }
);

export const fetchChatHistory = createAsyncThunk(
  'chats/fetchChatHistory',
  async (chatId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { chats: ChatsState };

      // Check if we have cached messages for this chat
      if (state.chats.messages[chatId] && state.chats.messages[chatId].length > 0) {
        return { chatId, messages: state.chats.messages[chatId], fromCache: true };
      }

      // Fetch from real API
      const response = await fetch(`${apiBaseUrl}/api/chats/${chatId}/messages`);

      if (!response.ok) {
        throw new Error('Failed to fetch chat messages');
      }

      const data = await response.json();

      // Transform backend data to frontend Message format
      const messages: Message[] = data.map((msg: any, index: number) => ({
        id: msg.id || msg.message_id || (Date.now() + index),
        text: msg.query || msg.response || '',
        sender: msg.sender as 'user' | 'ai',
        timestamp: new Date(msg.timestamp).toLocaleTimeString(),
        chat_id: chatId,
        agentType: msg.agent_type,
      }));

      return { chatId, messages, fromCache: false };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const chatsSlice = createSlice({
  name: 'chats',
  initialState,
  reducers: {
    setChats: (state, action: PayloadAction<Chat[]>) => {
      state.chats = action.payload;
      state.lastFetch = getCacheTimestamp();
    },
    addChat: (state, action: PayloadAction<Chat>) => {
      state.chats.unshift(action.payload);
      state.lastFetch = getCacheTimestamp();
    },
    updateChat: (state, action: PayloadAction<{ chatId: string; updates: Partial<Chat> }>) => {
      const index = state.chats.findIndex(c => c.chat_id === action.payload.chatId);
      if (index !== -1) {
        state.chats[index] = { ...state.chats[index], ...action.payload.updates };
      } else {
        // Add new chat if it doesn't exist
        const newChat: Chat = {
          chat_id: action.payload.chatId,
          name: action.payload.updates.name || 'New Chat',
          created_at: action.payload.updates.created_at || new Date().toISOString(),
          last_updated: action.payload.updates.last_updated || new Date().toISOString(),
        };
        state.chats.unshift(newChat);
      }
    },
    deleteChat: (state, action: PayloadAction<string>) => {
      state.chats = state.chats.filter(c => c.chat_id !== action.payload);
      delete state.messages[action.payload];
      if (state.currentChatId === action.payload) {
        state.currentChatId = null;
      }
    },
    setCurrentChat: (state, action: PayloadAction<string | null>) => {
      state.currentChatId = action.payload;
    },
    setMessages: (state, action: PayloadAction<{ chatId: string; messages: Message[] }>) => {
      state.messages[action.payload.chatId] = action.payload.messages;
    },
    addMessage: (state, action: PayloadAction<{ chatId: string; message: Message }>) => {
      const chatId = action.payload.chatId;
      if (!state.messages[chatId]) {
        state.messages[chatId] = [];
      }
      state.messages[chatId].push(action.payload.message);
    },
    clearMessages: (state, action: PayloadAction<string>) => {
      delete state.messages[action.payload];
    },
    invalidateCache: (state) => {
      state.lastFetch = null;
    },
    setActiveArtifact: (state, action: PayloadAction<Artifact | null>) => {
      state.activeArtifact = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchChats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchChats.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.chats = action.payload.chats;
          state.lastFetch = getCacheTimestamp();
        }
      })
      .addCase(fetchChats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(fetchChatHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchChatHistory.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.fromCache) {
          state.messages[action.payload.chatId] = action.payload.messages;
        }
      })
      .addCase(fetchChatHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setChats,
  addChat,
  updateChat,
  deleteChat,
  setCurrentChat,
  setMessages,
  addMessage,
  clearMessages,
  invalidateCache,
  setActiveArtifact,
} = chatsSlice.actions;

export default chatsSlice.reducer;

