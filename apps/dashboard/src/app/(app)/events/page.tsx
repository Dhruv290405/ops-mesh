'use client';

import { useState, useMemo } from 'react';
import { useFetch } from '../../../lib/useFetch';
import { useRealtime } from '../../../lib/socket';
import { fetchEvents, fetchServices, EventItem, Service } from '../../../lib/api';
import { Card, Spinner, ErrorState, Empty, PageHeader } from '../../../components/ui';
import { relativeTime, shortId, severityClass } from '../../../lib/format';

export default function EventsPage() {
  const [severity, setSeverity] = useState('');
  const [service, setService] = useState('');
  const [search, setSearch] = useState('');

  const q = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '100');
    if (severity) p.set('severity', severity);
    if (service) p.set('serviceId', service);
    if (search) p.set('search', search);
    return '?' + p.toString();
  }, [severity, service, search]);

  const events = useFetch(() => fetchEvents(q), [q]);
  const services = useFetch(() => fetchServices(''), []);

  useRealtime('event.ingested', events.reload);
  useRealtime('incident.created', events.reload);
  useRealtime('incident.updated', events.reload);

  const data: EventItem[] = events.data?.data ?? [];

  return (
    <>
      <PageHeader title="Events" subtitle="Live event stream from the ingestion pipeline." />

      <div className="toolbar">
        <input className="input" placeholder="Search message…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>
          {(services.data ?? []).map((s: Service) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="spacer" />
        <span className="conn"><span className="dot dot--ok" /> Live stream</span>
      </div>

      <Card>
        {events.loading && !events.data ? <Spinner /> : events.error ? <ErrorState error={events.error} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Event ID</th><th>Type</th><th>Source service</th><th>Timestamp</th><th>Severity</th><th>Processing</th><th>Correlation ID</th></tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td className="mono faint">{shortId(e.id)}</td>
                    <td className="mono">{e.eventType}</td>
                    <td>{e.serviceName ?? e.serviceId}</td>
                    <td className="faint">{relativeTime(e.timestamp)}</td>
                    <td><span className={`badge ${severityClass(e.severity)}`}>{e.severity}</span></td>
                    <td>{e.incidentId ? <span className="badge badge--ok">Processed</span> : <span className="badge badge--muted">Received</span>}</td>
                    <td className="mono faint">{e.requestId ? shortId(e.requestId) : '—'}</td>
                  </tr>
                ))}
                {data.length === 0 && <tr><td colSpan={7}><Empty>No events match your filters.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
