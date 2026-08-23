import {
  calculateSeverity,
  EventSeverity,
  IncidentSeverity,
  NotificationChannel,
  severityToPriority,
  ServiceCriticality
} from '@opsmesh/shared';
import { getRedis } from '../../common/redis';
import { query, transaction, Transaction } from '../../common/db';
import { logger } from '../../common/logger';
import { generateId } from '../../common/id';
import { emitRealtime } from '../../common/realtime';
import { enqueueIncidentNotification } from '../notification/notification.worker';

export interface IngestedEventMessage {
  eventId: string;
  serviceId: string;
  serviceName: string;
  serviceCriticality: ServiceCriticality;
  eventType: string;
  severity: EventSeverity;
  message: string;
  environment: string;
  timestamp: string;
  requestId: string | null;
  fingerprint: string;
  metadata: Record<string, unknown> | null;
}

export const EVENT_COUNTER_KEY_PREFIX = 'evt:count'; // per-fingerprint window counter
export const FINGERPRINT_WINDOW_SECONDS = 30 * 60;

export interface ProcessResult {
  outcome: 'incident_created' | 'incident_updated' | 'dedup_suppressed' | 'error';
  incidentId?: string;
  eventId: string;
}

/**
 * Idempotent event processing. May be invoked multiple times for the same
 * event (broker redelivery, worker crash mid-commit) - every step is guarded:
 *  - events.INSERT ... ON CONFLICT (id) DO NOTHING (event stored exactly once)
 *  - incident_events UNIQUE (incident_id, event_id) (link exactly once)
 *  - incidents.dedupe_key UNIQUE (one incident per fingerprint window)
 */
export async function processEvent(msg: IngestedEventMessage): Promise<ProcessResult> {
  const redis = getRedis();

// 1. durable store, idempotently. The API persists a durable record on ingest,
  // so the row usually already exists (ON CONFLICT -> no-op); on redelivery we
  // insert it ourselves. Idempotency of side effects is enforced downstream by
  // incident_events UNIQUE (incident_id, event_id) and incidents.dedupe_key UNIQUE.
  await query(
    `INSERT INTO events (id, service_id, event_type, severity, message, environment, timestamp, request_id, fingerprint, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      msg.eventId, msg.serviceId, msg.eventType, msg.severity, msg.message,
      msg.environment, new Date(msg.timestamp), msg.requestId,
      msg.fingerprint, msg.metadata ? JSON.stringify(msg.metadata) : null
    ]
  );

  // Surface the ingested event on the realtime bus so the dashboard event
  // stream updates live (independent of whether it opens/updates an incident).
  await emitRealtime('event.ingested', {
    eventId: msg.eventId,
    serviceId: msg.serviceId,
    serviceName: msg.serviceName,
    eventType: msg.eventType,
    severity: msg.severity,
    fingerprint: msg.fingerprint
  });

  // 2. per-fingerprint sliding counter (Redis). Drives dedup + frequency for severity
  const counterKey = `${EVENT_COUNTER_KEY_PREFIX}:${msg.fingerprint}`;
  let windowCount = 1;
  try {
    windowCount = await redis.slidingWindowAdd(counterKey, FINGERPRINT_WINDOW_SECONDS);
  } catch {
    /* redis down: fall back to single-event semantics */
  }

  // 3. is there an open incident for this fingerprint?
  let incidentId: string | null = null;
  try {
    const cached = await redis.get(incKeyFor(msg.fingerprint));
    if (cached) {
      const parsed = JSON.parse(cached) as { incidentId: string; severity: string; status: string };
      incidentId = parsed.incidentId;
    }
  } catch {
    /* redis down */
  }

  if (!incidentId) {
    incidentId = await findOpenIncidentByFingerprint(msg.fingerprint);
  }

if (incidentId) {
    await linkEvent(incidentId, msg.eventId);
    await refreshDedupeWindow(msg.fingerprint, incidentId);
    await emitRealtime('incident.updated', {
      incidentId,
      serviceId: msg.serviceId,
      eventType: msg.eventType,
      windowCount
    });
    return { outcome: 'incident_updated', incidentId, eventId: msg.eventId };
  }

  // 4. no open incident -> create one (deterministic severity)
  const service = await getService(msg.serviceId);
  const severity = calculateSeverity({
    serviceCriticality: (service?.criticality as ServiceCriticality) ?? ServiceCriticality.MEDIUM,
    eventSeverity: msg.severity,
    environment: msg.environment as never,
    errorFrequency: windowCount,
    isRepeatedFailure: windowCount > 1
  });

  incidentId = await createIncidentRecord({
    serviceId: msg.serviceId,
    serviceName: msg.serviceName,
    eventId: msg.eventId,
    fingerprint: msg.fingerprint,
    severity,
    message: msg.message,
    eventType: msg.eventType
  });

  await refreshDedupeWindow(msg.fingerprint, incidentId);

  // Notify the assigned engineer (or policy targets) asynchronously.
const assigned = await query<{ email: string; name: string }>(
    `SELECT u.email, u.name FROM users u JOIN incidents i ON i.assigned_engineer_id = u.id
     WHERE i.id = $1`,
    [incidentId]
  );
  if (assigned.rows[0]) {
    await enqueueIncidentNotification({
      incidentId,
      serviceName: msg.serviceName,
      severity,
      title: `${msg.serviceName}: ${msg.eventType}`,
      channels: [NotificationChannel.EMAIL, NotificationChannel.WEBHOOK],
      recipient: assigned.rows[0].email,
      action: 'CREATED',
      targetName: assigned.rows[0].name
    });
  }

logger.info(
    {
      eventId: msg.eventId,
      incidentId,
      severity,
      windowCount
    },
    'incident created from event'
  );

  await emitRealtime('incident.created', {
    incidentId,
    serviceId: msg.serviceId,
    serviceName: msg.serviceName,
    severity,
    status: 'OPEN',
    eventType: msg.eventType,
    message: msg.message
  });

  return { outcome: 'incident_created', incidentId, eventId: msg.eventId };
}

// ---------------------------------------------------------------------------

async function findOpenIncidentByFingerprint(fingerprint: string): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM incidents WHERE dedupe_key = $1 AND status <> 'RESOLVED' LIMIT 1`,
    [fingerprint]
  );
  return res.rows[0]?.id ?? null;
}

