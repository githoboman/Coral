import { SuiWalletMonitor } from '../src/SuiWalletMonitor';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { MockGasResponse, MockObjectsResponse, MockNFTDetailsResponse } from './types';

describe('SuiWalletMonitor', () => {
  let monitor: SuiWalletMonitor;
  let mockAxios: MockAdapter;
  
  // Test wallet addresses
  const validAddress = '0x0fc530455ee4132b761ed82dab732990cb7af73e69cd6e719a2a5badeaed105b';
  const validAddress2 = '0x1ab732990cb7af73e69cd6e719a2a5badeaed105b0fc530455ee4132b761ed82d';

  beforeEach(() => {
    monitor = new SuiWalletMonitor('https://test-rpc.sui.io');
    mockAxios = new MockAdapter(axios);
    jest.useFakeTimers();
  });

  afterEach(() => {
    mockAxios.reset();
    jest.clearAllTimers();
    jest.useRealTimers();
    monitor.stopMonitoring();
  });

  describe('Wallet Management', () => {
    test('should add a valid wallet successfully', () => {
      const result = monitor.addWallet(validAddress, 'Test Wallet');
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Wallet added successfully');
      expect(monitor.getWalletCount()).toBe(1);
      
      const wallets = monitor.getWallets();
      expect(wallets[0].address).toBe(validAddress);
      expect(wallets[0].name).toBe('Test Wallet');
    });

    test('should reject invalid address format', () => {
      const result = monitor.addWallet('invalid-address');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid wallet address format');
      expect(monitor.getWalletCount()).toBe(0);
    });

    test('should reject duplicate wallet', () => {
      monitor.addWallet(validAddress, 'Wallet 1');
      const result = monitor.addWallet(validAddress, 'Wallet 2');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Wallet already being monitored');
      expect(monitor.getWalletCount()).toBe(1);
    });

    test('should generate default name if not provided', () => {
      monitor.addWallet(validAddress);
      
      const wallets = monitor.getWallets();
      expect(wallets[0].name).toContain('Wallet_');
    });

    test('should remove wallet successfully', () => {
      monitor.addWallet(validAddress, 'Test Wallet');
      expect(monitor.getWalletCount()).toBe(1);
      
      const result = monitor.removeWallet(validAddress);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Wallet removed successfully');
      expect(monitor.getWalletCount()).toBe(0);
    });

    test('should fail to remove non-existent wallet', () => {
      const result = monitor.removeWallet(validAddress);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Wallet not found');
    });

    test('should filter wallets by session ID', () => {
      // Add wallets with different session IDs
      monitor.addWallet(validAddress, 'Wallet 1', 'session1');
      monitor.addWallet(validAddress2, 'Wallet 2', 'session2');
      
      // Get wallets for each session
      const session1Wallets = monitor.getWallets('session1');
      const session2Wallets = monitor.getWallets('session2');
      const allWallets = monitor.getWallets();
      
      // Verify counts
      expect(session1Wallets).toHaveLength(1);
      expect(session2Wallets).toHaveLength(1);
      expect(allWallets).toHaveLength(2);
      
      // Verify wallet names
      expect(session1Wallets[0].name).toBe('Wallet 1');
      expect(session2Wallets[0].name).toBe('Wallet 2');
    });
  });

  describe('Notification System', () => {
    test('should add and retrieve notifications', () => {
      monitor.addNotification('Test notification 1', 'success');
      monitor.addNotification('Test notification 2', 'info');
      monitor.addNotification('Test notification 3', 'error');
      
      const notifications = monitor.getNotifications();
      
      expect(notifications).toHaveLength(3);
      expect(notifications[2].message).toBe('Test notification 1'); // Most recent last in array
      expect(notifications[2].type).toBe('success');
    });

    test('should limit notifications to 100', () => {
      // Add 150 notifications
      for (let i = 0; i < 150; i++) {
        monitor.addNotification(`Notification ${i}`, 'info');
      }
      
      const notifications = monitor.getNotifications();
      expect(notifications).toHaveLength(100);
      expect(notifications[0].message).toBe('Notification 50'); // First notification after limit
      expect(notifications[99].message).toBe('Notification 149'); // Last notification
    });

    test('should update statistics from notifications', () => {
      const initialStats = monitor.getStatistics();
      
      monitor.addNotification('INCOMING SUI transaction', 'success');
      monitor.addNotification('INCOMING NFT received', 'success');
      monitor.addNotification('Some other notification', 'info');
      
      const updatedStats = monitor.getStatistics();
      
      expect(updatedStats.total_transactions).toBe(initialStats.total_transactions + 1);
      expect(updatedStats.total_nfts).toBe(initialStats.total_nfts + 1);
    });
  });

  describe('Logging System', () => {
    test('should add and retrieve logs', () => {
      monitor.addLog('Test log 1', 'info');
      monitor.addLog('Test log 2', 'success');
      monitor.addLog('Test log 3', 'error');
      
      const logs = monitor.getLogs();
      
      expect(logs).toHaveLength(3);
      expect(logs[2].message).toBe('Test log 1'); // Most recent last in array
      expect(logs[2].type).toBe('info');
    });

    test('should limit logs to 1000', () => {
      // Add 1100 logs
      for (let i = 0; i < 1100; i++) {
        monitor.addLog(`Log ${i}`, 'info');
      }
      
      const logs = monitor.getLogs();
      expect(logs).toHaveLength(1000);
      expect(logs[0].message).toBe('Log 100'); // First log after limit
      expect(logs[999].message).toBe('Log 1099'); // Last log
    });
  });

  describe('Statistics', () => {
    test('should track wallet count correctly', () => {
      expect(monitor.getStatistics().total_wallets).toBe(0);
      
      monitor.addWallet(validAddress);
      expect(monitor.getStatistics().total_wallets).toBe(1);
      
      monitor.addWallet(validAddress2);
      expect(monitor.getStatistics().total_wallets).toBe(2);
      
      monitor.removeWallet(validAddress);
      expect(monitor.getStatistics().total_wallets).toBe(1);
    });

    test('should return copy of statistics', () => {
      const stats = monitor.getStatistics();
      stats.total_wallets = 100;
      
      expect(monitor.getStatistics().total_wallets).toBe(0);
    });
  });

  describe('RPC Methods', () => {
    test('should fetch gas data successfully', async () => {
      const mockResponse: MockGasResponse = {
        result: {
          data: [
            { coinObjectId: '0xcoin1', balance: '1000000000' },
            { coinObjectId: '0xcoin2', balance: '2000000000' }
          ]
        }
      };

      mockAxios.onPost().reply(200, mockResponse);

      const gasData = await monitor.getGas(validAddress);
      
      expect(gasData).not.toBeNull();
      expect(gasData?.data).toHaveLength(2);
      expect(gasData?.data[0].coinObjectId).toBe('0xcoin1');
      expect(parseInt(gasData!.data[0].balance)).toBe(1000000000);
    });

    test('should handle gas fetch error', async () => {
      mockAxios.onPost().networkError();

      const gasData = await monitor.getGas(validAddress);
      
      expect(gasData).toBeNull();
    });

    test('should fetch owned objects', async () => {
      const mockResponse = {
        result: {
          data: [
            { data: { objectId: '0xobj1', type: 'coin::Coin', display: null } },
            { data: { objectId: '0xobj2', type: 'nft::NFT', display: { name: 'Test NFT' } } }
          ]
        }
      };

      mockAxios.onPost().reply(200, mockResponse);

      const objects = await monitor.getOwnedObjects(validAddress);
      
      expect(objects).toHaveLength(2);
    });

    test('should extract NFTs from owned objects', async () => {
      const mockResponse = {
        result: {
          data: [
            { data: { objectId: '0xnft1', type: 'nft::NFT', display: { name: 'NFT 1' } } },
            { data: { objectId: '0xnft2', type: 'nft::NFT', display: { name: 'NFT 2' } } },
            { data: { objectId: '0xcoin1', type: 'coin::Coin', display: null } }
          ]
        }
      };

      mockAxios.onPost().reply(200, mockResponse);

      const nfts = await monitor.getNFTsForWallet(validAddress);
      
      expect(nfts.size).toBe(2);
      expect(nfts.has('0xnft1')).toBe(true);
      expect(nfts.has('0xnft2')).toBe(true);
    });

    test('should fetch NFT details', async () => {
      const mockResponse: MockNFTDetailsResponse = {
        result: {
          data: {
            display: {
              name: 'Cool NFT',
              description: 'This is a cool NFT'
            }
          }
        }
      };

      mockAxios.onPost().reply(200, mockResponse);

      const details = await monitor.getNFTDetails('0xnft1');
      
      expect(details.name).toBe('Cool NFT');
      expect(details.description).toBe('This is a cool NFT');
    });

    test('should handle missing NFT display data', async () => {
      const mockResponse = {
        result: {
          data: {
            display: null
          }
        }
      };

      mockAxios.onPost().reply(200, mockResponse);

      const details = await monitor.getNFTDetails('0xnft1');
      
      expect(details.name).toBe('Unknown NFT');
      expect(details.description).toBe('');
    });
  });
});