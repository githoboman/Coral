import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UIState {
  // Modal states
  isModalOpen: boolean;
  modalMode: 'event' | 'task';
  selectedItem: any | null;
  selectedDateForModal: Date | null;

  // Dropdown states
  isDropdownOpen: boolean;
  chatMenuOpen: string | null;

  // View preferences
  activeView: 'Month' | 'Week' | 'Day' | 'Schedule';
  activeTab: 'Calendar' | 'Tasks';

  // Edit states
  editingChatId: string | null;

  // Search
  searchQuery: string;
}

const initialState: UIState = {
  isModalOpen: false,
  modalMode: 'event',
  selectedItem: null,
  selectedDateForModal: null,
  isDropdownOpen: false,
  chatMenuOpen: null,
  activeView: 'Month',
  activeTab: 'Calendar',
  editingChatId: null,
  searchQuery: '',
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openModal: (state, action: PayloadAction<{ mode: 'event' | 'task'; date?: Date; item?: any }>) => {
      state.isModalOpen = true;
      state.modalMode = action.payload.mode;
      state.selectedDateForModal = action.payload.date || null;
      state.selectedItem = action.payload.item || null;
    },
    closeModal: (state) => {
      state.isModalOpen = false;
      state.selectedItem = null;
      state.selectedDateForModal = null;
    },
    setModalMode: (state, action: PayloadAction<'event' | 'task'>) => {
      state.modalMode = action.payload;
    },
    toggleDropdown: (state, action: PayloadAction<boolean | undefined>) => {
      state.isDropdownOpen = action.payload !== undefined ? action.payload : !state.isDropdownOpen;
    },
    setChatMenuOpen: (state, action: PayloadAction<string | null>) => {
      state.chatMenuOpen = action.payload;
    },
    setActiveView: (state, action: PayloadAction<'Month' | 'Week' | 'Day' | 'Schedule'>) => {
      state.activeView = action.payload;
      state.isDropdownOpen = false;
    },
    setActiveTab: (state, action: PayloadAction<'Calendar' | 'Tasks'>) => {
      state.activeTab = action.payload;
    },
    setEditingChatId: (state, action: PayloadAction<string | null>) => {
      state.editingChatId = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setSelectedItem: (state, action: PayloadAction<any>) => {
      state.selectedItem = action.payload;
    },
  },
});

export const {
  openModal,
  closeModal,
  setModalMode,
  toggleDropdown,
  setChatMenuOpen,
  setActiveView,
  setActiveTab,
  setEditingChatId,
  setSearchQuery,
  setSelectedItem,
} = uiSlice.actions;

export default uiSlice.reducer;
