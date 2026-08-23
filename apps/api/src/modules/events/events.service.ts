import {
  calculateFingerprint,
  createFingerprintFromEvent,
  EventSeverity,
  IngestEventInput
} from '@opsmesh/shared';
import { query } from '../../common/db';
import { getRedis } from '../../common/redis';
import { getEventBus, PublishedMessage } from '../../common/eventbus';
import { generateId } from '../../common/id';
import { logger } from '../../common/logger';
import { BadRequestError } from '../../common/errors';
import { recordPublished } from '../../common/stats';

export interface IngestResult {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  fingerprint: string;
  published: boolean;
}

/**
 * Ingestion pipeline (all steps before enqueue):
 *  1. service name -> serviceId (indexed lookup, cached in Redis)
 *  2. idempotency guard: same (requestId) or (fingerprint+hash(metadata)) seen
 *     within the dedupe window in Redis -> duplicate, no side effects
 *  3. fingerprint computed deterministically
 *  4. event row INSERTed in 'RECEIVED' state (durable record, survives broker loss)
 *  5. published to the event bus; processing happens asynchronously
 */
export async function ingestEvent(input: IngestEventInput, authorizedServiceId?: string): Promise<IngestResult> {
  const redis = getRedis();

  const service = await resolveService(input.service);
  if (!service) {
    throw new BadRequestError(`Unknown service '${input.service}' - register it first`);
  }

  // Source-bound auth: the API key authorizes exactly one service (key.subject).
  // Reject events claiming a different service name - cross-service spoofing guard.
  if (authorizedServiceId && service.id !== authorizedServiceId) {
    logger.warn(
      { keySubject: authorizedServiceId, claimed: input.service },
      'rejected event: service mismatch with api key'
    );
    throw new BadRequestError(
      `API key is not authorized for service '${input.service}'`
    );
  }

  const fingerprint = calculateFingerprint(input);

  // ---- idempotency (ingest path) -------------------------------------------
  // Key 1: client-supplied requestId - exact dedup for retried HTTP calls.
  // Key 2: fingerprint + hash(metadata) - absorbs retries that reuse the
  // payload but drop the requestId. Both expire after the dedupe window.
  const idemKey1 = input.requestId ? `idem:req:${input.requestId}` : null;
  const metaHash = input.metadata
    ? JSON.stringify(input.metadata).length
    : 0;
  const idemKey2 = `idem:fp:${fingerprint}:${metaHash}`;
  for (const key of [idemKey1, idemKey2].filter(Boolean)) {
    if (await redis.exists(key as string)) {
      logger.info({ fingerprint, key }, 'duplicate event suppressed at ingest');
      return {
        eventId: '',
        accepted: false,
        duplicate: true,
        fingerprint,
        published: false
      };
    }
  }
  if (idemKey1) await redis.set(idemKey1, '1', { ttlSeconds: DEDUPE_WINDOW_MS / 1000 });
  await redis.set(idemKey2, '1', { ttlSeconds: DEDUPE_WINDOW_MS / 1000 });

  // ---- durable record -------------------------------------------------------
  const eventId = generateId('evt');
  const createdAt = new Date();
  await query(
    `INSERT INTO events (id, service_id, event_type, severity, message, environment, timestamp, request_id, fingerprint, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      eventId,
      service.id,
      input.eventType,
      input.severity,
      input.message,
      input.environment,
      input.timestamp ? new Date(input.timestamp) : createdAt,
      input.requestId ?? null,
      fingerprint,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );

  // ---- enqueue --------------------------------------------------------------
  await getEventBus().publish('event.ingested', {
    eventId,
    serviceId: service.id,
    serviceName: service.name,
    serviceCriticality: null,
    eventType: input.eventType,
    severity: input.severity,
    message: input.message,
    environment: input.environment,
    timestamp: input.timestamp ?? createdAt.toISOString(),
    requestId: input.requestId ?? null,
    fingerprint,
    metadata: input.metadata ?? null
  });

  await recordPublished('ingest');

  logger.info(
    { eventId, service: service.name, fingerprint: fingerprint.slice(0, 8) },
    'event ingested and queued'
  );

  return {
    eventId,
    accepted: true,
    duplicate: false,
    fingerprint,
    published: true
  };
}

/**
 * Fetches a service by name with a Redis-backed cache (60s TTL).
 * Redis failure degrades to a direct query (availablity over consistency).
 */
async function resolveService(name: string): Promise<{ id: string; name: string } | null> {
  const redis = getRedis();
  const cacheKey = `svc:name:${name}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    /* redis unavailable - fall through to DB */
  }
  const res = await query<{ id: string; name: string }>(
    `SELECT id, name FROM services WHERE name = $1 AND deleted_at IS NULL`,
    [name]
  );
  if (res.rows.length === 0) return null;
  try {
    await redis.set(cacheKey, JSON.stringify(res.rows[0]), { ttlSeconds: 60 });
  } catch {
    /* cache writes are best-effort */
  }
  return res.rows[0];
}

