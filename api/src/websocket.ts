import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from './logger';

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      logger.info('WebSocket client connected', { 
        clientIP: req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      this.clients.add(ws);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (error) {
          logger.warn('Invalid WebSocket message received', { error: error instanceof Error ? error.message : error });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket client error', { error: error.message });
        this.clients.delete(ws);
      });

      this.sendToClient(ws, {
        type: 'connection',
        data: { 
          status: 'connected',
          timestamp: new Date().toISOString()
        }
      });
    });

    logger.info('WebSocket server initialized on /ws');
  }

  private handleClientMessage(ws: WebSocket, message: any) {
    const { type, data } = message;

    switch (type) {
      case 'subscribe':
        // Handle subscription to specific channels
        logger.info('Client subscribed to channels', { channels: data?.channels });
        this.sendToClient(ws, {
          type: 'subscription_confirmed',
          data: { channels: data?.channels || [] }
        });
        break;

      case 'ping':
        // Handle ping/pong for connection health
        this.sendToClient(ws, {
          type: 'pong',
          data: { timestamp: new Date().toISOString() }
        });
        break;

      default:
        logger.warn('Unknown WebSocket message type', { type });
    }
  }

  private sendToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Failed to send WebSocket message', { error: error instanceof Error ? error.message : error });
      }
    }
  }

  broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
        } catch (error) {
          logger.error('Failed to broadcast WebSocket message', { error: error instanceof Error ? error.message : error });
          this.clients.delete(ws);
        }
      }
    });
  }

  broadcastScanUpdate(scanId: string, status: string, progress?: number) {
    this.broadcast({
      type: 'scan_update',
      data: {
        scan_id: scanId,
        status,
        progress: progress || 0,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastAlert(alertType: string, message: string, severity: string = 'medium') {
    this.broadcast({
      type: 'alert',
      data: {
        type: alertType,
        message,
        severity,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastMetrics(metrics: any) {
    this.broadcast({
      type: 'metrics',
      data: {
        ...metrics,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastAIUpdate(data: any) {
    this.broadcast({
      type: 'ai_update',
      data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastBlockchainUpdate(data: any) {
    this.broadcast({
      type: 'blockchain_update',
      data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastQuantumUpdate(data: any) {
    this.broadcast({
      type: 'quantum_update',
      data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    });
  }

  broadcastMonitoringUpdate(data: any) {
    this.broadcast({
      type: 'monitoring_update',
      data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    });
  }

  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  close() {
    if (this.wss) {
      this.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      this.wss.close();
      logger.info('WebSocket server closed');
    }
  }
}
