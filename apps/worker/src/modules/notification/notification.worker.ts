import { NotificationChannel, NotificationStatus, renderNotification } from '@opsmesh/shared';
import { query } from '../../common/db';
import { logger } from '../../common/logger';
import { generateId } from '../../common/id';
import { emitRealtime } from '../../common/realtime';
import { recordJobStart, recordJobDone, recordJobFailed } from '../../common/stats';

/**
 * Notification worker - self-contained process-side implementation.
 * (The API side owns enqueueing; provider dispatch/rendering state is shared
 * via @opsmesh/shared and duplicated DB access is intentional: worker and API
 * are independently deployable units, see docs/architecture.md.)
 */

export interface QueuedNotification {
  id: string;
  incident_id: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: Date;
}

export async function listDueNotifications(limit = 25): Promise<QueuedNotification[]> {
  const res = await query<QueuedNotification>(
    `SELECT * FROM notifications
     WHERE status IN ('PENDING','RETRYING') AND attempts < max_attempts
     ORDER BY created_at LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function markSent(id: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'SENT', sent_at = now(), last_attempt_at = now(),
            error = NULL, attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [id]
  );
}

async function markFailed(id: string, error: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'FAILED', error = $2, last_attempt_at = now(),
            attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

async function markRetrying(id: string, error: string): Promise<void> {
  await query(
    `UPDATE notifications SET status = 'RETRYING', error = $2, last_attempt_at = now(),
            attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

/** Provider dispatch. All three transports are integration points: in local/dev
 *  they resolve to structured logging; production wire-ups (SMTP, outbound
 *  HTTP) plug in here behind the same function signature. */
async function dispatch(n: QueuedNotification): Promise<void> {
  const notice = {
    channel: n.channel,
    recipient: n.recipient,
    subject: n.subject,
    body: n.body,
    incidentId: n.incident_id
  };
  if (n.channel === NotificationChannel.EMAIL) {
    logger.info({ ...notice }, 'notification dispatched (email)');
    return;
  }
  if (n.channel === NotificationChannel.SLACK) {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `*${n.subject ?? n.body}*\n${n.body}` })
      });
      if (!res.ok) throw new Error(`slack webhook returned ${res.status}`);
      return;
    }
    logger.info({ ...notice }, 'notification dispatched (slack, simulated)');
    return;
  }
  // WEBHOOK / generic
  logger.info({ ...notice }, 'notification dispatched (webhook)');
}

export class NotificationWorker {
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private throttle = new Map<string, number>();

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const cycle = async () => {
      await recordJobStart('notification', 'notifications');
      try {
        await this.poll();
        await recordJobDone('notification', 'notifications');
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'notification poll failed');
        await recordJobFailed('notification', 'notifications');
      }
    };
    this.timer = setInterval(() => {
      void cycle();
    }, this.intervalMs);
    this.timer.unref();
    void cycle();
    logger.info({ intervalMs: this.intervalMs }, 'notification worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<{ sent: number; failed: number; throttled: number }> {
    const due = await listDueNotifications(25);
    let sent = 0;
    let failed = 0;
    let throttled = 0;
    for (const n of due) {
      // Anti-notification-storm throttle: max 1 dispatch per (incident,channel)
      // per second within this process.
      const key = `${n.incident_id}:${n.channel}`;
      const last = this.throttle.get(key) ?? 0;
      if (Date.now() - last < 1000) {
        throttled++;
        continue;
      }
      this.throttle.set(key, Date.now());
try {
        await dispatch(n);
        await markSent(n.id);
        sent++;
        await emitRealtime('notification.dispatched', {
          notificationId: n.id,
          incidentId: n.incident_id,
          channel: n.channel,
          status: 'SENT'
        });
      } catch (err) {
        failed++;
        const message = (err as Error).message;
        if (n.attempts + 1 >= n.max_attempts) {
          await markFailed(n.id, message);
          logger.error({ notificationId: n.id, err: message }, 'notification permanently failed');
        } else {
          await markRetrying(n.id, message);
          logger.warn({ notificationId: n.id, err: message, attempts: n.attempts + 1 }, 'notification scheduled for retry');
        }
      }
    }
    if (sent > 0 || failed > 0) {
      logger.info({ sent, failed, throttled }, 'notification cycle complete');
    }
    return { sent, failed, throttled };
  }
}

export async function enqueueIncidentNotification(opts: {
  incidentId: string;
  serviceName: string;
  severity: string;
  title: string;
  channels: NotificationChannel[];
  recipient: string;
  action?: 'CREATED' | 'ACKNOWLEDGED' | 'ESCALATED' | 'RESOLVED' | 'ASSIGNED';
  targetName?: string;
}): Promise<string[]> {
  // stores a notification row per channel; rendering happens at dispatch time
  const ids: string[] = [];
  for (const channel of opts.channels) {
    const rendered = renderNotification(channel, {
      incidentTitle: opts.title,
      incidentId: opts.incidentId,
      severity: opts.severity,
      serviceName: opts.serviceName,
      action: opts.action,
      targetName: opts.targetName
    });
    const res = await query<{ id: string }>(
      `INSERT INTO notifications (id, incident_id, channel, recipient, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING') RETURNING id`,
      [generateId('ntf'), opts.incidentId, channel, opts.recipient, rendered.subject, rendered.body]
    );
    ids.push(res.rows[0].id);
  }
  return ids;
}
