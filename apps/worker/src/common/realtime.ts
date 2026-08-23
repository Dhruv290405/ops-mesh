import { getEventBus } from './eventbus';
import { logger } from './logger';
import { recordPublished } from './stats';

/**
 * Publishes a dashboard realtime event (subject `realtime`). These fan out to
 * the API's realtime bridge and on to Socket.IO clients. Realtime is best-effort:
 * a failed publish must never break the incident pipeline, so it is fire-and-forget.
 */
export async function emitRealtime(type: string, payload: unknown): Promise<void> {
  try {
    await getEventBus().publish(type, payload, { subject: 'realtime' });
    await recordPublished('realtime');
  } catch (err) {
    logger.warn({ type, err: (err as Error).message }, 'realtime emit failed (ignored)');
  }
}