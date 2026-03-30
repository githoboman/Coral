import axios from 'axios';
import { 
  WalletData, 
  WalletState, 
  Notification, 
  LogEntry, 
  Statistics, 
  WalletInfo,
  GasData
} from './types';

export class SuiWalletMonitor {
  // Private properties
  private walletStates: Map<string, WalletState> = new Map();
  private wallets: Map<string, WalletData> = new Map();
  private notifications: Notification[] = [];
  private logs: LogEntry[] = [];
  private statistics: Statistics = {
    total_wallets: 0,
    total_transactions: 0,
    total_nfts: 0
  };
  private rpcUrl: string;
  private isMonitoring: boolean = false;

  // Constructor
  constructor(rpcUrl: string = 'https://fullnode.testnet.sui.io:443') {
    this.rpcUrl = rpcUrl;
    console.log("✅ SUI Wallet Monitor initialized");
  }

  // ==================== Public Methods ====================

  /**
   * Add a wallet to monitor
   */
  addWallet(address: string, name?: string, sessionId: string | null = null): { success: boolean; message: string } {
    try {
      // Validation
      if (!this.isValidAddress(address)) {
        return { success: false, message: "Invalid wallet address format" };
      }

      if (this.wallets.has(address)) {
        return { success: false, message: "Wallet already being monitored" };
      }

      // Add wallet
      this.addWalletToStorage(address, name, sessionId);
      this.initializeWalletState(address, name, sessionId);
      
      // Update statistics
      this.statistics.total_wallets = this.wallets.size;
      
      // Log success
      this.addLog(`✅ Added wallet: ${address.slice(0, 16)}...`, "success");
      
      return { success: true, message: "Wallet added successfully" };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.addLog(`❌ Error adding wallet: ${errorMessage}`, "error");
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Remove a wallet from monitoring
   */
  removeWallet(address: string): { success: boolean; message: string } {
    try {
      if (!this.wallets.has(address)) {
        return { success: false, message: "Wallet not found" };
      }

      const wallet = this.wallets.get(address);
      const walletName = wallet?.name || address.slice(0, 16);

      // Remove from storage
      this.wallets.delete(address);
      this.walletStates.delete(address);
      
      // Update statistics
      this.statistics.total_wallets = this.wallets.size;

      // Log removal
      this.addLog(`🗑️ Removed wallet: ${walletName}`, "info");
      
      return { success: true, message: "Wallet removed successfully" };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.addLog(`❌ Error removing wallet: ${errorMessage}`, "error");
      return { success: false, message: errorMessage };
    }
  }

/**
 * Get all monitored wallets
 */
getWallets(sessionId: string | null = null): WalletInfo[] {
  const walletsList: WalletInfo[] = [];

  for (const [address, walletData] of this.wallets.entries()) {
    // Filter by session if provided
    if (sessionId !== null && walletData.session_id !== sessionId) {
      continue;
    }

    const state = this.walletStates.get(address);
    const walletInfo: WalletInfo = {
      address,
      name: walletData.name,
      coins: state ? state.previous_coins.size : 0,
      nfts: state ? state.previous_nfts.size : 0,
      balance: 0,
      added_time: walletData.added_time
    };

    walletsList.push(walletInfo);
  }

  return walletsList;
}

  /**
   * Start monitoring wallets
   */
  async startMonitoring(): Promise<void> {
    this.isMonitoring = true;
    
    while (this.isMonitoring) {
      try {
        await this.monitoringCycle();
        await this.sleep(5000); // Wait 5 seconds between cycles
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        this.addLog(`❌ Monitor loop error: ${errorMessage}`, "error");
        await this.sleep(10000); // Wait 10 seconds on error
      }
    }
  }

  /**
   * Stop monitoring wallets
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
  }

/**
 * Add a notification
 */
addNotification(message: string, notificationType: 'info' | 'success' | 'error' | 'outgoing' = "info"): void {
  const notification: Notification = {
    message,
    type: notificationType,
    timestamp: Date.now()
  };

  this.notifications.push(notification);

  // Keep only last 100 notifications - FIX: Use slice on the array
  if (this.notifications.length > 100) {
    this.notifications = this.notifications.slice(-100);
  }

  // Update statistics based on notification type
  this.updateStatisticsFromNotification(message);
}

/**
 * Add a log entry
 */
addLog(message: string, logType: 'info' | 'success' | 'error' = "info"): void {
  const logEntry: LogEntry = {
    message,
    type: logType,
    timestamp: Date.now()
  };

  this.logs.push(logEntry);

  // Keep only last 1000 logs - FIX: Use slice on the array
  if (this.logs.length > 1000) {
    this.logs = this.logs.slice(-1000);
  }

  console.log(`[${logType.toUpperCase()}] ${message}`);
}

  // ==================== Getter Methods ====================

  /**
   * Get monitoring statistics
   */
  getStatistics(): Statistics {
    return { ...this.statistics };
  }

  /**
   * Get recent notifications
   */
  getNotifications(limit: number = 50): Notification[] {
    return this.notifications.slice(-limit);
  }

  /**
   * Get recent logs
   */
  getLogs(limit: number = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Get total number of monitored wallets
   */
  getWalletCount(): number {
    return this.wallets.size;
  }

  // ==================== SUI RPC Methods ====================

  /**
   * Get gas data for a wallet
   */
  async getGas(address: string): Promise<GasData | null> {
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getGas",
        params: [address]
      });

      return response.data.result;
    } catch (error) {
      this.addLog(`Error getting gas for ${address.slice(0, 16)}...: ${error}`, "error");
      return null;
    }
  }

