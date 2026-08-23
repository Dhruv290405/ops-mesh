'use client';

import { useFetch } from '../../../lib/useFetch';
import { useRealtime } from '../../../lib/socket';
import {
  fetchMetrics,
  fetchServices,
  fetchServiceHealth,
  fetchIncidents,
  fetchEvents,
  fetchQueues,
  fetchWorkers,
  fetchHealthDeep,
  DashboardMetrics,
  Service,
  ServiceHealth,
  Incident,
  EventItem,
  QueueStat,
  WorkerStat,
  HealthComponent
} from '../../../lib/api';
import { Card, StatCard, StatusBadge, SeverityBadge, Spinner, ErrorState, Empty, PageHeader, Dot } from '../../../components/ui';
import { relativeTime, fmtNum, severityClass, statusClass, statusDot } from '../../../lib/format';

export default function DashboardPage() {
  const { data, loading, error, reload } = useFetch(async () => {
    const [m, svcs, inc, ev, q, w, h] = await Promise.all([
      fetchMetrics(),
      fetchServices(''),
      fetchIncidents('?limit=12'),
      fetchEvents('?limit=14'),
      fetchQueues(),
      fetchWorkers(),
      fetchHealthDeep()
    ]);
    const health = await Promise.all(
      svcs.map((s) => fetchServiceHealth(s.id).then((x) => [s.id, x] as const).catch(() => [s.id, null] as const))
    );
    const healthMap: Record<string, ServiceHealth | null> = Object.fromEntries(health);
    return { m, svcs, inc, ev, q, w, h, healthMap };
  });

  useRealtime('incident.created', reload);
  useRealtime('incident.updated', reload);
  useRealtime('metrics.refresh', reload);
  useRealtime('service.health', reload);
  useRealtime('notification.dispatched', reload);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Empty>Nothing to show.</Empty>;

  const { m, svcs, inc, ev, q, w, h, healthMap } = data;
  const activeIncidents = (inc.data ?? []).filter((i: Incident) => i.status !== 'RESOLVED');
  const critical = m.openBySeverity['SEV-1'] ?? 0;
  const queueDepth = (q ?? []).reduce((a: number, x: QueueStat) => a + x.waiting, 0);
  const activeWorkers = (w ?? []).filter((x: WorkerStat) => x.status === 'RUNNING').length;
  const totalWorkers = (w ?? []).length;
  const healthySvcs = svcs.filter((s) => s.status === 'HEALTHY').length;

  return (
    <>
      <PageHeader title="Overview" subtitle="Real-time operational health across services, incidents and the event pipeline." />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard label="Active Incidents" value={fmtNum(m.activeIncidents)} sub={`${critical} critical · SEV-1`} />
        <StatCard label="Total Events Processed" value={fmtNum(m.totalEvents)} sub={`${fmtNum(m.eventsPerMinute)}/min · ${fmtNum(m.eventsLast24h)} in 24h`} />
        <StatCard label="Critical Incidents" value={fmtNum(critical)} sub={`of ${fmtNum(m.activeIncidents)} active`} />
        <StatCard label="Service Availability" value={`${m.serviceAvailability.toFixed(1)}%`} sub={`${healthySvcs}/${svcs.length} healthy`} />
        <StatCard label="Queue Depth" value={fmtNum(queueDepth)} sub={`${((q ?? []).length)} queues`} />
        <StatCard label="Active Workers" value={`${activeWorkers}/${totalWorkers}`} sub="event · escalation · health · notify · metrics" />
        <StatCard label="System Uptime" value={fmtDurationHms(h.process.uptimeSeconds)} sub={`API · ${h.process.nodeVersion}`} />
        <StatCard label="Avg API Latency" value={`${m.apiLatencyMs.toFixed(1)} ms`} sub="rolling (measured)" />
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Active Incidents" action={<a className="pill-link" href="/incidents">View all</a>}>
            <IncidentTable incidents={activeIncidents.slice(0, 8)} />
          </Card>
          <Card title="Recent Event Stream" action={<a className="pill-link" href="/events">View all</a>}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Time</th><th>Type</th><th>Service</th><th>Sev</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {(ev.data ?? []).map((e: EventItem) => (
                    <tr key={e.id}>
                      <td className="faint">{relativeTime(e.timestamp)}</td>
                      <td className="mono">{e.eventType}</td>
                      <td>{e.serviceName ?? e.serviceId}</td>
                      <td><span className={`badge ${severityClass(e.severity)}`}>{e.severity}</span></td>
                      <td>{e.incidentId ? <BadgeOk>Processed</BadgeOk> : <BadgeMuted>Received</BadgeMuted>}</td>
                    </tr>
                  ))}
                  {(ev.data ?? []).length === 0 && <tr><td colSpan={5}><Empty>No events yet.</Empty></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Service Health">
            <div className="grid grid-2" style={{ gap: 10 }}>
              {svcs.map((s: Service) => {
                const hc = healthMap[s.id]?.lastCheck;
                return (
                  <div key={s.id} className="card" style={{ padding: 12, border: '1px solid var(--border)' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <a className="pill-link" href={`/services/${s.id}`} style={{ fontWeight: 600 }}>{s.name}</a>
                      <span className={`badge ${statusClass(s.status)}`}>{s.status}</span>
                    </div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                      {s.criticality} · {hc ? `latency ${hc.latencyMs ?? '—'}ms` : 'no probe'}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                      last check {relativeTime(hc?.checkedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Queue Health">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Queue</th><th>Waiting</th><th>Processing</th><th>Completed</th><th>Failed</th><th>/min</th></tr></thead>
                <tbody>
                  {(q ?? []).map((x: QueueStat) => (
                    <tr key={x.name}>
                      <td className="mono">{x.name}</td>
                      <td>{x.waiting}</td>
                      <td>{x.processing}</td>
                      <td>{fmtNum(x.completed)}</td>
                      <td style={{ color: x.failed ? 'var(--danger)' : undefined }}>{x.failed}</td>
                      <td>{x.ratePerMin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="System Components">
            <div className="kv">
              {h.components.map((c: HealthComponent) => (
                <div key={c.name} style={{ display: 'contents' }}>
                  <dt className="row"><span className={`dot ${statusDot(c.status)}`} /> {c.name}</dt>
                  <dd>
                    <span className={`badge ${c.status === 'UP' ? 'badge--ok' : c.status === 'DOWN' ? 'badge--danger' : 'badge--warn'}`}>{c.status}</span>{' '}
                    <span className="faint">{c.latencyMs ? `${Math.round(c.latencyMs)}ms` : ''}</span>
                  </dd>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function IncidentTable({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) return <Empty>No active incidents. All clear.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>ID</th><th>Title</th><th>Service</th><th>Severity</th><th>Status</th><th>Level</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.incidentId} style={{ cursor: 'pointer' }} onClick={() => (location.href = `/incidents/${i.incidentId}`)}>
              <td className="mono faint">{i.incidentId.slice(0, 8)}</td>
              <td>{i.title}</td>
              <td className="faint">{i.serviceId}</td>
              <td><SeverityBadge severity={i.severity} /></td>
              <td><StatusBadge status={i.status} /></td>
              <td>L{i.escalationLevel}</td>
              <td className="faint">{relativeTime(i.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BadgeOk({ children }: { children: React.ReactNode }) {
  return <span className="badge badge--ok">{children}</span>;
}
function BadgeMuted({ children }: { children: React.ReactNode }) {
  return <span className="badge badge--muted">{children}</span>;
}

function fmtDurationHms(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
