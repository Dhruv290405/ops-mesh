import {
  CreateServiceInput,
  ServiceStatus,
  UpdateServiceInput
} from '@opsmesh/shared';
import { query, transaction } from '../../common/db';
import { ensureUniqueServiceName, requireServiceExists } from '../auth/api-key-store';
import { generateId } from '../../common/id';
import { NotFoundError } from '../../common/errors';

const SERVICE_COLUMNS = `
  id, name, description, environment, owner_team_id, health_check_url,
  health_check_method, health_check_timeout, health_check_interval, expected_status,
  criticality, sla_minutes, status, created_at, updated_at, deleted_at
`;

export interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  environment: string;
  owner_team_id: string | null;
  health_check_url: string | null;
  health_check_method: string;
  health_check_timeout: number;
  health_check_interval: number;
  expected_status: number;
  criticality: string;
  sla_minutes: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function toServiceDto(row: ServiceRow, incidentCount?: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    environment: row.environment,
    ownerTeamId: row.owner_team_id,
    healthCheck: {
      url: row.health_check_url,
      method: row.health_check_method,
      timeoutMs: row.health_check_timeout,
      intervalMs: row.health_check_interval,
      expectedStatus: row.expected_status
    },
    criticality: row.criticality,
    slaMinutes: row.sla_minutes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(incidentCount !== undefined ? { openIncidentCount: incidentCount } : {})
  };
}

export async function createService(input: CreateServiceInput, actorId: string): Promise<ServiceRow> {
  await ensureUniqueServiceName(input.name);
  return transaction(async (tx) => {
    const id = generateId('svc');
    const res = await tx.query<ServiceRow>(
      `INSERT INTO services (
         id, name, description, environment, owner_team_id, health_check_url,
         health_check_method, health_check_timeout, health_check_interval, expected_status,
         criticality, sla_minutes, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UNKNOWN')
       RETURNING ${SERVICE_COLUMNS}`,
      [
        id,
        input.name,
        input.description ?? null,
        input.environment,
        input.ownerTeamId ?? null,
        input.healthCheckUrl ?? null,
        input.healthCheckMethod ?? 'GET',
        input.healthCheckTimeout ?? 5000,
        input.healthCheckInterval ?? 60000,
        input.expectedStatus ?? 200,
        input.criticality,
        input.slaMinutes ?? null
      ]
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'SERVICE_CREATED', 'service', $3, $4)`,
      [generateId('aud'), actorId, id, JSON.stringify({ name: input.name })]
    );
    return res.rows[0];
  });
}

export async function updateService(
  id: string,
  input: UpdateServiceInput,
  actorId: string
): Promise<ServiceRow> {
  await requireServiceExists(id);
  if (input.name) await ensureUniqueServiceName(input.name, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, param: number, value: unknown) => {
    void column;
    void param;
    params.push(value);
  };

  // explicit column mapping (camelCase input -> snake_case column)
  const columnMap: [keyof UpdateServiceInput, string][] = [
    ['name', 'name'],
    ['description', 'description'],
    ['ownerTeamId', 'owner_team_id'],
    ['healthCheckUrl', 'health_check_url'],
    ['healthCheckMethod', 'health_check_method'],
    ['healthCheckTimeout', 'health_check_timeout'],
    ['healthCheckInterval', 'health_check_interval'],
    ['expectedStatus', 'expected_status'],
    ['criticality', 'criticality'],
    ['slaMinutes', 'sla_minutes'],
    ['status', 'status']
  ];

  for (const [key, column] of columnMap) {
    const value = input[key];
    if (value !== undefined) {
      push(column, params.length + 1, value);
      sets.push(`${column} = $${params.length}`);
    }
  }

  if (sets.length === 0) return (await getServiceById(id))!;
  sets.push(`updated_at = now()`);
  const res = await query<ServiceRow>(
    `UPDATE services SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${SERVICE_COLUMNS}`,
    [id, ...params]
  );
  const row = res.rows[0];
  await query(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'SERVICE_UPDATED', 'service', $3, $4)`,
    [generateId('aud'), actorId, id, JSON.stringify(input)]
  );
  return row;
}

export async function getServiceById(id: string): Promise<ServiceRow | null> {
  const res = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM services WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function listServices(opts: { environment?: string; status?: string; search?: string } = {}): Promise<ServiceRow[]> {
  const conds = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (opts.environment) {
    params.push(opts.environment);
    conds.push(`environment = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    conds.push(`status = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    conds.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  const res = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM services WHERE ${conds.join(' AND ')} ORDER BY name ASC`
  , params);
  return res.rows;
}

export async function disableService(id: string, actorId: string): Promise<void> {
  const res = await query<ServiceRow>(
    `UPDATE services SET status = 'MAINTENANCE', updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (res.rows.length === 0) throw new NotFoundError(`Service ${id} not found`);
  await query(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'SERVICE_DISABLED', 'service', $3, '{}')`,
    [generateId('aud'), actorId, id]
  );
}

export async function getServiceHealth(id: string): Promise<{
  service: ReturnType<typeof toServiceDto>;
  lastCheck: unknown;
  recentEvents: unknown[];
}> {
  await requireServiceExists(id);
  const [lastCheckRes, eventsRes] = await Promise.all([
    query(
      `SELECT status, latency_ms, status_code, error, checked_at
       FROM health_check_results WHERE service_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [id]
    ),
    query(
      `SELECT event_type, severity, message, timestamp
       FROM events WHERE service_id = $1 ORDER BY timestamp DESC LIMIT 20`,
      [id]
    )
  ]);
  const service = (await getServiceById(id))!;
  return {
    service: toServiceDto(service),
    lastCheck: lastCheckRes.rows[0] ?? null,
    recentEvents: eventsRes.rows
  };
}

export async function listHistoricalIncidents(serviceId: string, limit = 20): Promise<unknown[]> {
  const res = await query(
    `SELECT id, title, severity, status, created_at, resolved_at FROM incidents
     WHERE service_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [serviceId, limit]
  );
  return res.rows;
}