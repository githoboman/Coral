import express from 'express';
import cors from 'cors';
import { SuiWalletMonitor } from './SuiWalletMonitor';
import { WebSocketServer } from './WebSocketServer';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const monitor = new SuiWalletMonitor();
const wss = new WebSocketServer(8080, monitor);

// Start monitoring in background
monitor.startMonitoring().catch(console.error);

// REST API endpoints
app.get('/api/wallets', (req, res) => {
  res.json({
    success: true,
    wallets: monitor.getWallets(),
    total: monitor.getWalletCount()
  });
});

app.post('/api/wallets', (req, res) => {
  const { address, name } = req.body;

  if (!address) {
    return res.status(400).json({ 
      success: false, 
      error: 'Wallet address is required' 
    });
  }

  const result = monitor.addWallet(address, name, 'web');

  if (result.success) {
    wss.broadcast({
      type: 'wallet_added',
      address,
      name: name || `Wallet_${address.slice(-6)}`
    });
  }

  res.json(result);
});

app.delete('/api/wallets/:address', (req, res) => {
  const { address } = req.params;
  const result = monitor.removeWallet(address);

  if (result.success) {
    wss.broadcast({
      type: 'wallet_removed',
      address
    });
  }

  res.json(result);
});

app.get('/api/notifications', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({
    success: true,
    notifications: monitor.getNotifications(limit),
    total: monitor.getNotifications().length
  });
});

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json({
    success: true,
    logs: monitor.getLogs(limit),
    total: monitor.getLogs().length
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: monitor.getStatistics()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'running',
    wallets_monitored: monitor.getWalletCount()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT}/api/wallets to test`);
});