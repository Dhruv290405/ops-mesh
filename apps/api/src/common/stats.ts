import { query } from './db';

/**
 * Minimal queue counters for the API process. The worker writes the matching
 * counters from its side; both read/write the shared `queue_stats` table.
 */
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

export async function recordQueueCompleted(queue: string): Promise<void> {
  try {
    await query(
      `UPDATE queue_stats SET
        completed = completed + 1,
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
