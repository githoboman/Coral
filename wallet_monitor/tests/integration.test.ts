import { SuiWalletMonitor } from '../src/SuiWalletMonitor';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

describe('SuiWalletMonitor Integration Tests', () => {
  let monitor: SuiWalletMonitor;
  let mockAxios: MockAdapter;

  const testAddress = '0x0fc530455ee4132b761ed82dab732990cb7af73e69cd6e719a2a5badeaed105b';

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

  describe('End-to-End Monitoring Flow', () => {
    test('should detect incoming SUI transaction', async () => {
      // Add wallet
      monitor.addWallet(testAddress, 'Test Wallet');
      
      // Mock initial state (first run)
      mockAxios.onPost().replyOnce(200, {
        result: { data: [{ coinObjectId: '0xcoin1', balance: '1000000000' }] }
      });

      // Mock NFT responses (empty for first run)
      mockAxios.onPost().replyOnce(200, { result: { data: [] } });

      // Start monitoring and run first cycle
      monitor.startMonitoring();
      await jest.advanceTimersByTimeAsync(5000);
      
      // Clear notifications from first run
      const firstRunNotifications = monitor.getNotifications();
      
      // Mock second state with new coin
      mockAxios.onPost().replyOnce(200, {
        result: { 
          data: [
            { coinObjectId: '0xcoin1', balance: '1000000000' },
            { coinObjectId: '0xcoin2', balance: '2000000000' }
          ] 
        }
      });

      // Mock NFT responses (empty for second run)
      mockAxios.onPost().replyOnce(200, { result: { data: [] } });

      // Run second cycle
      await jest.advanceTimersByTimeAsync(5000);
      
      // Check if notification was added
      const notifications = monitor.getNotifications();
      const incomingNotifications = notifications.filter(n => n.message.includes('INCOMING SUI'));
      
      expect(incomingNotifications.length).toBeGreaterThan(0);
      
      monitor.stopMonitoring();
    }, 15000);

    test('should detect outgoing NFT transfer', async () => {
      // Add wallet
      monitor.addWallet(testAddress, 'Test Wallet');
      
      // Mock initial state with NFT
      mockAxios.onPost().replyOnce(200, {
        result: {
          data: [{
            data: {
              objectId: '0xnft1',
              type: 'nft::NFT',
              display: { name: 'Test NFT', description: 'Test Description' }
            }
          }]
        }
      });

      // Mock gas data for first run
      mockAxios.onPost().replyOnce(200, {
        result: { data: [{ coinObjectId: '0xcoin1', balance: '1000000000' }] }
      });

      // Start monitoring and run first cycle
      monitor.startMonitoring();
      await jest.advanceTimersByTimeAsync(5000);
      
      // Mock second state without NFT
      mockAxios.onPost().replyOnce(200, {
        result: { data: [] } // No NFTs
      });

      // Mock gas data for second run
      mockAxios.onPost().replyOnce(200, {
        result: { data: [{ coinObjectId: '0xcoin1', balance: '1000000000' }] }
      });

      // Mock NFT details for outgoing detection
      mockAxios.onPost().reply(200, {
        result: {
          data: {
            display: { name: 'Test NFT', description: 'Test Description' }
          }
        }
      });

      // Run second cycle
      await jest.advanceTimersByTimeAsync(5000);
      
      // Check if notification was added
      const notifications = monitor.getNotifications();
      const outgoingNotifications = notifications.filter(n => n.message.includes('OUTGOING NFT'));
      
      expect(outgoingNotifications.length).toBeGreaterThan(0);
      
      monitor.stopMonitoring();
    }, 15000);
  });

  describe('Multiple Wallets Monitoring', () => {
    test('should monitor multiple wallets simultaneously', async () => {
      const address2 = '0x2ab732990cb7af73e69cd6e719a2a5badeaed105b0fc530455ee4132b761ed82d';
      
      // Add two wallets
      monitor.addWallet(testAddress, 'Wallet 1');
      monitor.addWallet(address2, 'Wallet 2');

      // Mock responses for both wallets (gas data)
      mockAxios.onPost().reply(200, {
        result: { data: [{ coinObjectId: '0xcoin1', balance: '1000000000' }] }
      });

      // Mock NFT responses (empty)
      mockAxios.onPost().reply(200, { result: { data: [] } });

      // Start monitoring
      monitor.startMonitoring();
      
      // Let it run for one cycle
      await jest.advanceTimersByTimeAsync(5000);
      
      // Check logs for both wallets
      const logs = monitor.getLogs();
      const wallet1Logs = logs.filter(log => log.message.includes('Wallet 1'));
      const wallet2Logs = logs.filter(log => log.message.includes('Wallet 2'));
      
      expect(wallet1Logs.length).toBeGreaterThan(0);
      expect(wallet2Logs.length).toBeGreaterThan(0);
      
      monitor.stopMonitoring();
    }, 15000);
  });

  describe('Error Handling', () => {
    test('should handle RPC errors gracefully', async () => {
      monitor.addWallet(testAddress, 'Test Wallet');
      
      // Mock RPC error
      mockAxios.onPost().reply(500);

      // Start monitoring
      monitor.startMonitoring();
      
      // Let it run for one cycle
      await jest.advanceTimersByTimeAsync(5000);
      
      // Check error logs
      const logs = monitor.getLogs();
      expect(logs.some(log => log.type === 'error')).toBe(true);
      
      monitor.stopMonitoring();
    }, 15000);

    test('should continue monitoring after error', async () => {
      monitor.addWallet(testAddress, 'Test Wallet');
      
      // First request fails
      mockAxios.onPost().replyOnce(500);
      
      // Second request succeeds (gas data)
      mockAxios.onPost().replyOnce(200, {
        result: { data: [{ coinObjectId: '0xcoin1', balance: '1000000000' }] }
      });

      // Mock NFT responses for second request
      mockAxios.onPost().replyOnce(200, { result: { data: [] } });

      // Start monitoring
      monitor.startMonitoring();
      
      // Run two cycles
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(5000);
      
      // Check that monitoring continued
      const logs = monitor.getLogs();
      expect(logs.some(log => log.type === 'error')).toBe(true);
      expect(logs.some(log => log.message.includes('coins'))).toBe(true);
      
      monitor.stopMonitoring();
    }, 15000);
  });
});