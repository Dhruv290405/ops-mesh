'use client';

import { useParams } from 'next/navigation';
import { useFetch } from '../../../../lib/useFetch';
import { useRealtime } from '../../../../lib/socket';
import { fetchService, fetchServiceHealth, fetchServiceIncidents, Service, ServiceHealth } from '../../../../lib/api';
import { Card, StatusBadge, Spinner, ErrorState, Empty, PageHeader, Bar } from '../../../../components/ui';
import { relativeTime, formatDateTime, shortId, statusClass } from '../../../../lib/format';

export default function ServiceDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const svc = useFetch(() => fetchService(id), [id]);
  const health = useFetch(() => fetchServiceHealth(id), [id]);
  const incidents = useFetch(() => fetchServiceIncidents(id), [id]);

  useRealtime('service.health', (p: any) => {
    if (p?.serviceId === id) health.reload();
  });

  if (svc.loading && !svc.data) return <Spinner />;
  if (svc.error) return <ErrorState error={svc.error} />;
  if (!svc.data) return <Empty>Service not found.</Empty>;

  const s: Service = svc.data;
  const h: ServiceHealth | null = health.data ?? null;
  const hc = h?.lastCheck;

  return (
    <>
      <PageHeader title={s.name} subtitle={s.description ?? ''} action={<StatusBadge status={s.status} />} />

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Card title="Health"><div className="kv">
          <dt>Status</dt><dd><span className={`badge ${statusClass(s.status)}`}>{s.status}</span></dd>
          <dt>Latency</dt><dd>{hc ? `${hc.latencyMs ?? '—'} ms` : '—'}</dd>
          <dt>Last check</dt><dd>{formatDateTime(hc?.checkedAt)}</dd>
          <dt>Expected</dt><dd>{hc?.statusCode ?? '—'}</dd>
        </div></Card>
        <Card title="Profile"><div className="kv">
          <dt>Criticality</dt><dd>{s.criticality}</dd>
          <dt>Environment</dt><dd>{s.environment}</dd>
          <dt>SLA</dt><dd>{s.slaMinutes ? `${s.slaMinutes} min` : '—'}</dd>
          <dt>Owner team</dt><dd className="mono faint">{shortId(s.ownerTeamId)}</dd>
        </div></Card>
        <Card title="Reliability">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Recent error sample</div>
          {hc?.error ? <div className="error-box">{hc.error}</div> : <div className="faint">No recent errors.</div>}
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="faint" style={{ fontSize: 12 }}>Health</span><span className="badge badge--ok">{s.status}</span></div>
            <div style={{ marginTop: 6 }}><Bar value={s.status === 'HEALTHY' ? 100 : s.status === 'DEGRADED' ? 60 : 20} /></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Recent Incidents">
          {(incidents.data ?? []).length === 0 ? <Empty>No incidents for this service.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Resolved</th></tr></thead>
                <tbody>
                  {(incidents.data ?? []).map((i: any) => (
                    <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => (location.href = `/incidents/${i.id}`)}>
                      <td className="mono faint">{shortId(i.id)}</td>
                      <td>{i.title}</td>
                      <td><span className={`badge ${i.severity === 'SEV-1' ? 'badge--sev1' : i.severity === 'SEV-2' ? 'badge--sev2' : i.severity === 'SEV-3' ? 'badge--sev3' : 'badge--sev4'}`}>{i.severity}</span></td>
                      <td><StatusBadge status={i.status} /></td>
                      <td className="faint">{i.resolved_at ? relativeTime(i.resolved_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent Events">
          {(h?.recentEvents ?? []).length === 0 ? <Empty>No recent events.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
                <tbody>
                  {(h?.recentEvents ?? []).map((e: any, idx: number) => (
                    <tr key={idx}>
                      <td className="faint">{relativeTime(e.timestamp)}</td>
                      <td className="mono">{e.event_type}</td>
                      <td><span className={`badge ${e.severity === 'CRITICAL' ? 'badge--sev1' : e.severity === 'HIGH' ? 'badge--sev2' : e.severity === 'MEDIUM' ? 'badge--sev3' : 'badge--sev4'}`}>{e.severity}</span></td>
                      <td className="muted">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
