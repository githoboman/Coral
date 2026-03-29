import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { SuiWalletMonitor } from './suiwalletmonitor';
import { WebSocketMessage } from './types';

export class WebSocketServer {
  private wss: WSServer;
  private monitor: SuiWalletMonitor;
  private connectedClients: Set<WebSocket> = new Set();

  constructor(port: number, monitor: SuiWalletMonitor) {
    this.wss = new WSServer({ port });
    this.monitor = monitor;
    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.connectedClients.add(ws);
      
      // Send initial data
      this.sendToClient(ws, {
        type: 'wallets',
        wallets: this.monitor.getWallets()
      });

      this.sendToClient(ws, {
        type: 'stats',
        stats: this.monitor.getStatistics()
      });

      ws.on('message', (data: WebSocket.Data) => {
        console.log('Received:', data.toString());
      });

      ws.on('close', () => {
        this.connectedClients.delete(ws);
      });

      ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
        this.connectedClients.delete(ws);
      });
    });

    console.log(`WebSocket server started on port ${this.wss.options.port}`);
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: WebSocketMessage): void {
    for (const client of this.connectedClients) {
      this.sendToClient(client, message);
    }
  }

  close(): void {
    for (const client of this.connectedClients) {
      client.close();
    }
    this.wss.close();
  }
}