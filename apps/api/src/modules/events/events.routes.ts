import { Router, Request, Response } from 'express';
import { createApiResponse, ingestEventSchema, paginationSchema } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireApiKey, requireAuth } from '../../middleware/auth';
import { eventIngestionRateLimit } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import { ingestEvent, listEvents } from './events.service';
import { logger } from '../../common/logger';
import { getRequestId } from '../../common/context';

const router = Router();

/**
 * GET /api/v1/events - dashboard event stream (authenticated).
 * Supports filtering by serviceId, eventType, severity, correlationId, status
 * and free-text search. Returns the raw event list (no side effects).
 */
router.get(
  '/',
  requireAuth(),
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const { data, total } = await listEvents({
      page: Number(q.page ?? 1),
      limit: Number(q.limit ?? 50),
      serviceId: q.serviceId,
      eventType: q.eventType,
      severity: q.severity,
      correlationId: q.correlationId,
      status: q.status as 'PROCESSED' | 'RECEIVED' | undefined,
      search: q.search
    });
    res.json(
      createApiResponse(true, {
        data,
        total,
        page: Number(q.page ?? 1),
        limit: Number(q.limit ?? 50)
      })
    );
  })
);

/**
 * POST /api/v1/events - public ingestion endpoint.
 * Auth: x-opsmesh-key header (service API key). The key's subject (serviceId)
 * must match the payload `service` name - prevents cross-service spoofing.
 * Returns 202 with eventId; all heavy processing is asynchronous.
 */
router.post(
  '/',
  requireApiKey(),
  eventIngestionRateLimit(),
  validate({ body: ingestEventSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const result = await ingestEvent(req.body, req.apiKey?.subject);

    const payloadService = req.body.service as string;
    logger.info(
      {
        requestId: getRequestId(),
        keySubject: req.apiKey?.subject,
        payloadService,
        durationMs: Date.now() - start
      },
      'event ingest completed'
    );

    if (result.duplicate) {
      res.status(200).json(
        createApiResponse(true, {
          eventId: result.eventId,
          duplicate: true,
          fingerprint: result.fingerprint
        })
      );
      return;
    }

    if (!result.accepted) {
      res.status(400).json(createApiResponse(false, undefined, {
        code: 'EVENT_REJECTED',
        message: 'Event was not accepted'
      }));
      return;
    }

    res.status(202).json(
      createApiResponse(true, {
        eventId: result.eventId,
        accepted: true,
        fingerprint: result.fingerprint
      })
    );
  })
);

export default router;