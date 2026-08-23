import { Router } from 'express';
import { getPool } from '../../common/db';
import { getRedis } from '../../common/redis';
import { getEventBus } from '../../common/eventbus';
import { logger } from '../../common/logger';

const router = Router();

interface ComponentStatus {
  name: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs?: number;
}

async function check(name: string, fn: () => Promise<unknown>): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await fn();
    return { name, status: 'UP', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ component: name, err: (err as Error).message }, 'health check failed');
    return { name, status: 'DOWN', latencyMs: Date.now() - start };
  }
}

/**
 * Liveness: process is alive. Always 200 unless the process is dying.
 */
router.get('/live', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Readiness: can this instance serve traffic? Requires DB + Redis.
 * Broker (RabbitMQ) is required only when the in-memory transport isn't used.
 */
router.get('/ready', async (_req, res) => {
  const db = await check('postgres', async () => {
    await getPool().query('SELECT 1');
  });
  const redis = await check('redis', async () => {
    if (!(await getRedis().ping())) throw new Error('ping failed');
  });

  const url = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672';
  const brokerNeeded = url !== 'memory' && url !== '';
  const broker = brokerNeeded
    ? await check('rabbitmq', async () => {
        if (!(await getEventBus().ping())) throw new Error('ping failed');
      })
    : { name: 'rabbitmq', status: 'DEGRADED' as const, latencyMs: 0, note: 'in-memory transport (dev)' };

  const components = [db, redis, broker];
  // Readiness fails only when a *required* dependency is DOWN. An in-memory
  // broker (DEGRADED, not DOWN) is expected in dev and must not fail readiness.
  const canServe = !components.some((c) => c.status === 'DOWN');
  res.status(canServe ? 200 : 503).json({
    status: canServe ? 'ok' : 'degraded',
    components
  });
});

/** Deep health: component-level detail incl. latencies. */
router.get('/deep', async (_req, res) => {
  const db = await check('postgres', async () => {
    await getPool().query('SELECT 1');
  });
  const redis = await check('redis', async () => {
    if (!(await getRedis().ping())) throw new Error('ping failed');
  });
  res.json({
    components: [db, redis],
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version,
      pid: process.pid
    }
  });
});

export default router;