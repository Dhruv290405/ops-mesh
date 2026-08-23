import { Server as SocketServer } from 'socket.io';
import { WebSocketMessage } from '@opsmesh/shared';
import { logger } from './logger';

/**
 * WebSocket hub for the real-time dashboard.
 * Emits typed events: incident.created|updated|status_changed, service.health,
 * metrics.refresh, notification.dispatched.
 *
 * Scalability: a single hub serves all sockets in the process; across multiple
 * API instances, instances broadcast through the event bus (see
 * docs/architecture.md). For the common single-instance deployment this hub is
 * the single source of truth and there is no cross-instance fan-out needed.
 */
class WebSocketHub {
  private io: SocketServer | null = null;

  attach(io: SocketServer): void {
    this.io = io;
    io.on('connection', (socket) => {
      logger.info({ socketId: socket.id }, 'ws client connected');
      socket.on('subscribe', (channels: string[]) => {
        for (const c of channels) socket.join(c);
        logger.info({ socketId: socket.id, channels }, 'ws subscribed');
      });
      socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, 'ws client disconnected');
      });
    });
  }

  emit<T>(room: string, type: string, payload: T): void {
    if (!this.io) return;
    const message: WebSocketMessage<T> = {
      type,
      payload,
      timestamp: new Date().toISOString()
    };
    if (room === 'global') {
      this.io.emit(type, message);
    } else {
      this.io.to(room).emit(type, message);
    }
  }

  broadcast<T>(type: string, payload: T): void {
    this.emit('global', type, payload);
  }
}

export const wsHub = new WebSocketHub();