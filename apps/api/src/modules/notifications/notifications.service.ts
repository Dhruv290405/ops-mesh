import { NotificationChannel, NotificationStatus, getNotificationProvider } from '@opsmesh/shared';
import type { NotificationPayload } from '@opsmesh/shared';
import { query } from '../../common/db';
import { generateId } from '../../common/id';

export interface QueuedNotification {
  id: string;
  incidentId: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** Enqueue a notification (side-effect-free; worker dispatches it). */
export async function enqueueNotification(payload: NotificationPayload): Promise<string> {
  const res = await query<QueuedNotification>(
    `INSERT INTO notifications (id, incident_id, channel, recipient, subject, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
     RETURNING id`,
    [
      generateId('ntf'),
      payload.incidentId,
      payload.channel,
      payload.recipient,
      payload.subject ?? null,
      payload.body
    ]
  );
  return res.rows[0].id;
}

/** Worker-facing: claim next batch of due notifications. */
export async function listDueNotifications(limit = 25): Promise<QueuedNotification[]> {
  const res = await query<QueuedNotification>(
    `SELECT * FROM notifications
     WHERE status IN ('PENDING','RETRYING') AND attempts < max_attempts
     ORDER BY created_at LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function markSent(id: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'SENT', sent_at = now(), last_attempt_at = now(), error = NULL, attempts = attempts + 1, updated_at = now()
     WHERE id = $1`,
    [id]
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'FAILED', error = $2, last_attempt_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = $1`,
    [id, error]
  );
}

export async function markRetrying(id: string, error: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'RETRYING', error = $2, last_attempt_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = $1`,
    [id, error]
  );
}

export async function retryNotification(id: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'PENDING', error = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}

/** Dispatches one notification through its provider. Throws on failure (caller retries). */
export async function dispatchNotification(n: QueuedNotification): Promise<void> {
  const provider = getNotificationProvider(n.channel);
  await provider.send({
    channel: n.channel,
    recipient: n.recipient,
    subject: n.subject ?? undefined,
    body: n.body,
    incidentId: n.incidentId
  });
}

export async function listNotifications(incidentId?: string, limit = 50): Promise<QueuedNotification[]> {
  const res = incidentId
    ? await query<QueuedNotification>(
        `SELECT * FROM notifications WHERE incident_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [incidentId, limit]
      )
    : await query<QueuedNotification>(
        `SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
  return res.rows;
}

/** Number of notification delivery failures for observability dashboard. */
export async function countFailedNotifications(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT count(*) FROM notifications WHERE status = 'FAILED'`
  );
  return Number(res.rows[0]?.count ?? 0);
}