  /**
   * Get owned objects for a wallet
   */
  async getOwnedObjects(address: string): Promise<any[]> {
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getOwnedObjects",
        params: [address]
      });

      return response.data.result?.data || [];
    } catch (error) {
      this.addLog(`Error getting objects for ${address.slice(0, 16)}...: ${error}`, "error");
      return [];
    }
  }

  /**
   * Get NFTs for a wallet
   */
  async getNFTsForWallet(address: string): Promise<Set<string>> {
    try {
      const objects = await this.getOwnedObjects(address);
      const nfts = new Set<string>();

      for (const obj of objects) {
        if (this.isNFT(obj)) {
          nfts.add(obj.data.objectId);
        }
      }

      return nfts;
    } catch (error) {
      this.addLog(`Error getting NFTs for ${address.slice(0, 16)}...: ${error}`, "error");
      return new Set();
    }
  }

  /**
   * Get NFT details
   */
  async getNFTDetails(nftId: string): Promise<{ name: string; description: string }> {
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getObject",
        params: [nftId, { showDisplay: true }]
      });

      const objData = response.data.result;
      if (objData?.data?.display) {
        const display = objData.data.display;
        return {
          name: display.name || 'Unknown NFT',
          description: display.description || ''
        };
      }

      return { name: 'Unknown NFT', description: '' };
    } catch (error) {
      this.addLog(`Error getting NFT details for ${nftId.slice(0, 16)}...: ${error}`, "error");
      return { name: 'Unknown NFT', description: '' };
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Check if address is valid
   */
  private isValidAddress(address: string): boolean {
    return address.startsWith('0x') && address.length === 66;
  }

  /**
   * Get error message from unknown error
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if object is an NFT
   */
  private isNFT(obj: any): boolean {
    return obj.data && 
           obj.data.type && 
           !obj.data.type.includes('coin::Coin') && 
           obj.data.display;
  }

  /**
   * Add wallet to storage
   */
  private addWalletToStorage(address: string, name?: string, sessionId: string | null = null): void {
    const walletName = name || `Wallet_${address.slice(-6)}`;
    
    this.wallets.set(address, {
      name: walletName,
      session_id: sessionId,
      added_time: Date.now(),
      last_checked: null
    });
  }

  /**
   * Initialize wallet state
   */
  private initializeWalletState(address: string, name?: string, sessionId: string | null = null): void {
    const walletName = name || `Wallet_${address.slice(-6)}`;
    
    this.walletStates.set(address, {
      previous_coins: new Set(),
      previous_nfts: new Set(),
      first_run: true,
      name: walletName,
      session_id: sessionId,
      incoming_tx_count: 0,
      outgoing_tx_count: 0,
      incoming_nft_count: 0,
      outgoing_nft_count: 0
    });
  }

  /**
   * Create wallet info object
   */
  private createWalletInfo(address: string, walletData: WalletData): WalletInfo {
    const state = this.walletStates.get(address);
    
    return {
      address,
      name: walletData.name,
      coins: state ? state.previous_coins.size : 0,
      nfts: state ? state.previous_nfts.size : 0,
      balance: 0, // TODO: Implement balance fetching
      added_time: walletData.added_time
    };
  }

  /**
   * Update statistics based on notification message
   */
  private updateStatisticsFromNotification(message: string): void {
    if (message.includes('INCOMING') && message.includes('SUI')) {
      this.statistics.total_transactions += 1;
    } else if (message.includes('INCOMING NFT')) {
      this.statistics.total_nfts += 1;
    }
  }

  /**
   * Main monitoring cycle
   */
  private async monitoringCycle(): Promise<void> {
    for (const [address, state] of this.walletStates.entries()) {
      try {
        await this.monitorWallet(address, state);
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        this.addLog(`❌ [${state.name}] Error: ${errorMessage}`, "error");
      }
    }
  }

  /**
   * Monitor a single wallet
   */
  private async monitorWallet(address: string, state: WalletState): Promise<void> {
    // Monitor SUI transactions
    const { currentCoins, coinDetails } = await this.monitorSuiTransactions(address, state);
    
    // Monitor NFT transfers
    await this.monitorNFTTransfers(address, state);
    
    // Log wallet status
    this.logWalletStatus(address, state, currentCoins, coinDetails);
  }

  /**
   * Monitor SUI transactions
   */
  private async monitorSuiTransactions(address: string, state: WalletState): Promise<{
    currentCoins: Set<string>;
    coinDetails: Map<string, number>;
  }> {
    const gasData = await this.getGas(address);
    const currentCoins = new Set<string>();
    const coinDetails: Map<string, number> = new Map();

    // Process gas data
    if (gasData?.data) {
      for (const coin of gasData.data) {
        currentCoins.add(coin.coinObjectId);
        coinDetails.set(coin.coinObjectId, parseInt(coin.balance));
      }
    }

    // Detect transactions if not first run
    if (!state.first_run) {
      this.detectSuiTransactions(address, state, currentCoins, coinDetails);
    }

    // Update state
    state.previous_coins = currentCoins;

    return { currentCoins, coinDetails };
  }

  /**
   * Detect SUI transactions
   */
  private detectSuiTransactions(
    address: string, 
    state: WalletState, 
    currentCoins: Set<string>, 
    coinDetails: Map<string, number>
  ): void {
    // Detect incoming coins
    const newCoins = new Set([...currentCoins].filter(x => !state.previous_coins.has(x)));
    if (newCoins.size > 0) {
      let totalIncoming = 0;
      newCoins.forEach(coinId => {
        totalIncoming += coinDetails.get(coinId) || 0;
      });

      // Fix: Use toFixed(6) instead of :.6f
      const formattedAmount = (totalIncoming / 1_000_000_000).toFixed(6);
      const message = `🎉 *${state.name}*\n💰 INCOMING SUI: +${formattedAmount} SUI\n📧 To: ${address.slice(0, 16)}...`;
      this.addNotification(message, "success");
      state.incoming_tx_count += 1;
    }

    // Detect outgoing coins
    const missingCoins = new Set([...state.previous_coins].filter(x => !currentCoins.has(x)));
    if (missingCoins.size > 0) {
      const message = `📤 *${state.name}*\n🔥 OUTGOING SUI: ${missingCoins.size} coins spent\n📤 From: ${address.slice(0, 16)}...`;
      this.addNotification(message, "outgoing");
      state.outgoing_tx_count += 1;
    }
  }

  /**
   * Monitor NFT transfers
   */
  private async monitorNFTTransfers(address: string, state: WalletState): Promise<void> {
    const currentNFTs = await this.getNFTsForWallet(address);

    if (!state.first_run) {
      await this.detectNFTTransfers(address, state, currentNFTs);
    }

    // Update state
    state.previous_nfts = currentNFTs;
    state.first_run = false;
  }

  /**
   * Detect NFT transfers
   */
  private async detectNFTTransfers(address: string, state: WalletState, currentNFTs: Set<string>): Promise<void> {
    // Detect incoming NFTs
    const newNFTs = new Set([...currentNFTs].filter(x => !state.previous_nfts.has(x)));
    if (newNFTs.size > 0) {
      for (const nftId of newNFTs) {
        await this.handleIncomingNFT(address, state, nftId);
      }
    }

    // Detect outgoing NFTs
    const missingNFTs = new Set([...state.previous_nfts].filter(x => !currentNFTs.has(x)));
    if (missingNFTs.size > 0) {
      for (const nftId of missingNFTs) {
        await this.handleOutgoingNFT(address, state, nftId);
      }
    }
  }

  /**
   * Handle incoming NFT
   */
  private async handleIncomingNFT(address: string, state: WalletState, nftId: string): Promise<void> {
    const { name, description } = await this.getNFTDetails(nftId);
    let message = `🎨 *${state.name}*\n🖼️ INCOMING NFT: ${name}\n📧 To: ${address.slice(0, 16)}...\n🔗 NFT ID: ${nftId.slice(0, 16)}...`;
    
    if (description) {
      message += `\n📝 ${description.slice(0, 100)}...`;
    }
    
    this.addNotification(message, "success");
    state.incoming_nft_count += 1;
  }

  /**
   * Handle outgoing NFT
   */
  private async handleOutgoingNFT(address: string, state: WalletState, nftId: string): Promise<void> {
    const { name, description } = await this.getNFTDetails(nftId);
    let message = `📤 *${state.name}*\n🖼️ OUTGOING NFT: ${name}\n📤 From: ${address.slice(0, 16)}...\n🔗 NFT ID: ${nftId.slice(0, 16)}...`;
    
    if (description) {
      message += `\n📝 ${description.slice(0, 100)}...`;
    }
    
    this.addNotification(message, "outgoing");
    state.outgoing_nft_count += 1;
  }

  /**
   * Log wallet status
   */
  private logWalletStatus(
    address: string, 
    state: WalletState, 
    currentCoins: Set<string>, 
    coinDetails: Map<string, number>
  ): void {
    let totalBalance = 0;
    coinDetails.forEach(balance => {
      totalBalance += balance;
    });

    const coinCount = currentCoins.size;
    const nftCount = state.previous_nfts.size;

    // Fix: Use toFixed(6) instead of :.6f
    const formattedBalance = (totalBalance / 1_000_000_000).toFixed(6);

    this.addLog(
      `📊 [${state.name}] ${coinCount} coins | ${nftCount} NFTs | ` +
      `${formattedBalance} SUI | ` +
      `In: ${state.incoming_tx_count} tx, Out: ${state.outgoing_tx_count} tx`,
      "info"
    );
  }
}