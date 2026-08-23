import { calculateFingerprint, EventSeverity } from '@opsmesh/shared';
import { query, transaction } from '../../common/db';
import { getEventBus } from '../../common/eventbus';
import { logger } from '../../common/logger';
import { generateId } from '../../common/id';
import { emitRealtime } from '../../common/realtime';
import { recordJobStart, recordJobDone, recordJobFailed } from '../../common/stats';

interface HealthCheckServiceRow {
  id: string;
  name: string;
  health_check_url: string;
  health_check_method: string;
  health_check_timeout: number;
  expected_status: number;
}

export interface HealthCheckOutcome {
  serviceId: string;
  serviceName: string;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

/**
 * Configurable health checks:
 *  - HTTP fetch with timeout (AbortSignal), expected status comparison
 *  - result recorded in health_check_results + drives service.status
 *  - failure state machine: consecutive failures (>=3) emit a reliability
 *    event to the bus, which flows through the incident engine exactly like
 *    any other event. Recovery emits a recovery event.
 */
export class HealthCheckWorker {
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = new Map<string, number>();
  private running = false;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const cycle = async () => {
      await recordJobStart('health-check', 'health');
      try {
        await this.poll();
        await recordJobDone('health-check', 'health');
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'health check poll failed');
        await recordJobFailed('health-check', 'health');
      }
    };
    this.timer = setInterval(() => {
      void cycle();
    }, this.intervalMs);
    this.timer.unref();
    void cycle();
    logger.info({ intervalMs: this.intervalMs }, 'health check worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Check every service configured with a health_check_url. Exported for tests. */
  async poll(): Promise<HealthCheckOutcome[]> {
    const res = await query<HealthCheckServiceRow>(
      `SELECT id, name, health_check_url, health_check_method, health_check_timeout, expected_status
       FROM services
       WHERE health_check_url IS NOT NULL AND deleted_at IS NULL AND status <> 'MAINTENANCE'`
    );
    const outcomes: HealthCheckOutcome[] = [];
    for (const svc of res.rows) {
      const outcome = await this.checkOne(svc);
      outcomes.push(outcome);
      await this.record(svc, outcome);
    }
    return outcomes;
  }

  private async checkOne(svc: HealthCheckServiceRow): Promise<HealthCheckOutcome> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), svc.health_check_timeout);
    try {
      const response = await fetch(svc.health_check_url, {
        method: svc.health_check_method,
        signal: controller.signal,
        headers: { accept: 'application/json' }
      });
      const latencyMs = Date.now() - start;
      const ok = response.status === svc.expected_status;
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        ok,
        latencyMs,
        statusCode: response.status,
        ...(ok ? {} : { error: `unexpected status ${response.status}, expected ${svc.expected_status}` })
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = (err as Error).name === 'AbortError'
        ? `timeout after ${svc.health_check_timeout}ms`
        : (err as Error).message;
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        ok: false,
        latencyMs,
        error: message
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async record(svc: HealthCheckServiceRow, outcome: HealthCheckOutcome): Promise<void> {
    const failures = this.consecutiveFailures.get(svc.id) ?? 0;
    const nextFailures = outcome.ok ? 0 : failures + 1;
    this.consecutiveFailures.set(svc.id, nextFailures);

    const serviceStatus = outcome.ok ? 'HEALTHY' : nextFailures >= 3 ? 'DOWN' : 'DEGRADED';

    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO health_check_results (id, service_id, status, latency_ms, status_code, error)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          generateId('hc'),
          svc.id,
          outcome.ok ? 'PASS' : 'FAIL',
          outcome.latencyMs,
          outcome.statusCode ?? null,
          outcome.error ?? null
        ]
      );
      await tx.query(
        `UPDATE services SET status = $2, updated_at = now() WHERE id = $1`,
        [svc.id, serviceStatus]
      );
    });

// Emit a reliability event when state flips (failure threshold reached
    // or recovery). These flow through the incident engine like user events.
    if (nextFailures === 3) {
      logger.warn({ serviceId: svc.id, error: outcome.error }, 'service marked DOWN by health checks');
      await this.emitReliabilityEvent(svc, outcome, 'HEALTH_CHECK_FAILURE');
    } else if (nextFailures === 0 && failures >= 3) {
      logger.info({ serviceId: svc.id }, 'service recovered');
      await this.emitReliabilityEvent(svc, outcome, 'HEALTH_CHECK_RECOVERY');
    }

    await emitRealtime('service.health', {
      serviceId: svc.id,
      serviceName: svc.name,
      status: serviceStatus,
      ok: outcome.ok,
      latencyMs: outcome.latencyMs,
      checkedAt: new Date().toISOString()
    });
  }

  private async emitReliabilityEvent(
    svc: HealthCheckServiceRow,
    outcome: HealthCheckOutcome,
    eventType: 'HEALTH_CHECK_FAILURE' | 'HEALTH_CHECK_RECOVERY'
  ): Promise<void> {
    const bus = getEventBus();
    const message =
      eventType === 'HEALTH_CHECK_FAILURE'
        ? `${svc.name} is DOWN: ${outcome.error ?? 'health check failed'}`
        : `${svc.name} recovered (latency ${outcome.latencyMs}ms)`;
    const severity: EventSeverity = eventType === 'HEALTH_CHECK_FAILURE' ? EventSeverity.CRITICAL : EventSeverity.LOW;
    const fingerprint = calculateFingerprint({
      service: svc.name,
      eventType,
      environment: 'production',
      severity,
      message
    });
    await bus.publish('event.ingested', {
      eventId: generateId('evt'),
      serviceId: svc.id,
      serviceName: svc.name,
      serviceCriticality: null,
      eventType,
      severity,
      message,
      environment: 'production',
      timestamp: new Date().toISOString(),
      requestId: null,
      fingerprint,
      metadata: {
        source: 'health-check-worker',
        latencyMs: outcome.latencyMs,
        statusCode: outcome.statusCode ?? null,
        error: outcome.error ?? null
      }
    });
  }
}
