import { getConfig } from '@opsmesh/config';
import { createApp } from './app';
import { logger } from './common/logger';
import { closePool } from './common/db';
import { closeRedis } from './common/redis';
import { closeEventBus } from './common/eventbus';

const config = getConfig();
const { httpServer } = createApp();

httpServer.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    'OpsMesh API listening'
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    logger.error('forced exit after timeout');
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeEventBus();
    await closeRedis();
    await closePool();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'uncaught exception');
});