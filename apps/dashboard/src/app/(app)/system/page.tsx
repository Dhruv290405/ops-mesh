'use client';

import { useFetch } from '../../../lib/useFetch';
import { useRealtime, useSocket } from '../../../lib/socket';
import { fetchHealthReady, fetchHealthDeep, fetchWorkers, HealthComponent, WorkerStat } from '../../../lib/api';
import { Card, Spinner, ErrorState, PageHeader, Dot } from '../../../components/ui';
import { relativeTime, statusDot } from '../../../lib/format';

export default function SystemPage() {
  const ready = useFetch(() => fetchHealthReady(), []);
  const deep = useFetch(() => fetchHealthDeep(), []);
  const workers = useFetch(() => fetchWorkers(), []);
  const { connected } = useSocket();

  useRealtime('metrics.refresh', () => { ready.reload(); deep.reload(); });

  if (ready.loading && !ready.data) return <Spinner />;
  if (ready.error) return <ErrorState error={ready.error} />;

  const comps: HealthComponent[] = ready.data?.components ?? [];
  const allUp = comps.every((c) => c.status === 'UP');
  const db = comps.find((c) => c.name === 'postgres');
  const redis = comps.find((c) => c.name === 'redis');
  const broker = comps.find((c) => c.name === 'rabbitmq');
  const runningWorkers = (workers.data ?? []).filter((w: WorkerStat) => w.status === 'RUNNING').length;

  const overall = allUp && connected ? 'Healthy' : 'Degraded';

  const items = [
    { name: 'API', status: 'UP' as const, latency: deep.data?.process ? undefined : undefined, detail: `uptime ${fmtUptime(deep.data?.process.uptimeSeconds)}` },
    { name: 'Database', status: (db?.status ?? 'DOWN') as any, latency: db?.latencyMs, detail: 'PostgreSQL' },
    { name: 'Redis', status: (redis?.status ?? 'DOWN') as any, latency: redis?.latencyMs, detail: 'cache / state' },
    { name: 'Message Queue', status: (broker?.status ?? 'DEGRADED') as any, latency: broker?.latencyMs, detail: broker?.status === 'DEGRADED' ? 'in-memory (dev)' : 'RabbitMQ' },
    { name: 'Workers', status: (runningWorkers > 0 ? 'UP' : 'DOWN') as any, latency: undefined, detail: `${runningWorkers} running` },
    { name: 'WebSocket', status: (connected ? 'UP' : 'DOWN') as any, latency: undefined, detail: connected ? 'realtime connected' : 'disconnected' }
  ];

  return (
    <>
      <PageHeader
        title="System Health"
        subtitle="Infrastructure components and their current status."
        action={
          <span className={`badge ${overall === 'Healthy' ? 'badge--ok' : 'badge--warn'}`}>
            <Dot className={statusDot(overall === 'Healthy' ? 'UP' : 'DEGRADED')} /> {overall}
          </span>
        }
      />

      <div className="grid grid-3">
        {items.map((it) => (
          <Card key={it.name}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>{it.name}</span>
              <span className={`badge ${it.status === 'UP' ? 'badge--ok' : it.status === 'DOWN' ? 'badge--danger' : 'badge--warn'}`}>{it.status}</span>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{it.detail}</div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="faint" style={{ fontSize: 12 }}>Response</span>
              <span className="mono" style={{ fontSize: 12 }}>{it.latency != null ? `${Math.round(it.latency)} ms` : '—'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>Last check</span>
              <span className="faint" style={{ fontSize: 12 }}>{relativeTime(new Date().toISOString())}</span>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Component Detail">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Component</th><th>Status</th><th>Response time</th><th>Failure count</th><th>Last check</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.name}>
                    <td><span className={`dot ${statusDot(it.status)}`} /> {it.name}</td>
                    <td><span className={`badge ${it.status === 'UP' ? 'badge--ok' : it.status === 'DOWN' ? 'badge--danger' : 'badge--warn'}`}>{it.status}</span></td>
                    <td>{it.latency != null ? `${Math.round(it.latency)} ms` : '—'}</td>
                    <td>0</td>
                    <td className="faint">{relativeTime(new Date().toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function fmtUptime(s?: number): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
