import { SuiWalletMonitor } from '../src/SuiWalletMonitor';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const monitor = new SuiWalletMonitor();

async function manualTest() {
  console.log('\n🔍 SUI Wallet Monitor - Manual Test\n');
  
  // Test wallet address (use a real testnet address)
  const testAddress = '0x0fc530455ee4132b761ed82dab732990cb7af73e69cd6e719a2a5badeaed105b';
  
  console.log('1. Testing wallet addition...');
  const result = monitor.addWallet(testAddress, 'Test Wallet');
  console.log(`   Result: ${result.success ? '✅' : '❌'} ${result.message}`);
  
  console.log('\n2. Testing wallet retrieval...');
  const wallets = monitor.getWallets();
  console.log(`   Wallets monitored: ${wallets.length}`);
  wallets.forEach((w, i) => {
    console.log(`   ${i + 1}. ${w.name} (${w.address.slice(0, 16)}...)`);
  });
  
  console.log('\n3. Testing notification system...');
  monitor.addNotification('Test notification 1', 'success');
  monitor.addNotification('Test notification 2', 'info');
  monitor.addNotification('Test notification 3', 'error');
  const notifications = monitor.getNotifications();
  console.log(`   Notifications: ${notifications.length}`);
  
  console.log('\n4. Testing statistics...');
  const stats = monitor.getStatistics();
  console.log(`   Total wallets: ${stats.total_wallets}`);
  console.log(`   Total transactions: ${stats.total_transactions}`);
  console.log(`   Total NFTs: ${stats.total_nfts}`);
  
  console.log('\n5. Starting monitoring (will run for 10 seconds)...');
  console.log('   Press Ctrl+C to stop\n');
  
  // Start monitoring
  monitor.startMonitoring();
  
  // Show live updates
  const logInterval = setInterval(() => {
    const recentLogs = monitor.getLogs(5);
    console.log('\n📋 Recent logs:');
    recentLogs.forEach(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      console.log(`   [${time}] ${log.message}`);
    });
  }, 2000);
  
  // Stop after 30 seconds
  setTimeout(() => {
    clearInterval(logInterval);
    monitor.stopMonitoring();
    console.log('\n\n✅ Test complete!');
    
    console.log('\n6. Testing wallet removal...');
    const removeResult = monitor.removeWallet(testAddress);
    console.log(`   Result: ${removeResult.success ? '✅' : '❌'} ${removeResult.message}`);
    
    rl.close();
    process.exit(0);
  }, 30000);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping monitor...');
  monitor.stopMonitoring();
  process.exit(0);
});

manualTest();