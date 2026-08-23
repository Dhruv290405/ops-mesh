'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch } from '../../../../lib/useFetch';
import { useRealtime } from '../../../../lib/socket';
import { fetchIncident, fetchUsers, incidentActions, IncidentDetail, User } from '../../../../lib/api';
import { Card, StatusBadge, SeverityBadge, Spinner, ErrorState, Empty, PageHeader, Dot } from '../../../../components/ui';
import { relativeTime, formatDateTime, shortId, statusDot } from '../../../../lib/format';

export default function IncidentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const { data, loading, error, reload } = useFetch(() => fetchIncident(id), [id]);
  const users = useFetch(() => fetchUsers(), []);

  useRealtime('incident.updated', (p: any) => {
    if (p?.incidentId === id) reload();
  });

  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Empty>Incident not found.</Empty>;

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setActionErr(null);
    try {
      await fn();
      reload();
    } catch (e: any) {
      setActionErr(e?.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const inc = data.incident;
  const resolved = inc.status === 'RESOLVED';
  const open = inc.status !== 'RESOLVED';

  return (
    <>
      <PageHeader
        title={inc.title}
        subtitle={`${shortId(inc.incidentId)} · ${inc.priority}`}
        action={<StatusBadge status={inc.status} />}
      />

      {actionErr && <div className="error-box">{actionErr}</div>}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Details">
            <div className="kv">
              <dt>Severity</dt><dd><SeverityBadge severity={inc.severity} /></dd>
              <dt>Status</dt><dd><StatusBadge status={inc.status} /></dd>
              <dt>Service</dt><dd>{data.service ? <a className="pill-link" href={`/services/${data.service.id}`}>{data.service.name}</a> : '—'}</dd>
              <dt>Assigned engineer</dt><dd>{data.assignedEngineer ? `${data.assignedEngineer.name} (${data.assignedEngineer.email})` : <span className="faint">Unassigned</span>}</dd>
              <dt>Escalation level</dt><dd>L{inc.escalationLevel}</dd>
              <dt>Created</dt><dd>{formatDateTime(inc.createdAt)}</dd>
              <dt>Updated</dt><dd>{formatDateTime(inc.updatedAt)}</dd>
              <dt>Events</dt><dd>{inc.eventCount}</dd>
              <dt>Acknowledged</dt><dd>{inc.acknowledgedAt ? formatDateTime(inc.acknowledgedAt) : '—'}</dd>
              <dt>Resolved</dt><dd>{inc.resolvedAt ? formatDateTime(inc.resolvedAt) : '—'}</dd>
            </div>
          </Card>

          <Card title="Timeline">
            {data.timeline.length === 0 ? <Empty>No timeline entries yet.</Empty> : (
              <div className="timeline">
                {[...data.timeline].reverse().map((t) => (
                  <div className="tl-item" key={t.id}>
                    <div className="tl-item__t">{t.type}{t.actorName ? ` · ${t.actorName}` : ''}</div>
                    <div className="tl-item__m">{t.message}</div>
                    <div className="tl-item__time">{formatDateTime(t.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Linked Events">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
                <tbody>
                  {(data.events ?? []).map((e: any, idx: number) => (
                    <tr key={e.id ?? idx}>
                      <td className="faint">{relativeTime(e.timestamp)}</td>
                      <td className="mono">{e.event_type}</td>
                      <td><span className={`badge ${e.severity === 'CRITICAL' ? 'badge--sev1' : e.severity === 'HIGH' ? 'badge--sev2' : e.severity === 'MEDIUM' ? 'badge--sev3' : 'badge--sev4'}`}>{e.severity}</span></td>
                      <td className="muted">{e.message}</td>
                    </tr>
                  ))}
                  {(data.events ?? []).length === 0 && <tr><td colSpan={4}><Empty>No linked events.</Empty></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Actions">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {open && inc.status === 'OPEN' && (
                <button className="btn btn--sm" disabled={busy === 'ack'} onClick={() => run('ack', () => incidentActions.acknowledge(id))}>Acknowledge</button>
              )}
              {open && (
                <button className="btn btn--sm" disabled={busy === 'esc'} onClick={() => run('esc', () => incidentActions.setStatus(id, 'ESCALATED'))}>Escalate</button>
              )}
              {open && (
                <button className="btn btn--sm btn--primary" disabled={busy === 'res'} onClick={() => run('res', () => incidentActions.setStatus(id, 'RESOLVED', 'Resolved via dashboard', 'Resolved by operator'))}>Resolve</button>
              )}
              {resolved && (
                <button className="btn btn--sm" disabled={busy === 'reopen'} onClick={() => run('reopen', () => incidentActions.reopen(id))}>Reopen</button>
              )}
            </div>

            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="field">
                <label>Assign engineer</label>
                <div className="row">
                  <select className="select" id="assignUser" defaultValue="">
                    <option value="">Select engineer…</option>
                    {(users.data ?? []).filter((u: User) => u.role !== 'VIEWER').map((u: User) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                  <button className="btn btn--sm" disabled={busy === 'assign'} onClick={() => {
                    const el = document.getElementById('assignUser') as HTMLSelectElement;
                    if (el?.value) run('assign', () => incidentActions.assign(id, el.value));
                  }}>Assign</button>
                </div>
              </div>

              <div className="field">
                <label>Change severity</label>
                <div className="row">
                  <select className="select" id="sev" defaultValue={inc.severity}>
                    {['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button className="btn btn--sm" disabled={busy === 'sev'} onClick={() => {
                    const el = document.getElementById('sev') as HTMLSelectElement;
                    run('sev', () => incidentActions.severity(id, el.value));
                  }}>Update</button>
                </div>
              </div>

              <div className="field">
                <label>Add comment</label>
                <textarea id="comment" className="input" rows={2} placeholder="Add a note to the timeline…" />
                <button className="btn btn--sm" disabled={busy === 'comment'} onClick={() => {
                  const el = document.getElementById('comment') as HTMLTextAreaElement;
                  if (el.value.trim()) run('comment', () => incidentActions.comment(id, el.value.trim()).then(() => { el.value = ''; }));
                }}>Comment</button>
              </div>
            </div>
          </Card>

          <Card title="Escalations">
            {(data.escalations ?? []).length === 0 ? <Empty>No escalations.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Level</th><th>Target</th><th>Reason</th><th>Triggered</th><th>ACK</th></tr></thead>
                  <tbody>
                    {(data.escalations ?? []).map((e: any, idx: number) => (
                      <tr key={idx}>
                        <td>L{e.step_level}</td>
                        <td>{e.target_name}</td>
                        <td className="muted">{e.reason}</td>
                        <td className="faint">{relativeTime(e.triggered_at)}</td>
                        <td>{e.acknowledged ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Notifications">
            {(data.notifications ?? []).length === 0 ? <Empty>No notifications sent.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Channel</th><th>Recipient</th><th>Status</th><th>Attempts</th></tr></thead>
                  <tbody>
                    {(data.notifications ?? []).map((n: any, idx: number) => (
                      <tr key={idx}>
                        <td>{n.channel}</td>
                        <td className="muted">{n.recipient}</td>
                        <td><span className={`badge ${n.status === 'SENT' ? 'badge--ok' : n.status === 'FAILED' ? 'badge--danger' : 'badge--warn'}`}>{n.status}</span></td>
                        <td>{n.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
