import { query } from '../../common/db';

export interface WorkerStat {
  workerId: string;
  workerType: string;
  status: string;
  jobsProcessed: number;
  failedJobs: number;
  currentJob: string | null;
  lastHeartbeat: string;
  startedAt: string;
}

export interface QueueStat {
  name: string;
  waiting: number;
  processing: number;
  completed: number;
  failed: number;
  ratePerMin: number;
}

export const KNOWN_QUEUES = [
  'ingest',
  'realtime',
  'notifications',
  'escalation',
  'health',
  'metrics'
];

export async function listWorkers(): Promise<WorkerStat[]> {
  const res = await query(
    `SELECT worker_id, worker_type, status, jobs_processed, failed_jobs, current_job,
            last_heartbeat, started_at
     FROM worker_stats ORDER BY worker_type ASC`
  );
  return res.rows.map((r: any) => ({
    workerId: r.worker_id,
    workerType: r.worker_type,
    status: r.status,
    jobsProcessed: Number(r.jobs_processed),
    failedJobs: Number(r.failed_jobs),
    currentJob: r.current_job,
    lastHeartbeat: new Date(r.last_heartbeat).toISOString(),
    startedAt: new Date(r.started_at).toISOString()
  }));
}

export async function listQueues(): Promise<QueueStat[]> {
  const res = await query(
    `SELECT queue_name, published, processing, completed, failed, completed_60s FROM queue_stats`
  );
  const map = new Map(res.rows.map((r: any) => [r.queue_name, r]));

  return KNOWN_QUEUES.map((name) => {
    const row = map.get(name);
    const published = Number(row?.published ?? 0);
    const processing = Number(row?.processing ?? 0);
    const completed = Number(row?.completed ?? 0);
    const failed = Number(row?.failed ?? 0);
    const waiting = Math.max(0, published - completed - failed - processing);
    return {
      name,
      waiting,
      processing,
      completed,
      failed,
      ratePerMin: Number(row?.completed_60s ?? 0)
    };
  });
}
