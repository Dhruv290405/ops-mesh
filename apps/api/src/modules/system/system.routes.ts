import { Router } from 'express';
import { createApiResponse } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth';
import { listQueues, listWorkers } from './system.service';

const router = Router();
router.use(requireAuth());

/**
 * Queues & Workers observability. Data is produced by the worker (heartbeats +
 * per-job counters written to Postgres) and consumed here for the dashboard.
 * This is the read side of the async-processing architecture view.
 */
router.get(
  '/queues',
  asyncHandler(async (_req, res) => {
    const queues = await listQueues();
    ok(res, queues);
  })
);

router.get(
  '/workers',
  asyncHandler(async (_req, res) => {
    const workers = await listWorkers();
    ok(res, workers);
  })
);

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [queues, workers] = await Promise.all([listQueues(), listWorkers()]);
    ok(res, { queues, workers });
  })
);

export default router;
