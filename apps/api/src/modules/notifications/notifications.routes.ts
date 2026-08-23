import { Router } from 'express';
import { UserRole } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { listNotifications, retryNotification } from '../notifications/notifications.service';
import { query } from '../../common/db';

const router = Router();
router.use(requireAuth());

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const incidentId = req.query.incidentId as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const notifications = await listNotifications(incidentId, limit);
    ok(res, notifications);
  })
);

router.post(
  '/:id/retry',
  requireRole(UserRole.ENGINEER),
  asyncHandler(async (req, res) => {
    await retryNotification(req.params.id);
    ok(res, { queued: true });
  })
);

export default router;