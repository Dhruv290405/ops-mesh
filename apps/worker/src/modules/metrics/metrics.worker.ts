import { getRedis } from '../../common/redis';
import { query } from '../../common/db';
import { logger } from '../../common/logger';

export interface OverviewMetrics {
  eventsPerMinute: number;
  eventsLast24h: number;
  activeIncidents: number;
  mttaMinutes: number;
  mttrMinutes: number;
  escalationRate: number;
  serviceAvailability: number;
  resolvedLast24h: number;
}

/**
 * Metrics worker: precomputes dashboard aggregates into Redis (60s TTL).
 * The API serves these from cache for fast reads; this worker guarantees the
 * cache stays warm even with heavy DB load at query time.
 */
export async function refreshOverviewMetrics(): Promise<OverviewMetrics> {
  const [active, tta, ttr, escRow, svc, resolved, evtMin, evt24h] = await Promise.all([
    query(`SELECT count(*) AS c FROM incidents WHERE status <> 'RESOLVED'`),
    query(
      `SELECT avg(EXTRACT(EPOCH FROM (acknowledged_at - created_at)) / 60) AS m FROM incidents
       WHERE acknowledged_at IS NOT NULL AND acknowledged_at > now() - interval '7 days'`
    ),
    query(
      `SELECT avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) AS m FROM incidents
       WHERE resolved_at IS NOT NULL AND resolved_at > now() - interval '7 days'`
    ),
    query(
      `SELECT count(*) FILTER (WHERE escalation_level > 0) AS esc, count(*) AS total
       FROM incidents WHERE created_at > now() - interval '7 days'`
    ),
    query(
      `SELECT status, count(*) AS c FROM services s
       WHERE deleted_at IS NULL AND status <> 'MAINTENANCE'
       GROUP BY status`
    ),
    query(`SELECT count(*) AS c FROM incidents WHERE resolved_at > now() - interval '24 hours'`),
    query(`SELECT count(*) AS c FROM events WHERE created_at > now() - interval '1 minute'`),
    query(`SELECT count(*) AS c FROM events WHERE created_at > now() - interval '24 hours'`)
  ]);

const healthy = Number(svc.rows.find((r) => r.status === 'HEALTHY')?.c ?? 0);
  const total = svc.rows.reduce((a, r) => a + Number(r.c), 0);
  const esc = escRow.rows[0] as { esc: number | string; total: number | string } | undefined;

  const metrics: OverviewMetrics = {
    eventsPerMinute: Number(evtMin.rows[0]?.c ?? 0),
    eventsLast24h: Number(evt24h.rows[0]?.c ?? 0),
    activeIncidents: Number(active.rows[0]?.c ?? 0),
    mttaMinutes: round1(tta.rows[0]?.m),
    mttrMinutes: round1(ttr.rows[0]?.m),
    escalationRate: esc && Number(esc.total) ? (Number(esc.esc) / Number(esc.total)) * 100 : 0,
    serviceAvailability: total ? round1((healthy / total) * 100) : 100,
    resolvedLast24h: Number(resolved.rows[0]?.c ?? 0)
  };

  await getRedis().set('metrics:overview', JSON.stringify(metrics), { ttlSeconds: 60 });
  return metrics;
}

function round1(n: unknown): number {
  return Math.round(Number(n ?? 0) * 10) / 10;
}

export async function refreshEventsBuckets(): Promise<void> {
  const rows = await query(
    `SELECT date_trunc('minute', created_at) AS minute, count(*) AS c
     FROM events WHERE created_at > now() - interval '60 minutes'
     GROUP BY minute ORDER BY minute`
  );
  await getRedis().set('metrics:events-rate', JSON.stringify(rows.rows), { ttlSeconds: 60 });
}