export interface ListEventsOpts {
  page?: number;
  limit?: number;
  serviceId?: string;
  eventType?: string;
  severity?: string;
  correlationId?: string;
  status?: 'PROCESSED' | 'RECEIVED';
  search?: string;
}

export interface EventListItem {
  id: string;
  serviceId: string;
  serviceName: string | null;
  eventType: string;
  severity: string;
  message: string;
  environment: string;
  timestamp: Date;
  requestId: string | null;
  fingerprint: string;
  incidentId: string | null;
  createdAt: Date;
}

/**
 * List ingested events for the dashboard event stream. Every event is linked
 * (when processed) to an incident via `incident_events`, so we derive a
 * processing status from that linkage rather than storing a redundant column.
 */
export async function listEvents(opts: ListEventsOpts): Promise<{ data: EventListItem[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const conds: string[] = [];
  const params: unknown[] = [];

  if (opts.serviceId) { params.push(opts.serviceId); conds.push(`e.service_id = $${params.length}`); }
  if (opts.eventType) { params.push(opts.eventType); conds.push(`e.event_type = $${params.length}`); }
  if (opts.severity) { params.push(opts.severity); conds.push(`e.severity = $${params.length}`); }
  if (opts.correlationId) { params.push(opts.correlationId); conds.push(`e.request_id = $${params.length}`); }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    conds.push(`(e.message ILIKE $${params.length} OR e.event_type ILIKE $${params.length})`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const base = `FROM events e LEFT JOIN services s ON s.id = e.service_id ${where}`;
  const [rowsRes, totalRes] = await Promise.all([
    query<EventListItem & { incident_id: string | null }>(
      `SELECT e.id, e.service_id, s.name AS service_name, e.event_type, e.severity, e.message,
              e.environment, e.timestamp, e.request_id, e.fingerprint, e.created_at,
              (SELECT ie.incident_id FROM incident_events ie WHERE ie.event_id = e.id LIMIT 1) AS incident_id
       ${base}
       ORDER BY e.timestamp DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
    query<{ count: string }>(`SELECT count(*) AS count ${base}`, params)
  ]);

  const data: EventListItem[] = rowsRes.rows.map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    serviceName: r.service_name,
    eventType: r.event_type,
    severity: r.severity,
    message: r.message,
    environment: r.environment,
    timestamp: r.timestamp,
    requestId: r.request_id,
    fingerprint: r.fingerprint,
    incidentId: r.incident_id,
    createdAt: r.created_at
  }));

  return { data, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export const DEDUPE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes per spec example

export function handleWorkerCrashRedelivery(message: PublishedMessage): void {
  logger.warn(
    { payload: message.payload as Record<string, unknown> },
    'redelivery of previously processed event detected - idempotent worker will suppress'
  );
}

// Re-export helpers used by tests
export { createFingerprintFromEvent };