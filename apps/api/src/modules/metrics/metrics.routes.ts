import { Router } from 'express';
import { createApiResponse } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth';
import { query } from '../../common/db';
import { getRedis } from '../../common/redis';
import { getAvgLatency } from '../../common/latency';

const router = Router();
router.use(requireAuth());

export interface DashboardMetricsDto {
  eventsPerMinute: number;
  eventsLast24h: number;
  totalEvents: number;
  activeIncidents: number;
  openBySeverity: Record<string, number>;
  mttaMinutes: number;
  mttrMinutes: number;
  escalationRate: number;
  serviceAvailability: number;
  servicesByStatus: Record<string, number>;
  resolvedLast24h: number;
  apiLatencyMs: number;
}

/**
 * Every metric is computed from live data; nothing is fabricated.
 * MTTA/MTTR/availability are refreshed by the metrics worker, the rest query
 * the DB directly so they are always current.
 */
export async function computeDashboardMetrics(): Promise<DashboardMetricsDto> {
  const redis = getRedis();
  const cached = await redis.get('metrics:overview');
  if (cached) {
    return JSON.parse(cached) as DashboardMetricsDto;
  }

  const ttl = 60; // seconds

  const [
    activeRes,
    sevRes,
    resolvedRes,
    ttaRes,
    ttrRes,
    escRes,
    svcRes,
    eventsMinuteRes,
    events24hRes,
    totalEventsRes
  ] = await Promise.all([
    query(`SELECT count(*) AS c FROM incidents WHERE status <> 'RESOLVED'`),
    query(
      `SELECT severity, count(*) AS c FROM incidents WHERE status <> 'RESOLVED' GROUP BY severity`
    ),
    query(`SELECT count(*) AS c FROM incidents WHERE resolved_at > now() - interval '24 hours'`),
    query(
      `SELECT avg(EXTRACT(EPOCH FROM (acknowledged_at - created_at)) / 60) AS m FROM incidents
       WHERE acknowledged_at IS NOT NULL AND acknowledged_at > now() - interval '7 days'`
    ),
    query(
      `SELECT avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) AS m FROM incidents
       WHERE resolved_at IS NOT NULL AND resolved_at > now() - interval '7 days'`
    ),
    query(
      `SELECT count(*) FILTER (WHERE escalation_level > 0) AS esc,
              count(*) AS total FROM incidents
       WHERE created_at > now() - interval '7 days'`
    ),
    query(
      `SELECT status, count(*) AS c FROM services WHERE deleted_at IS NULL GROUP BY status`
    ),
    query(`SELECT count(*) AS c FROM events WHERE created_at > now() - interval '1 minute'`),
    query(`SELECT count(*) AS c FROM events WHERE created_at > now() - interval '24 hours'`),
    query(`SELECT count(*) AS c FROM events`)
  ]);

  const esc = escRes.rows[0];
  const svcHealthy = Number(svcRes.rows.find((r) => r.status === 'HEALTHY')?.c ?? 0);
  const svcTotal = svcRes.rows.reduce((acc, r) => acc + Number(r.c), 0);
  const serviceAvail = svcTotal ? (svcHealthy / svcTotal) * 100 : 100;

  const severityCounts: Record<string, number> = {};
  for (const r of sevRes.rows) severityCounts[r.severity] = Number(r.c);

  const metrics: DashboardMetricsDto = {
    eventsPerMinute: Number(eventsMinuteRes.rows[0]?.c ?? 0),
    eventsLast24h: Number(events24hRes.rows[0]?.c ?? 0),
    totalEvents: Number(totalEventsRes.rows[0]?.c ?? 0),
    activeIncidents: Number(activeRes.rows[0]?.c ?? 0),
    openBySeverity: severityCounts,
    mttaMinutes: round1(ttaRes.rows[0]?.m),
    mttrMinutes: round1(ttrRes.rows[0]?.m),
    escalationRate: Number(esc?.total) ? (Number(esc.esc) / Number(esc.total)) * 100 : 0,
    serviceAvailability: round1(serviceAvail),
    servicesByStatus: Object.fromEntries(svcRes.rows.map((r) => [r.status, Number(r.c)])),
    resolvedLast24h: Number(resolvedRes.rows[0]?.c ?? 0),
    apiLatencyMs: round1(getAvgLatency())
  };

  try {
    await redis.set('metrics:overview', JSON.stringify(metrics), { ttlSeconds: ttl });
  } catch {
    /* best-effort cache */
  }
  return metrics;
}

function round1(n: unknown): number {
  const v = Number(n ?? 0);
  return Math.round(v * 10) / 10;
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const metrics = await computeDashboardMetrics();
    res.json(createApiResponse(true, metrics));
  })
);

router.get(
  '/events-rate',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT date_trunc('minute', created_at) AS minute, count(*) AS c
       FROM events WHERE created_at > now() - interval '60 minutes'
       GROUP BY minute ORDER BY minute`
    );
    ok(res, rows.rows);
  })
);

export default router;