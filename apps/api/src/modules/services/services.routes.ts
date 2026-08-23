import { Router } from 'express';
import { createApiResponse } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { UserRole, paginationSchema } from '@opsmesh/shared';
import { validate } from '../../middleware/validate';
import {
  createService,
  disableService,
  getServiceById,
  getServiceHealth,
  listHistoricalIncidents,
  listServices,
  toServiceDto,
  updateService
} from './services.service';
import { createServiceSchema, updateServiceSchema } from '@opsmesh/shared';
import { NotFoundError } from '../../common/errors';

const router = Router();
router.use(requireAuth());

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await listServices({
      environment: req.query.environment as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined
    });
    const dtos = services.map((s) => toServiceDto(s));
    ok(res, dtos);
  })
);

router.post(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: createServiceSchema }),
  asyncHandler(async (req, res) => {
    const service = await createService(req.body, req.auth!.sub);
    ok(res, toServiceDto(service), 201);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await getServiceById(req.params.id);
    if (!service) throw new NotFoundError('Service not found');
    ok(res, toServiceDto(service));
  })
);

router.patch(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ body: updateServiceSchema }),
  asyncHandler(async (req, res) => {
    const service = await updateService(req.params.id, req.body, req.auth!.sub);
    ok(res, toServiceDto(service));
  })
);

router.post(
  '/:id/disable',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    await disableService(req.params.id, req.auth!.sub);
    res.json(createApiResponse(true, { disabled: true }));
  })
);

router.get(
  '/:id/health',
  asyncHandler(async (req, res) => {
    const health = await getServiceHealth(req.params.id);
    ok(res, health);
  })
);

router.get(
  '/:id/incidents',
  asyncHandler(async (req, res) => {
    const incidents = await listHistoricalIncidents(
      req.params.id,
      req.query.limit ? Number(req.query.limit) : 20
    );
    ok(res, incidents);
  })
);

router.get(
  '/:id/health-historical',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const rows = await (
      await import('../../common/db')
    ).query(
      `SELECT status, latency_ms, status_code, error, checked_at
       FROM health_check_results WHERE service_id = $1 ORDER BY checked_at DESC LIMIT $2`,
      [req.params.id, limit]
    );
    ok(res, rows.rows);
  })
);

export default router;