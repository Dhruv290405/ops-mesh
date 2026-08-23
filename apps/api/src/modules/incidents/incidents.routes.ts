import { Router, Request, Response } from 'express';
import {
  acknowledgeIncidentSchema,
  assignIncidentSchema,
  changeSeveritySchema,
  createApiResponse,
  incidentCommentSchema,
  IncidentStatus,
  paginationSchema,
  updateIncidentStatusSchema
} from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { UserRole } from '@opsmesh/shared';
import { validate } from '../../middleware/validate';
import {
  addComment,
  assignEngineer,
  changeSeverity,
  getIncidentDetail,
  listIncidents,
  reopenIncident,
  updateIncidentStatus
} from './incidents.service';

const router = Router();
router.use(requireAuth());

const parseStatus = (s: string | undefined): IncidentStatus | undefined =>
  s && Object.values(IncidentStatus).includes(s as IncidentStatus)
    ? (s as IncidentStatus)
    : undefined;

router.get(
  '/',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const { data, total } = await listIncidents({
      page: Number(q.page ?? 1),
      limit: Number(q.limit ?? 20),
      status: parseStatus(q.status),
      severity: q.severity as never,
      serviceId: q.serviceId,
      assigneeId: q.assigneeId
    });
    res.json(
      createApiResponse(true, {
        data,
        total,
        page: Number(q.page ?? 1),
        limit: Number(q.limit ?? 20)
      })
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = await getIncidentDetail(req.params.id);
    ok(res, detail);
  })
);

router.post(
  '/:id/acknowledge',
  validate({ body: acknowledgeIncidentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await updateIncidentStatus(req.params.id, {
      status: IncidentStatus.ACKNOWLEDGED,
      actorId: req.auth!.sub,
      actorName: req.auth!.email,
      note: req.body.note
    });
    res.json(createApiResponse(true, incident));
  })
);

router.patch(
  '/:id/status',
  validate({ body: updateIncidentStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await updateIncidentStatus(req.params.id, {
      status: req.body.status,
      actorId: req.auth!.sub,
      actorName: req.auth!.email,
      note: req.body.note,
      resolutionSummary: req.body.resolutionSummary
    });
    ok(res, incident);
  })
);

router.post(
  '/:id/severity',
  validate({ body: changeSeveritySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await changeSeverity(
      req.params.id,
      req.body.severity as never,
      req.auth!.sub,
      req.auth!.email
    );
    ok(res, incident);
  })
);

router.post(
  '/:id/assign',
  validate({ body: assignIncidentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await assignEngineer(
      req.params.id,
      req.body.userId,
      req.auth!.sub,
      req.auth!.email,
      req.body.reason
    );
    ok(res, incident);
  })
);

router.post(
  '/:id/comment',
  validate({ body: incidentCommentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await addComment(req.params.id, req.body.message, req.auth!.sub, req.auth!.email);
    res.status(201).json(createApiResponse(true, { added: true }));
  })
);

router.post(
  '/:id/reopen',
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await reopenIncident(
      req.params.id,
      req.auth!.sub,
      req.auth!.email,
      req.auth!.email
    );
    ok(res, incident);
  })
);

export default router;