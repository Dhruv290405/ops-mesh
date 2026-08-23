'use client';

import { useMemo } from 'react';
import { useFetch } from '../../../lib/useFetch';
import { useRealtime } from '../../../lib/socket';
import { fetchServices, fetchServiceHealth, fetchIncidents, Service, ServiceHealth, Incident } from '../../../lib/api';
import { Card, StatusBadge, Spinner, ErrorState, Empty, PageHeader } from '../../../components/ui';
import { relativeTime, shortId, statusClass } from '../../../lib/format';

export default function ServicesPage() {
  const services = useFetch(() => fetchServices(''), []);
  const healthMap = useFetch(async () => {
    const svcs = await fetchServices('');
    const h = await Promise.all(svcs.map((s) => fetchServiceHealth(s.id).then((x) => [s.id, x] as const).catch(() => [s.id, null] as const)));
    return Object.fromEntries(h) as Record<string, ServiceHealth | null>;
  }, []);
  const incidents = useFetch(() => fetchIncidents('?limit=500'), []);

  useRealtime('service.health', healthMap.reload);
  useRealtime('incident.created', () => { incidents.reload(); });
  useRealtime('incident.updated', () => { incidents.reload(); });

  const openByService = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of (incidents.data?.data ?? []) as Incident[]) {
      if (i.status !== 'RESOLVED') m[i.serviceId] = (m[i.serviceId] ?? 0) + 1;
    }
    return m;
  }, [incidents.data]);

  const svcs = services.data ?? [];

  return (
    <>
      <PageHeader title="Services" subtitle={`${svcs.length} monitored services`} />

      <Card>
        {services.loading && !services.data ? <Spinner /> : services.error ? <ErrorState error={services.error} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Service</th><th>Status</th><th>Criticality</th><th>Env</th><th>Latency</th><th>Last heartbeat</th><th>Open incidents</th><th></th></tr>
              </thead>
              <tbody>
                {svcs.map((s: Service) => {
                  const hc = healthMap.data?.[s.id]?.lastCheck;
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => (location.href = `/services/${s.id}`)}>
                      <td><a className="pill-link" href={`/services/${s.id}`}>{s.name}</a><div className="faint" style={{ fontSize: 11.5 }}>{s.description}</div></td>
                      <td><span className={`badge ${statusClass(s.status)}`}>{s.status}</span></td>
                      <td>{s.criticality}</td>
                      <td className="faint">{s.environment}</td>
                      <td>{hc ? `${hc.latencyMs ?? '—'} ms` : '—'}</td>
                      <td className="faint">{relativeTime(hc?.checkedAt)}</td>
                      <td>{openByService[s.id] ?? 0}</td>
                      <td><span className="pill-link">View →</span></td>
                    </tr>
                  );
                })}
                {svcs.length === 0 && <tr><td colSpan={8}><Empty>No services registered.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
