'use client';

import { useEffect } from 'react';
import { useFetch } from '../../../lib/useFetch';
import { useRealtime } from '../../../lib/socket';
import { fetchQueues, fetchWorkers, QueueStat, WorkerStat } from '../../../lib/api';
import { Card, Spinner, ErrorState, Empty, PageHeader, Bar } from '../../../components/ui';
import { relativeTime, fmtNum } from '../../../lib/format';

export default function QueuesPage() {
  const queues = useFetch(() => fetchQueues(), []);
  const workers = useFetch(() => fetchWorkers(), []);

  useRealtime('metrics.refresh', () => { queues.reload(); workers.reload(); });
  useEffect(() => {
    const t = setInterval(() => { queues.reload(); workers.reload(); }, 5000);
    return () => clearInterval(t);
  }, [queues, workers]);

  const maxCompleted = Math.max(1, ...(queues.data ?? []).map((q: QueueStat) => q.completed));

  return (
    <>
      <PageHeader title="Queues & Workers" subtitle="Asynchronous processing pipeline — queues, workers and throughput." />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Queue Health">
          {queues.loading && !queues.data ? <Spinner /> : queues.error ? <ErrorState error={queues.error} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Queue</th><th>Waiting</th><th>Processing</th><th>Completed</th><th>Failed</th><th>/min</th><th>Throughput</th></tr></thead>
                <tbody>
                  {(queues.data ?? []).map((x: QueueStat) => (
                    <tr key={x.name}>
                      <td className="mono">{x.name}</td>
                      <td style={{ color: x.waiting ? 'var(--warn)' : undefined }}>{x.waiting}</td>
                      <td>{x.processing}</td>
                      <td>{fmtNum(x.completed)}</td>
                      <td style={{ color: x.failed ? 'var(--danger)' : undefined }}>{x.failed}</td>
                      <td>{x.ratePerMin}</td>
                      <td style={{ width: 120 }}><Bar value={x.completed} max={maxCompleted} /></td>
                    </tr>
                  ))}
                  {(queues.data ?? []).length === 0 && <tr><td colSpan={7}><Empty>No queue data.</Empty></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Workers">
          {workers.loading && !workers.data ? <Spinner /> : workers.error ? <ErrorState error={workers.error} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Worker</th><th>Type</th><th>Status</th><th>Current job</th><th>Jobs</th><th>Failed</th><th>Heartbeat</th></tr></thead>
                <tbody>
                  {(workers.data ?? []).map((w: WorkerStat) => (
                    <tr key={w.workerId}>
                      <td className="mono">{shortIdWorker(w.workerId)}</td>
                      <td>{w.workerType}</td>
                      <td>
                        <span className={`badge ${w.status === 'RUNNING' ? 'badge--ok' : w.status === 'FAILED' ? 'badge--danger' : 'badge--warn'}`}>{w.status}</span>
                      </td>
                      <td className="muted">{w.currentJob ?? '—'}</td>
                      <td>{fmtNum(w.jobsProcessed)}</td>
                      <td style={{ color: w.failedJobs ? 'var(--danger)' : undefined }}>{w.failedJobs}</td>
                      <td className="faint">{relativeTime(w.lastHeartbeat)}</td>
                    </tr>
                  ))}
                  {(workers.data ?? []).length === 0 && <tr><td colSpan={7}><Empty>No worker data. Worker may be offline.</Empty></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function shortIdWorker(id: string): string {
  return id.length > 14 ? id.slice(0, 12) : id;
}
