import { query } from './db';
import { logger } from './logger';

/**
 * Worker + queue observability. The API and worker are separate processes and,
 * in local dev, each has its own in-memory Redis - so stats are written to
 * Postgres (which both share) and read by the API's /system endpoints.
 */
export const WORKER_IDS: { id: string; type: string }[] = [
  { id: 'event-processor', type: 'event-processor' },
  { id: 'escalation', type: 'escalation' },
  { id: 'health-check', type: 'health-check' },
  { id: 'notification', type: 'notification' },
  { id: 'metrics', type: 'metrics' }
];

export async function registerWorker(id: string, type: string): Promise<void> {
  try {
    await query(
      `INSERT INTO worker_stats (worker_id, worker_type, status, jobs_processed, failed_jobs, last_heartbeat, started_at)
       VALUES ($1,$2,'RUNNING',0,0,now(),now())
       ON CONFLICT (worker_id) DO UPDATE SET status='RUNNING', last_heartbeat=now(), worker_type=EXCLUDED.worker_type`,
      [id, type]
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'registerWorker failed');
  }
}

export async function heartbeatAll(ids: string[]): Promise<void> {
  try {
    for (const id of ids) {
      await query(`UPDATE worker_stats SET status='RUNNING', last_heartbeat=now() WHERE worker_id=$1`, [id]);
    }
  } catch {
    /* best-effort */
  }
}

export async function recordJobStart(id: string, queue: string): Promise<void> {
  try {
    await query(`UPDATE worker_stats SET current_job=$2, last_heartbeat=now() WHERE worker_id=$1`, [id, queue]);
    await query(
      `INSERT INTO queue_stats (queue_name, processing) VALUES ($1,1)
       ON CONFLICT (queue_name) DO UPDATE SET processing = queue_stats.processing + 1, updated_at=now()`,
      [queue]
    );
  } catch {
    /* best-effort */
  }
}

export async function recordJobDone(id: string, queue: string): Promise<void> {
  try {
    await query(
      `UPDATE worker_stats SET jobs_processed = jobs_processed + 1, current_job=NULL, last_heartbeat=now() WHERE worker_id=$1`,
      [id]
    );
    await query(
      `UPDATE queue_stats SET
        completed = completed + 1,
        processing = GREATEST(0, processing - 1),
        completed_60s = CASE WHEN rate_reset_at < now() - interval '60 seconds' THEN 1 ELSE completed_60s + 1 END,
        rate_reset_at = CASE WHEN rate_reset_at < now() - interval '60 seconds' THEN now() ELSE rate_reset_at END,
        updated_at = now()
       WHERE queue_name=$1`,
      [queue]
    );
  } catch {
    /* best-effort */
  }
}

export async function recordJobFailed(id: string, queue: string): Promise<void> {
  try {
    await query(
      `UPDATE worker_stats SET failed_jobs = failed_jobs + 1, current_job=NULL, last_heartbeat=now() WHERE worker_id=$1`,
      [id]
    );
    await query(
      `UPDATE queue_stats SET
        failed = failed + 1,
        processing = GREATEST(0, processing - 1),
        updated_at = now()
       WHERE queue_name=$1`,
      [queue]
    );
  } catch {
    /* best-effort */
  }
}

export async function recordPublished(queue: string): Promise<void> {
  try {
    await query(
      `INSERT INTO queue_stats (queue_name, published) VALUES ($1,1)
       ON CONFLICT (queue_name) DO UPDATE SET published = queue_stats.published + 1, updated_at=now()`,
      [queue]
    );
  } catch {
    /* best-effort */
  }
}
