import { startWorker } from './src/index';
startWorker().catch((e) => {
  console.error('WORKER_START_ERROR:', e);
  process.exit(1);
});