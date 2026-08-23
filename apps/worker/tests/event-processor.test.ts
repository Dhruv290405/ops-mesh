import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { EventSeverity, Environment } from '@opsmesh/shared';
import { processEvent, IngestedEventMessage } from '../src/modules/event-processor/event.processor';
import { query } from '../src/common/db';
import { getRedis } from '../src/common/redis';
import { closeRedis } from '../src/common/redis';
import { closeEventBus } from '../src/common/eventbus';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const fingerprint = `itest-fp-${runId}`;
const eventId1 = `itevt_${runId}_a`;
const eventId2 = `itevt_${runId}_b`;
let incidentId = '';

const message = (eventId: string): IngestedEventMessage => ({
  eventId,
  serviceId: 'svc_auth',
  serviceName: 'auth-service',
  serviceCriticality: null,
  eventType: 'ProcessorTest.Event',
  severity: EventSeverity.CRITICAL,
  message: 'processor integration test',
  environment: Environment.PRODUCTION,
  timestamp: new Date().toISOString(),
  requestId: null,
  fingerprint,
  metadata: { itest: true }
});

beforeAll(async () => {
  await getRedis().del(`evt:count:${fingerprint}`, `inc:active:${fingerprint}`);
});

afterAll(async () => {
  await query(`DELETE FROM notifications WHERE incident_id = $1`, [incidentId]).catch(() => {});
  await query(`DELETE FROM incident_events WHERE incident_id = $1`, [incidentId]).catch(() => {});
  await query(`DELETE FROM incidents WHERE id = $1`, [incidentId]).catch(() => {});
  await query(`DELETE FROM events WHERE id IN ($1, $2)`, [eventId1, eventId2]).catch(() => {});
  await getRedis().del(`evt:count:${fingerprint}`, `inc:active:${fingerprint}`);
  await closeRedis();
  await closeEventBus();
});

describe('event processor (DB-backed)', () => {
  it('creates an incident from a CRITICAL production event', async () => {
    const res = await processEvent(message(eventId1));
    expect(res.outcome).toBe('incident_created');
    incidentId = res.incidentId as string;

    const rows = await query(
      `SELECT id, severity, status, dedupe_key, assigned_engineer_id
       FROM incidents WHERE id = $1`,
      [incidentId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].severity).toBe('SEV-1');
    expect(rows.rows[0].status).toBe('OPEN');
    expect(rows.rows[0].dedupe_key).toBe(fingerprint);
  });

  it('links events to the incident', async () => {
    const rows = await query(
      `SELECT event_id FROM incident_events WHERE incident_id = $1`,
      [incidentId]
    );
    expect(rows.rows.map((r) => r.event_id)).toContain(eventId1);
  });

  it('updates instead of duplicating for a repeat fingerprint', async () => {
    const res = await processEvent(message(eventId2));
    expect(res.outcome).toBe('incident_updated');
    expect(res.incidentId).toBe(incidentId);

    const inc = await query(`SELECT count(*)::int AS c FROM incidents WHERE dedupe_key = $1`, [fingerprint]);
    expect(inc.rows[0].c).toBe(1);

    const links = await query(
      `SELECT count(*)::int AS c FROM incident_events WHERE incident_id = $1`,
      [incidentId]
    );
    expect(links.rows[0].c).toBe(2);
  });

  it('fails cleanly for an unknown service', async () => {
    await expect(
      processEvent({ ...message(`itevt_${runId}_c`), serviceId: 'svc_does_not_exist' })
    ).rejects.toThrow();
  });
});