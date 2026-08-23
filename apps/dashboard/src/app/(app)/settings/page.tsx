'use client';

import { useState, useEffect } from 'react';
import { useFetch } from '../../../lib/useFetch';
import { fetchMe, fetchApiKeys, createApiKey, revokeApiKey, ApiKey, Service } from '../../../lib/api';
import { fetchServices } from '../../../lib/api';
import { Card, Spinner, ErrorState, PageHeader, StatusBadge } from '../../../components/ui';
import { relativeTime, shortId } from '../../../lib/format';

type Theme = 'dark' | 'light';

export default function SettingsPage() {
  const me = useFetch(() => fetchMe(), []);
  const [theme, setTheme] = useState<Theme>('dark');
  const services = useFetch(() => fetchServices(''), []);

  useEffect(() => {
    const t = (localStorage.getItem('opsmesh-theme') as Theme) || 'dark';
    setTheme(t);
  }, []);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('opsmesh-theme', t);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, appearance and access keys." />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Profile">
          {me.loading && !me.data ? <Spinner /> : me.error ? <ErrorState error={me.error} /> : (
            <div className="kv">
              <dt>Email</dt><dd>{me.data?.email}</dd>
              <dt>Role</dt><dd><StatusBadge status={me.data?.role === 'ADMIN' ? 'HEALTHY' : me.data?.role === 'ENGINEER' ? 'INVESTIGATING' : 'OPEN'} /> {me.data?.role}</dd>
              <dt>User ID</dt><dd className="mono faint">{shortId(me.data?.id)}</dd>
            </div>
          )}
        </Card>

        <Card title="Appearance">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Choose the dashboard theme. Preference is stored in your browser.</p>
          <div className="seg">
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => applyTheme('dark')}>Dark</button>
            <button className={theme === 'light' ? 'active' : ''} onClick={() => applyTheme('light')}>Light</button>
          </div>
        </Card>

        <Card title="API Keys" action={<span className="faint" style={{ fontSize: 11.5 }}>admin only</span>}>
          <ApiKeys services={services.data ?? []} />
        </Card>
      </div>
    </>
  );
}

function ApiKeys({ services }: { services: Service[] }) {
  const keys = useFetch(() => fetchApiKeys(), []);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [purpose, setPurpose] = useState('event_ingest');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (keys.error && keys.error.includes('403')) {
    return <div className="faint">API key management is restricted to administrators.</div>;
  }
  if (keys.loading && !keys.data) return <Spinner />;

  const create = async () => {
    setErr(null);
    try {
      const r = await createApiKey({ name: name || 'key', subject, purpose });
      setPlaintext(r.plaintext);
      setName('');
      keys.reload();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      keys.reload();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {err && <div className="error-box">{err}</div>}
      {plaintext && (
        <div className="error-box" style={{ borderColor: 'var(--brand)', background: 'var(--brand-weak)', color: 'var(--brand)' }}>
          New key (copy now): <span className="mono">{plaintext}</span>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="input" placeholder="Key name" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 130 }} />
        <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Service…</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" value={purpose} onChange={(e) => setPurpose(e.target.value)} style={{ minWidth: 130 }}>
          <option value="event_ingest">event_ingest</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn btn--sm btn--primary" disabled={!subject} onClick={create}>Create</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Service</th><th>Purpose</th><th>Created</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(keys.data ?? []).map((k: ApiKey) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono faint">{shortId(k.subject)}</td>
                <td>{k.purpose}</td>
                <td className="faint">{relativeTime(k.created_at)}</td>
                <td>{k.revoked_at ? <span className="badge badge--muted">revoked</span> : <span className="badge badge--ok">active</span>}</td>
                <td>{!k.revoked_at && <button className="btn btn--sm btn--danger" onClick={() => revoke(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
            {(keys.data ?? []).length === 0 && <tr><td colSpan={6}><div className="empty">No API keys.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
