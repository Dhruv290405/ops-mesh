import { NotificationChannel } from '../types';

/**
 * Notification provider abstraction...
 */
export interface NotificationPayload {
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  incidentId: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(payload: NotificationPayload): Promise<void>;
}

export class EmailProvider implements NotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  async send(payload: NotificationPayload): Promise<void> {
    const { logNotification } = await import('../utils/notifications');
    logNotification(NotificationChannel.EMAIL, payload);
  }
}

export class WebhookProvider implements NotificationProvider {
  readonly channel = NotificationChannel.WEBHOOK;
  async send(payload: NotificationPayload): Promise<void> {
    const { logNotification } = await import('../utils/notifications');
    logNotification(NotificationChannel.WEBHOOK, payload);
  }
}

export class SlackProvider implements NotificationProvider {
  readonly channel = NotificationChannel.SLACK;
  async send(payload: NotificationPayload): Promise<void> {
    const { logNotification } = await import('../utils/notifications');
    logNotification(NotificationChannel.SLACK, payload);
  }
}

export function getNotificationProvider(channel: NotificationChannel): NotificationProvider {
  switch (channel) {
    case NotificationChannel.EMAIL: return new EmailProvider();
    case NotificationChannel.WEBHOOK: return new WebhookProvider();
    case NotificationChannel.SLACK: return new SlackProvider();
  }
}
