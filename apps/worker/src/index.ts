import { getConfig } from '@opsmesh/config';
import { logger } from './common/logger';
import { getEventBus } from './common/eventbus';
import { closePool } from './common/db';
import { closeRedis } from './common/redis';
import { processEvent, IngestedEventMessage } from './modules/event-processor/event.processor';
import { EscalationWorker } from './modules/escalation/escalation.worker';
import { HealthCheckWorker } from './modules/healthcheck/health-check.worker';
import { NotificationWorker } from './modules/notification/notification.worker';
import { materializeShifts } from './modules/oncall/on-call.worker';
import { refreshEventsBuckets, refreshOverviewMetrics } from './modules/metrics/metrics.worker';
import { emitRealtime } from './common/realtime';
import {
  WORKER_IDS,
  registerWorker,
  heartbeatAll,
  recordJobStart,
  recordJobDone,
  recordJobFailed
} from './common/stats';

const config = getConfig();

export async function startWorker(): Promise<void> {
  // Materialize on-call shifts so incident assignment finds active engineers.
  await materializeShifts();

  // Register worker identities + heartbeat so the dashboard can show live workers.
  for (const w of WORKER_IDS) await registerWorker(w.id, w.type);
  const heartbeatTimer = setInterval(() => {
    void heartbeatAll(WORKER_IDS.map((w) => w.id));
  }, 15_000);
  heartbeatTimer.unref();

  // --- Event consumer (RabbitMQ in production, in-memory transport in dev) ---
  const bus = getEventBus();
  await bus.consume({
    queue: config.RABBITMQ_EVENTS_QUEUE,
    maxRetries: 3,
    retryBaseMs: 1000, // 1s -> 2s -> 4s (exponential, documented)
    handler: async (message) => {
      if (message.type !== 'event.ingested') return;
      const payload = message.payload as IngestedEventMessage;
      await recordJobStart('event-processor', 'ingest');
      try {
        await processEvent(payload);
        await recordJobDone('event-processor', 'ingest');
      } catch (err) {
        logger.error(
          { err: (err as Error).message, eventId: payload.eventId },
          'event processing failed (will retry via bus)'
        );
        await recordJobFailed('event-processor', 'ingest');
        throw err; // trigger bus retry/NACK
      }
    }
  });
  logger.info({ transport: process.env.RABBITMQ_URL }, 'event consumer started');

  // --- Escalation (DB-timestamp-driven, survives restarts) ---
  new EscalationWorker(config.ESCALATION_CHECK_INTERVAL_MS).start();

  // --- Health checks ---
  const healthWorker = new HealthCheckWorker(config.HEALTH_CHECK_INTERVAL_MS);
  healthWorker.start();

  // --- Notifications ---
  new NotificationWorker(5000).start();

  // --- Background metrics refresh ---
  const metricsTimer = setInterval(() => {
    void (async () => {
      await recordJobStart('metrics', 'metrics');
      try {
        await refreshOverviewMetrics();
        await emitRealtime('metrics.refresh', { overview: true, at: new Date().toISOString() });
        await refreshEventsBuckets();
        await recordJobDone('metrics', 'metrics');
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'metrics refresh failed');
        await recordJobFailed('metrics', 'metrics');
      }
    })();
  }, 60_000);
  metricsTimer.unref();
  void (async () => {
    await recordJobStart('metrics', 'metrics');
    try {
      await refreshOverviewMetrics();
      await recordJobDone('metrics', 'metrics');
    } catch {
      await recordJobFailed('metrics', 'metrics');
    }
  })();

  logger.info('OpsMesh worker started (event, escalation, health, notification)');

  process.on('SIGTERM', () => void shutdown([metricsTimer]));
  process.on('SIGINT', () => void shutdown([metricsTimer]));
}

async function shutdown(timers: NodeJS.Timeout[]): Promise<void> {
  logger.info('worker shutting down');
  for (const t of timers) clearInterval(t);
  try {
    await closePool();
    await closeRedis();
    logger.info('worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown error');
    process.exit(1);
  }
}

if (require.main === module) {
  startWorker().catch((err) => {
    logger.fatal({ err: (err as Error).message }, 'worker failed to start');
    process.exit(1);
  });
}