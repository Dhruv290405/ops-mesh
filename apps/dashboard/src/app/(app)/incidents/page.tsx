'use client';

import { useState, useMemo } from 'react';
import { useFetch } from '../../../lib/useFetch';
import { useRealtime } from '../../../lib/socket';
import { fetchIncidents, fetchServices, fetchUsers, Incident, Service, User } from '../../../lib/api';
import { Card, StatusBadge, SeverityBadge, Spinner, ErrorState, Empty, PageHeader } from '../../../components/ui';
import { relativeTime, shortId } from '../../../lib/format';

const SEVERITIES = ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'];
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'MITIGATED', 'RESOLVED'];

export default function IncidentsPage() {
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [service, setService] = useState('');
  const [search, setSearch] = useState('');

  const q = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '100');
    if (severity) p.set('severity', severity);
    if (status) p.set('status', status);
    if (service) p.set('serviceId', service);
    if (search) p.set('search', search);
    return '?' + p.toString();
  }, [severity, status, service, search]);

  const incidents = useFetch(() => fetchIncidents(q), [q]);
  const services = useFetch(() => fetchServices(''), []);
  const users = useFetch(() => fetchUsers(), []);

  useRealtime('incident.created', incidents.reload);
  useRealtime('incident.updated', incidents.reload);

  const svcMap = useMemo(() => Object.fromEntries((services.data ?? []).map((s: Service) => [s.id, s.name])), [services.data]);
  const userMap = useMemo(() => Object.fromEntries((users.data ?? []).map((u: User) => [u.id, u.name])), [users.data]);

  const data: Incident[] = incidents.data?.data ?? [];

  return (
    <>
      <PageHeader title="Incidents" subtitle={`${data.length} shown`} />

      <div className="toolbar">
        <input className="input" placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>
          {(services.data ?? []).map((s: Service) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={() => { setSeverity(''); setStatus(''); setService(''); setSearch(''); }}>Clear</button>
      </div>

      <Card>
        {incidents.loading && !incidents.data ? <Spinner /> : incidents.error ? <ErrorState error={incidents.error} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th><th>Title</th><th>Service</th><th>Severity</th><th>Status</th>
                  <th>Assignee</th><th>Level</th><th>Created</th><th>Updated</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.incidentId} style={{ cursor: 'pointer' }} onClick={() => (location.href = `/incidents/${i.incidentId}`)}>
                    <td className="mono faint">{shortId(i.incidentId)}</td>
                    <td>{i.title}</td>
                    <td>{svcMap[i.serviceId] ?? shortId(i.serviceId)}</td>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td><StatusBadge status={i.status} /></td>
                    <td>{i.assignedEngineerId ? (userMap[i.assignedEngineerId] ?? shortId(i.assignedEngineerId)) : <span className="faint">—</span>}</td>
                    <td>L{i.escalationLevel}</td>
                    <td className="faint">{relativeTime(i.createdAt)}</td>
                    <td className="faint">{relativeTime(i.updatedAt)}</td>
                    <td><span className="pill-link">Open →</span></td>
                  </tr>
                ))}
                {data.length === 0 && <tr><td colSpan={10}><Empty>No incidents match your filters.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
