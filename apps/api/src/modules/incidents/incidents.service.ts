import {
  IncidentSeverity,
  IncidentStatus,
  IncidentPriority,
  severityToPriority,
  validateStatusTransition,
  IncidentTimelineEntry
} from '@opsmesh/shared';
import { query, transaction, Transaction } from '../../common/db';
import { generateId } from '../../common/id';
import { getRedis } from '../../common/redis';
import { wsHub } from '../../common/ws-hub';
import { NotFoundError, ConflictError } from '../../common/errors';
import { logger } from '../../common/logger';
import { findOnCallEngineerForTeam } from '../auth/auth.service';

export interface IncidentRow {
  id: string;
  title: string;
  description: string | null;
  service_id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  priority: IncidentPriority;
  assigned_engineer_id: string | null;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
  escalation_level: number;
  event_count: number;
  dedupe_key: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toIncidentDto(row: IncidentRow) {
  return {
    incidentId: row.id,
    title: row.title,
    description: row.description,
    serviceId: row.service_id,
    severity: row.severity,
    status: row.status,
    priority: row.priority,
    assignedEngineerId: row.assigned_engineer_id,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    escalationLevel: row.escalation_level,
    eventCount: row.event_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const INCIDENT_COLUMNS = `
  id, title, description, service_id, severity, status, priority,
  assigned_engineer_id, acknowledged_at, resolved_at, escalation_level,
  event_count, dedupe_key, created_at, updated_at
`;

async function insertTimeline(
  tx: Transaction,
  incidentId: string,
  type: string,
  message: string,
  actorId?: string | null,
  actorName?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  await tx.query(
    `INSERT INTO incident_timeline (id, incident_id, type, actor_id, actor_name, message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [generateId('tl'), incidentId, type, actorId ?? null, actorName ?? null, message, metadata ? JSON.stringify(metadata) : null]
  );
}

async function writeAudit(
  tx: Transaction,
  actorId: string | null | undefined,
  actorEmail: string | null | undefined,
  action: string,
  targetId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, metadata)
     VALUES ($1,$2,$3,$4,'incident',$5,$6)`,
    [generateId('aud'), actorId ?? null, actorEmail ?? null, action, targetId, metadata ? JSON.stringify(metadata) : null]
  );
}

// ---------------------------------------------------------------------------
// Incident creation lives in the event worker (apps/worker), which owns the
// create-with-dedupe transaction. The API only reads incidents and drives
// the state machine. Dedupe cache helpers below are shared conventions.
// ---------------------------------------------------------------------------

export async function getIncident(id: string): Promise<IncidentRow | null> {
  const res = await query<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function getIncidentDetail(id: string): Promise<{
  incident: ReturnType<typeof toIncidentDto>;
  service: { id: string; name: string; criticality: string } | null;
  assignedEngineer: { id: string; name: string; email: string } | null;
  timeline: IncidentTimelineEntry[];
  escalations: unknown[];
  notifications: unknown[];
  events: unknown[];
  audit: unknown[];
}> {
  const incident = await getIncident(id);
  if (!incident) throw new NotFoundError('Incident not found');

  const [svcRes, engRes, tlRes, escRes, notifRes, evtRes, audRes] = await Promise.all([
    query<{ id: string; name: string; criticality: string }>(`SELECT id, name, criticality FROM services WHERE id = $1`, [incident.service_id]),
    incident.assigned_engineer_id
      ? query<{ id: string; name: string; email: string }>(`SELECT id, name, email FROM users WHERE id = $1`, [incident.assigned_engineer_id])
      : Promise.resolve({ rows: [] as { id: string; name: string; email: string }[] }),
    query(
      `SELECT type, actor_name, message, metadata, created_at FROM incident_timeline
       WHERE incident_id = $1 ORDER BY created_at ASC`,
      [id]
    ),
    query(
      `SELECT step_level, target_name, reason, triggered_at, acknowledged FROM escalation_executions
       WHERE incident_id = $1 ORDER BY triggered_at ASC`,
      [id]
    ),
    query(
      `SELECT channel, recipient, subject, status, attempts, created_at, sent_at, error
       FROM notifications WHERE incident_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
    query(
      `SELECT e.id, e.event_type, e.severity, e.message, e.timestamp, e.request_id
       FROM events e JOIN incident_events ie ON ie.event_id = e.id
       WHERE ie.incident_id = $1 ORDER BY e.timestamp ASC LIMIT 100`,
      [id]
    ),
    query(
      `SELECT actor_email, action, metadata, created_at FROM audit_logs
       WHERE target_type = 'incident' AND target_id = $1 ORDER BY created_at DESC`,
      [id]
    )
  ]);

  return {
    incident: toIncidentDto(incident),
    service: svcRes.rows[0] ?? null,
    assignedEngineer: engRes.rows[0] ?? null,
    timeline: tlRes.rows.map((r) => ({
      id: String(Math.random()),
      incidentId: id,
      type: r.type,
      actorName: r.actor_name,
      message: r.message,
      metadata: r.metadata,
      createdAt: r.created_at
    })),
    escalations: escRes.rows,
    notifications: notifRes.rows,
    events: evtRes.rows,
    audit: audRes.rows
  };
}

export async function listIncidents(opts: {
  page?: number;
  limit?: number;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  serviceId?: string;
  assigneeId?: string;
}): Promise<{ data: ReturnType<typeof toIncidentDto>[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
  if (opts.severity) { params.push(opts.severity); conds.push(`severity = $${params.length}`); }
  if (opts.serviceId) { params.push(opts.serviceId); conds.push(`service_id = $${params.length}`); }
  if (opts.assigneeId) { params.push(opts.assigneeId); conds.push(`assigned_engineer_id = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [rowsRes, totalRes] = await Promise.all([
    query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents ${where}
       ORDER BY (status = 'RESOLVED') ASC, created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
    query<{ count: string }>(`SELECT count(*) FROM incidents ${where}`, params)
  ]);
  return {
    data: rowsRes.rows.map(toIncidentDto),
    total: Number(totalRes.rows[0]?.count ?? 0)
  };
}

export async function countActiveIncidents(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT count(*) FROM incidents WHERE status <> 'RESOLVED'`
  );
  return Number(res.rows[0]?.count ?? 0);
}

export interface UpdateStatusParams {
  status: IncidentStatus;
  actorId: string;
  actorName: string;
  actorEmail?: string;
  note?: string;
  resolutionSummary?: string;
}

/** Transition-guarded status updates. Invalid transitions are rejected. */
export async function updateIncidentStatus(
  incidentId: string,
  params: UpdateStatusParams
): Promise<IncidentRow> {
  return transaction(async (tx) => {
    const res = await tx.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1 AND status <> 'RESOLVED'`,
      [incidentId]
    );
    const incident = res.rows[0];
    if (!incident) throw new NotFoundError('Incident not found or already resolved');

    const check = validateStatusTransition(incident.status, params.status);
    if (!check.valid) throw new ConflictError(check.error!);

    const now = new Date();
    const updates: string[] = [`status = $2`, `updated_at = now()`];
    const values: unknown[] = [incidentId, params.status];
    if (params.status === IncidentStatus.ACKNOWLEDGED) {
      updates.push(`acknowledged_at = COALESCE(acknowledged_at, now())`);
    }
    if (params.status === IncidentStatus.RESOLVED) {
      updates.push(`resolved_at = now()`);
    }

    await tx.query(
      `UPDATE incidents SET ${updates.join(', ')} WHERE id = $1`,
      values
    );

    await insertTimeline(
      tx, incidentId, 'STATUS_CHANGED',
      `Status: ${incident.status} -> ${params.status}${params.note ? ` (${params.note})` : ''}`,
      params.actorId, params.actorName,
      { from: incident.status, to: params.status }
    );

    await writeAudit(
      tx, params.actorId, params.actorEmail,
      'INCIDENT_STATUS_CHANGED', incidentId,
      { from: incident.status, to: params.status }
    );

    if (params.status === IncidentStatus.RESOLVED) {
      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, metadata)
         VALUES ($1,$2,$3,'INCIDENT_RESOLVED','incident',$4,$5)`,
        [generateId('aud'), params.actorId, params.actorEmail, incidentId,
         JSON.stringify({ summary: params.resolutionSummary ?? null })]
      );
      // Clear dedupe cache so the next burst opens a fresh incident
      if (incident.dedupe_key) {
        clearDedupeCache(incident.dedupe_key, incidentId).catch(() => {});
      }
    }

    wsHub.broadcast('incident.updated', {
      incidentId,
      status: params.status,
      serviceId: incident.service_id
    });

    const updated = (await getIncident(incidentId))!;
    return updated;
  });
}

/** Direct severity change (with audit trail). */
export async function changeSeverity(
  incidentId: string,
  severity: IncidentSeverity,
  actorId: string,
  actorName: string,
  actorEmail?: string
): Promise<IncidentRow> {
  return transaction(async (tx) => {
    const res = await tx.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
      [incidentId]
    );
    const incident = res.rows[0];
    if (!incident) throw new NotFoundError('Incident not found');

    await tx.query(
      `UPDATE incidents SET severity = $2, priority = $3, updated_at = now() WHERE id = $1`,
      [incidentId, severity, severityToPriority(severity)]
    );
    await insertTimeline(
      tx, incidentId, 'STATUS_CHANGED',
      `Severity: ${incident.severity} -> ${severity}`,
      actorId, actorName
    );
    await writeAudit(tx, actorId, actorEmail, 'INCIDENT_SEVERITY_CHANGED', incidentId, {
      from: incident.severity,
      to: severity
    });
    const updated = (await getIncident(incidentId))!;
    return updated;
  });
}

export async function assignEngineer(
  incidentId: string,
  userId: string,
  actorId: string,
  actorName: string,
  reason?: string
): Promise<IncidentRow> {
  return transaction(async (tx) => {
    const res = await tx.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
      [incidentId]
    );
    const incident = res.rows[0];
    if (!incident) throw new NotFoundError('Incident not found');

    const user = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE id = $1 AND is_active = true`,
      [userId]
    );
    if (user.rows.length === 0) throw new NotFoundError('Engineer not found');

    await tx.query(
      `UPDATE incidents SET assigned_engineer_id = $2, updated_at = now() WHERE id = $1`,
      [incidentId, userId]
    );
    await tx.query(
      `INSERT INTO incident_assignments (id, incident_id, user_id, assigned_by, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [generateId('asg'), incidentId, userId, actorId, reason ?? 'manual assignment']
    );
    await insertTimeline(
      tx, incidentId, 'ASSIGNED',
      `Assigned to ${user.rows[0].name}${reason ? ` (${reason})` : ''}`,
      actorId, actorName
    );
    await writeAudit(tx, actorId, undefined, 'INCIDENT_ASSIGNED', incidentId, { userId, reason: reason ?? null });

    const updated = (await getIncident(incidentId))!;
    return updated;
  });
}

export async function addComment(
  incidentId: string,
  message: string,
  actorId: string,
  actorName: string
): Promise<void> {
  await query(
    `INSERT INTO incident_timeline (id, incident_id, type, actor_id, actor_name, message)
     VALUES ($1,$2,'COMMENT',$3,$4,$5)`,
    [generateId('tl'), incidentId, actorId, actorName, message]
  );
}

/**
 * Reopen a resolved incident. Not part of the normal state machine (RESOLVED
 * has no outgoing transitions) because reopening is an explicit operator action
 * that resets the incident to OPEN and restarts the lifecycle.
 */
export async function reopenIncident(
  incidentId: string,
  actorId: string,
  actorName: string,
  actorEmail?: string
): Promise<IncidentRow> {
  return transaction(async (tx) => {
    const res = await tx.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
      [incidentId]
    );
    const incident = res.rows[0];
    if (!incident) throw new NotFoundError('Incident not found');
    if (incident.status !== IncidentStatus.RESOLVED) {
      throw new ConflictError('Only a resolved incident can be reopened');
    }

    await tx.query(
      `UPDATE incidents SET status = 'OPEN', resolved_at = NULL, updated_at = now() WHERE id = $1`,
      [incidentId]
    );
    await insertTimeline(
      tx, incidentId, 'STATUS_CHANGED',
      'Incident reopened',
      actorId, actorName, { from: 'RESOLVED', to: 'OPEN' }
    );
    await writeAudit(tx, actorId, actorEmail, 'INCIDENT_REOPENED', incidentId, { from: 'RESOLVED', to: 'OPEN' });

    wsHub.broadcast('incident.updated', { incidentId, status: 'OPEN', serviceId: incident.service_id });

    return (await getIncident(incidentId))!;
  });
}

// ---------------------------------------------------------------------------
// Dedupe cache: fingerprint -> open incidentId
// ---------------------------------------------------------------------------

const DEDUPE_TTL_SECONDS = 30 * 60;
export const activeIncidentKey = (dedupeKey: string) => `inc:active:${dedupeKey}`;

export async function getDedupeCache(dedupeKey: string): Promise<string | null> {
  return getRedis().get(activeIncidentKey(dedupeKey));
}

export async function setDedupeCache(dedupeKey: string, incidentId: string, severity: IncidentSeverity): Promise<void> {
  await getRedis().set(activeIncidentKey(dedupeKey), JSON.stringify({ incidentId, severity }), {
    ttlSeconds: DEDUPE_TTL_SECONDS
  });
}

export async function clearDedupeCache(dedupeKey: string, incidentId: string): Promise<void> {
  const redis = getRedis();
  // Only clear if it still points at this incident (avoid racing a new incident)
  const cur = await redis.get(activeIncidentKey(dedupeKey));
  if (cur && JSON.parse(cur).incidentId === incidentId) {
    await redis.del(activeIncidentKey(dedupeKey));
  }
}