async function linkEvent(incidentId: string, eventId: string): Promise<void> {
  const res = await query(
    `INSERT INTO incident_events (id, incident_id, event_id) VALUES ($1,$2,$3)
     ON CONFLICT (incident_id, event_id) DO NOTHING RETURNING id`,
    [generateId('inc_evt'), incidentId, eventId]
  );
  if (res.rows.length > 0) {
    await query(
      `UPDATE incidents SET event_count = event_count + 1, updated_at = now() WHERE id = $1`,
      [incidentId]
    );
  }
}

async function refreshDedupeWindow(fingerprint: string, incidentId: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(incKeyFor(fingerprint), JSON.stringify({
      incidentId,
      severity: '', // filled on create
      status: 'OPEN'
    }), { ttlSeconds: FINGERPRINT_WINDOW_SECONDS });
  } catch {
    /* redis down - DB query fallback covers lookups */
  }
}

function incKeyFor(fingerprint: string): string {
  return `inc:active:${fingerprint}`;
}

async function getService(serviceId: string): Promise<{ criticality: string; name: string } | null> {
  const res = await query<{ criticality: string; name: string }>(
    `SELECT criticality, name FROM services WHERE id = $1 AND deleted_at IS NULL`,
    [serviceId]
  );
  return res.rows[0] ?? null;
}

async function createIncidentRecord(params: {
  serviceId: string;
  serviceName: string;
  eventId: string;
  fingerprint: string;
  severity: IncidentSeverity;
  message: string;
  eventType: string;
}): Promise<string> {
  return transaction(async (tx) => {
    // find on-call engineer for the service's owner team (via active shift)
    const svc = await tx.query<{ owner_team_id: string | null }>(
      `SELECT owner_team_id FROM services WHERE id = $1`,
      [params.serviceId]
    );
    const ownerTeam = svc.rows[0]?.owner_team_id ?? null;
    const onCall = ownerTeam ? await activeEngineerForTeam(tx, ownerTeam) : null;

    const id = generateId('inc');
    const title = `${params.serviceName}: ${params.eventType}`;

    const res = await tx.query(
      `INSERT INTO incidents (
         id, title, description, service_id, severity, status, priority,
         assigned_engineer_id, event_count, dedupe_key
       )
       VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,1,$8)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        id,
        title,
        params.message,
        params.serviceId,
        params.severity,
        severityToPriority(params.severity),
        onCall?.id ?? null,
        params.fingerprint
      ]
    );
    const incidentId = res.rows[0]?.id;
    if (!incidentId) {
      // lost the race; another worker created it. re-fetch.
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM incidents WHERE dedupe_key = $1`,
        [params.fingerprint]
      );
      return existing.rows[0].id;
    }

    await tx.query(
      `INSERT INTO incident_events (id, incident_id, event_id) VALUES ($1,$2,$3)`,
      [generateId('inc_evt'), incidentId, params.eventId]
    );
    await tx.query(
      `INSERT INTO incident_timeline (id, incident_id, type, actor_id, actor_name, message, metadata)
       VALUES ($1,$2,'CREATED',NULL,NULL,'Incident created from event', $3)`,
      [generateId('tl'), incidentId, JSON.stringify({ eventType: params.eventType })]
    );
    if (onCall) {
      await tx.query(
        `INSERT INTO incident_timeline (id, incident_id, type, actor_id, actor_name, message)
         VALUES ($1,$2,'ASSIGNED',$3,$4,'Assigned to on-call engineer')`,
        [generateId('tl'), incidentId, onCall.id, onCall.name]
      );
      await tx.query(
        `INSERT INTO incident_assignments (id, incident_id, user_id, assigned_by, reason)
         VALUES ($1,$2,$3,NULL,'auto on-call')`,
        [generateId('asg'), incidentId, onCall.id]
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, metadata)
       VALUES ($1,NULL,NULL,'INCIDENT_CREATED','incident',$2,$3)`,
      [generateId('aud'), incidentId, JSON.stringify({ severity: params.severity, serviceId: params.serviceId })]
    );

    return incidentId;
  });
}

async function activeEngineerForTeam(
  tx: Transaction,
  teamId: string
): Promise<{ id: string; name: string } | null> {
  const res = await tx.query<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM users u
     JOIN on_call_shifts s ON s.user_id = u.id
     JOIN on_call_schedules sc ON sc.id = s.schedule_id
     WHERE sc.team_id = $1 AND s.starts_at <= now() AND s.ends_at > now()
     ORDER BY s.ends_at LIMIT 1`,
    [teamId]
  );
  if (res.rows.length > 0) return res.rows[0];
  const fallback = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE team_id = $1 AND role IN ('ENGINEER','ADMIN') AND is_active = true
     ORDER BY created_at LIMIT 1`,
    [teamId]
  );
  return fallback.rows[0] ?? null;
}
