import {
  IncidentStatus,
  NotificationChannel
} from '@opsmesh/shared';
import { query, transaction } from '../../common/db';
import { logger } from '../../common/logger';
import { generateId } from '../../common/id';
import { emitRealtime } from '../../common/realtime';
import { recordJobStart, recordJobDone, recordJobFailed } from '../../common/stats';

interface EscalationStepRow {
  id: string;
  level: number;
  delay_minutes: number;
  target_type: 'USER' | 'TEAM' | 'SCHEDULE';
  target_id: string;
  notify_channels: string[];
  policy_id: string;
}

interface DueIncidentRow {
  id: string;
  title: string;
  service_id: string;
  severity: string;
  escalation_level: number;
  assigned_engineer_id: string | null;
  created_at: Date;
}

/**
 * Escalation engine.
 *
 * Timers survive restarts by design: there are no in-memory timers. Every
 * poll we query incidents whose elapsed time exceeds the configured delay for
 * their next escalation level, computed from persisted timestamps.
 *
 *   next_due_at = created_at + sum(step.delay_minutes for levels <= current+1)
 *
 * If an incident was acknowledged, escalation stops for it (worker checks
 * status). Policy is resolved per service (service-bound, team-bound fallback).
 */
export class EscalationWorker {
  private intervalMs: number;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const cycle = async () => {
      await recordJobStart('escalation', 'escalation');
      try {
        await this.poll();
        await recordJobDone('escalation', 'escalation');
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'escalation poll failed');
        await recordJobFailed('escalation', 'escalation');
      }
    };
    this.timer = setInterval(() => {
      void cycle();
    }, this.intervalMs);
    this.timer.unref();
    void cycle();
    logger.info({ intervalMs: this.intervalMs }, 'escalation worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll cycle. Exported for tests. */
  async poll(): Promise<{ escalated: number }> {
    const incidents = await this.findDueIncidents();
    let escalated = 0;
    for (const incident of incidents) {
      try {
        const done = await this.escalateOnce(incident);
        if (done) escalated++;
      } catch (err) {
        logger.error(
          { err: (err as Error).message, incidentId: incident.id },
          'escalation failed for incident'
        );
      }
    }
    if (escalated > 0) {
      logger.info({ escalated }, 'escalations executed');
    }
    return { escalated };
  }

  /** Incidents that are unacknowledged (or investigating w/o ack) and due. */
  private async findDueIncidents(): Promise<DueIncidentRow[]> {
    const res = await query<DueIncidentRow>(
      `SELECT i.id, i.title, i.service_id, i.severity, i.escalation_level,
              i.assigned_engineer_id, i.created_at
       FROM incidents i
       WHERE i.status IN ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED')
         AND i.acknowledged_at IS NULL
         AND i.escalation_level < 10
       ORDER BY i.created_at
       LIMIT 50`
    );
    const due: DueIncidentRow[] = [];
    for (const incident of res.rows) {
      const delay = await this.delayForNextStep(incident);
      if (delay === null) continue;
      const dueAt = new Date(incident.created_at.getTime() + delay * 60_000);
      if (dueAt <= new Date()) due.push(incident);
    }
    return due;
  }

  private async delayForNextStep(incident: DueIncidentRow): Promise<number | null> {
    const steps = await this.stepsForIncident(incident);
    if (steps.length === 0) return null;
    const nextLevel = incident.escalation_level + 1;
    const step = steps.find((s) => s.level === nextLevel);
    if (!step) return null;
    // cumulative delay: sum of all delays up to this level
    return steps
      .filter((s) => s.level <= nextLevel)
      .reduce((acc, s) => acc + s.delay_minutes, 0);
  }

  private async stepsForIncident(incident: DueIncidentRow): Promise<EscalationStepRow[]> {
    const policy = await query<{ id: string }>(
`SELECT id FROM escalation_policies WHERE service_id = $1
       UNION SELECT ep.id FROM escalation_policies ep
         JOIN services s ON s.owner_team_id = ep.team_id
         WHERE s.id = $1 AND ep.team_id IS NOT NULL
       LIMIT 1`,
      [incident.service_id]
    );
    if (policy.rows.length === 0) return [];
    const res = await query<EscalationStepRow>(
      `SELECT es.id, es.level, es.delay_minutes, es.target_type, es.target_id, es.notify_channels, es.policy_id
       FROM escalation_steps es
       WHERE es.policy_id = $1
       ORDER BY es.level`,
      [policy.rows[0].id]
    );
    return res.rows;
  }

  /**
   * Performs one escalation step (or reassignment to the next engineer).
   * Records the execution, bumps the level, enqueues notifications.
   */
  private async escalateOnce(incident: DueIncidentRow): Promise<boolean> {
    const steps = await this.stepsForIncident(incident);
    if (steps.length === 0) {
      logger.info({ incidentId: incident.id }, 'no escalation policy - skipping');
      return false;
    }
    const nextLevel = incident.escalation_level + 1;
    const step = steps.find((s) => s.level === nextLevel);
    if (!step) {
      logger.info({ incidentId: incident.id, level: nextLevel }, 'no further escalation steps');
      return false;
    }

    const target = await this.resolveTarget(step.target_type, step.target_id);
    const targetName = target?.name ?? step.target_id;

    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO escalation_executions
           (id, incident_id, policy_id, step_level, target_type, target_id, target_name, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'NO_ACKNOWLEDGEMENT')`,
        [
          generateId('esc'),
          incident.id,
          step.policy_id,
          step.level,
          step.target_type,
          step.target_id,
          targetName
        ]
      );
      await tx.query(
        `UPDATE incidents SET escalation_level = escalation_level + 1,
                assigned_engineer_id = $2,
                status = CASE WHEN status = 'OPEN' THEN 'ESCALATED' ELSE status END,
                updated_at = now()
         WHERE id = $1`,
        [incident.id, target?.id ?? incident.assigned_engineer_id]
      );
      await tx.query(
        `INSERT INTO incident_timeline (id, incident_id, type, actor_id, actor_name, message, metadata)
         VALUES ($1,$2,'ESCALATED',$3,$4,'Escalated to level ' || $5 || ' - ' || $6, $7)`,
        [
          generateId('tl'),
          incident.id,
          target?.id ?? null,
          targetName,
          String(step.level),
          step.target_type,
          JSON.stringify({ level: step.level, targetType: step.target_type })
        ]
      );
      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, metadata)
         VALUES ($1,NULL,NULL,'INCIDENT_ESCALATED','incident',$2,$3)`,
        [
          generateId('aud'),
          incident.id,
          JSON.stringify({ level: step.level, targetType: step.target_type, targetId: step.target_id })
        ]
      );

      // enqueue notifications for the step's channels
      for (const channel of step.notify_channels as NotificationChannel[]) {
        await tx.query(
          `INSERT INTO notifications (id, incident_id, channel, recipient, subject, body, status)
           VALUES ($1,$2,$3,$4,$5,$6,'PENDING')`,
          [
            generateId('ntf'),
            incident.id,
            channel,
            target?.email ?? step.target_id,
            `[ESCALATED] ${incident.title}`,
            `Incident ${incident.id} escalated to level ${step.level}`,
          ]
        );
      }
    });

