export interface WalletData {
  name: string;
  session_id: string | null;
  added_time: number;
  last_checked: number | null;
}

export interface WalletState {
  previous_coins: Set<string>;
  previous_nfts: Set<string>;
  first_run: boolean;
  name: string;
  session_id: string | null;
  incoming_tx_count: number;
  outgoing_tx_count: number;
  incoming_nft_count: number;
  outgoing_nft_count: number;
}

export interface Notification {
  message: string;
  type: 'info' | 'success' | 'error' | 'outgoing';
  timestamp: number;
}

export interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
}

export interface Statistics {
  total_wallets: number;
  total_transactions: number;
  total_nfts: number;
}

export interface WalletInfo {
  address: string;
  name: string;
  coins: number;
  nfts: number;
  balance: number;
  added_time: number;
}

export interface GasData {
  data: {
    coinObjectId: string;
    balance: string;
  }[];
}

export interface NFTData {
  data: {
    objectId: string;
    type: string;
    display?: {
      name?: string;
      description?: string;
    };
  };
}

export interface WebSocketMessage {
  type: 'notification' | 'log' | 'stats' | 'wallets' | 'wallet_added' | 'wallet_removed';
  [key: string]: any;
}