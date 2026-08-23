import { NotificationChannel } from '../types';
import type { NotificationPayload } from '../providers';

export interface RenderNotificationOptions {
  incidentTitle: string;
  incidentId: string;
  severity: string;
  serviceName: string;
  action?: 'CREATED' | 'ACKNOWLEDGED' | 'ESCALATED' | 'RESOLVED' | 'ASSIGNED';
  targetName?: string;
}

export function renderNotification(
  channel: NotificationChannel,
  opts: RenderNotificationOptions
): { subject: string; body: string } {
  const actionText = opts.action ?? 'CREATED';
  const subject =
    actionText === 'CREATED'
      ? `[OpsMesh ${opts.severity}] ${opts.incidentTitle}`
      : actionText === 'ESCALATED'
        ? `[ESCALATED] ${opts.incidentTitle}`
        : `[OpsMesh] ${opts.incidentTitle} - ${actionText}`;
  const body = [
    `Incident: ${opts.incidentId}`,
    `Service: ${opts.serviceName}`,
    `Severity: ${opts.severity}`,
    `Action: ${actionText}${opts.targetName ? ` (${opts.targetName})` : ''}`,
    `Link: ${process.env.API_URL ?? ''}/incidents/${opts.incidentId}`
  ].join('\n');
  return { subject, body };
}

/** Log-based dispatch used by the default in-process providers. */
export function logNotification(channel: NotificationChannel, payload: NotificationPayload): void {
  // Uses a bare console.warn to avoid coupling shared to a logger; services
  // override send() with real transports in production.
  const entry = {
    channel,
    recipient: payload.recipient,
    subject: payload.subject ?? payload.body.slice(0, 80),
    incidentId: payload.incidentId
  };
  if (typeof console !== 'undefined') {
    console.log(`[notification:${channel}]`, JSON.stringify(entry));
  }
}