logger.info(
      { incidentId: incident.id, level: step.level, target: targetName },
      'incident escalated'
    );
    await emitRealtime('incident.updated', {
      incidentId: incident.id,
      status: 'ESCALATED',
      escalationLevel: step.level,
      target: targetName
    });
    return true;
  }

  private async resolveTarget(
    targetType: 'USER' | 'TEAM' | 'SCHEDULE',
    targetId: string
  ): Promise<{ id: string | null; name: string; email?: string } | null> {
    if (targetType === 'USER') {
      const res = await query<{ id: string; name: string; email: string }>(
        `SELECT id, name, email FROM users WHERE id = $1 AND is_active = true`,
        [targetId]
      );
      return res.rows[0] ? { id: res.rows[0].id, name: res.rows[0].name, email: res.rows[0].email } : null;
    }
    if (targetType === 'TEAM') {
      const res = await query<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [targetId]);
      return res.rows[0] ? { id: null, name: `team:${res.rows[0].name}` } : null;
    }
    // SCHEDULE: current active engineer
    const res = await query<{ id: string; name: string; email: string }>(
      `SELECT u.id, u.name, u.email
       FROM on_call_schedules s
       JOIN on_call_shifts sh ON sh.schedule_id = s.id
       JOIN users u ON u.id = sh.user_id
       WHERE s.id = $1 AND sh.starts_at <= now() AND sh.ends_at > now()
       LIMIT 1`,
      [targetId]
    );
    if (res.rows.length > 0) {
      return { id: res.rows[0].id, name: res.rows[0].name, email: res.rows[0].email };
    }
    return null;
  }
}

export function incidentUnacknowledged(status: IncidentStatus): boolean {
  return status !== IncidentStatus.ACKNOWLEDGED && status !== IncidentStatus.RESOLVED;
}
