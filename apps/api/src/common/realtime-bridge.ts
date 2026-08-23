import { getConfig } from '@opsmesh/config';
import { getEventBus } from './eventbus';
import { wsHub } from './ws-hub';
import { logger } from './logger';
import { recordQueueCompleted } from './stats';

/**
 * Realtime bridge: consumes the `realtime` subject from the event bus and
 * forwards every message to Socket.IO clients.
 *  - In production each API instance consumes the RabbitMQ `opsmesh.realtime`
 *    queue (one API instance receives each message; it has no side effects, so
 *    a single recipient is enough for dashboard fan-out).
 *  - In local dev / smoke (memory transport) the worker and API share a
 *    process, so the in-memory bus delivers subject-routed copies directly.
 *
 * Room routing: messages carrying `payload.incidentId` are emitted to both the
 * `incident:{id}` room and the global channel, so open detail pages update live.
 */
let started = false;

export function startRealtimeBridge(): void {
  if (started) return;
  started = true;
  const config = getConfig();
  void (async () => {
    try {
      const bus = getEventBus();
      await bus.consume({
        queue: 'opsmesh.realtime',
        subject: 'realtime',
        maxRetries: 3,
        retryBaseMs: 1000,
        handler: async (message) => {
          try {
            const payload = message.payload as Record<string, unknown> | null;
            wsHub.broadcast(message.type, payload);
            if (payload && typeof payload.incidentId === 'string') {
              wsHub.emit(`incident:${payload.incidentId}`, message.type, payload);
            }
            void recordQueueCompleted('realtime');
          } catch (err) {
            logger.warn({ type: message.type, err: (err as Error).message }, 'realtime forward failed');
          }
        }
      });
      logger.info({ transport: process.env.RABBITMQ_URL }, 'realtime bridge started');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'realtime bridge could not start (retrying)');
      // transient (e.g. broker briefly down): clear guard so it can be retried
      started = false;
    }
  })();
}