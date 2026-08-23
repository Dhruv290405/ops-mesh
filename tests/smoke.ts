import './smoke-env';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { ApiKeyPurpose, EventSeverity, Environment } from '@opsmesh/shared';
import { generateApiKey } from '../apps/api/src/modules/auth/api-key-store';
import { createApp } from '../apps/api/src/app';
import { startWorker } from '../apps/worker/src/index';
import { query } from '../apps/worker/src/common/db';

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;

function check(name: string, ok: boolean, extra?: unknown): void {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`[${mark}] ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('== OpsMesh runtime smoke test ==');

  // Clean up incidents/events from previous smoke runs (same fingerprint dedups).
  const smokeFps = await query(`SELECT DISTINCT fingerprint FROM events WHERE metadata ->> 'smoke' = 'true'`);
  const fps = (smokeFps.rows as { fingerprint: string }[]).map((r) => r.fingerprint);
  if (fps.length > 0) {
    await query(
      `DELETE FROM incident_events WHERE incident_id IN (SELECT id FROM incidents WHERE dedupe_key = ANY($1))`,
      [fps]
    ).catch(() => {});
    await query(`DELETE FROM incidents WHERE dedupe_key = ANY($1)`, [fps]).catch(() => {});
  }
  await query(`DELETE FROM events WHERE metadata ->> 'smoke' = 'true'`).catch(() => {});

  // Worker + API in one process share the memory event bus.
  const workerP = startWorker().catch((err) => {
    check('worker start', false, err.message);
  });

  const { httpServer } = createApp();
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  check('api listening', true, { port: PORT });

  // --- health ---
  const live = await request(BASE).get('/health/live');
  check('health/live', live.status === 200);

  const ready = await request(BASE).get('/health/ready');
  const readyOk =
    ready.status === 200 ||
    (ready.status === 503 && ready.body?.status === 'degraded' && ready.body?.components?.every((c: { status: string }) => c.status !== 'DOWN'));
  check('health/ready', readyOk, ready.body);

  const deep = await request(BASE).get('/health/deep');
  check('health/deep', deep.status === 200, deep.body);

  // --- auth: login as seeded admin ---
  const login = await request(BASE).post('/api/v1/auth/login').send({
    email: 'admin@opsmesh.io',
    password: 'ChangeMe123!'
  });
  check('login admin', login.status === 200 && !!login.body?.data?.token, login.body?.message ?? '');
  const token = login.body?.data?.token;
  const adminId = login.body?.data?.user?.id;

  const me = await request(BASE).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  check('auth/me', me.status === 200 && me.body?.data?.email === 'admin@opsmesh.io', me.body?.data);

  // --- services list ---
  const svcs = await request(BASE).get('/api/v1/services').set('Authorization', `Bearer ${token}`);
  const svcList = svcs.body?.data ?? [];
  check('list services', svcs.status === 200 && svcList.length >= 5, { count: svcList.length });

  const target = svcList.find((s: { name: string }) => s.name === 'svc_payments') ?? svcList[0];
  check('target service found', !!target, { name: target?.name, id: target?.id });

  // --- create an ingestion API key bound to the service ---
  const key = await generateApiKey('smoke-test-key', target.id, ApiKeyPurpose.EVENT_INGEST, adminId ?? 'seed-admin');
  check('api key created', key.plaintext.startsWith('om_eve_'), { prefix: key.plaintext.slice(0, 12) });

  // --- ingest an event ---
  const payload = {
    service: target.name,
    eventType: 'SmokeTest.Event',
    severity: EventSeverity.CRITICAL,
    message: `smoke test event ${randomBytes(4).toString('hex')}`,
    environment: Environment.PRODUCTION,
    timestamp: new Date().toISOString(),
    metadata: { smoke: true, runId: randomBytes(6).toString('hex') }
  };
  const ingest = await request(BASE)
    .post('/api/v1/events')
    .set('x-opsmesh-key', key.plaintext)
    .send(payload);
  check(
    'ingest event 202',
    ingest.status === 202 && ingest.body?.data?.accepted === true,
    ingest.body?.data ?? ingest.body?.error
  );

  // --- duplicate: same message -> dedup, expect 200 duplicate ---
  const dup = await request(BASE).post('/api/v1/events').set('x-opsmesh-key', key.plaintext).send(payload);
  check('ingest duplicate deduped', dup.status === 200 && dup.body?.data?.duplicate === true, dup.body?.data);

  // --- key subject mismatch must be rejected ---
  const spoof = await request(BASE)
    .post('/api/v1/events')
    .set('x-opsmesh-key', key.plaintext)
    .send({ ...payload, service: 'svc_auth', message: `spoof ${randomBytes(4).toString('hex')}` });
  check('key subject mismatch rejected', spoof.status >= 400, { status: spoof.status });

  // --- poll for the incident created by the worker ---
  let incidentId: string | undefined;
  for (let i = 0; i < 30; i += 1) {
    const inc = await request(BASE)
      .get('/api/v1/incidents?limit=10')
      .set('Authorization', `Bearer ${token}`);
    const list = inc.body?.data?.data ?? [];
    const hit = list.find((x: { title: string }) => x.title === `${target.name}: ${payload.eventType}`);
    if (hit) {
      incidentId = hit.incidentId;
      check('worker processed event -> incident', true, { id: incidentId, status: hit.status, severity: hit.severity });
      break;
    }
    await sleep(500);
  }
  if (!incidentId) check('worker processed event -> incident', false, { title: `${target.name}: ${payload.eventType}` });

  // --- incident detail + timeline ---
  if (incidentId) {
    const detail = await request(BASE)
      .get(`/api/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${token}`);
    check('incident detail', detail.status === 200, detail.body?.data?.status);

    const timelineEntries = detail.body?.data?.timeline ?? [];
    check('incident timeline', timelineEntries.length > 0, {
      entries: timelineEntries.length
    });

    const notifs = await request(BASE)
      .get('/api/v1/notifications?incidentId=' + incidentId)
      .set('Authorization', `Bearer ${token}`);
    const nList = notifs.body?.data ?? [];
    check('notification enqueued for incident', nList.length > 0, { count: nList.length });
  }

  // --- metrics ---
  const metrics = await request(BASE).get('/api/v1/metrics/overview').set('Authorization', `Bearer ${token}`);
  check(
    'metrics overview',
    metrics.status === 200 && typeof metrics.body?.data?.activeIncidents === 'number',
    metrics.body?.data
  );

  // --- events table has the record ---
  const evt = await query(`SELECT id, event_type, severity FROM events ORDER BY created_at DESC LIMIT 1`);
  check('event persisted in DB', evt.rows.length > 0, evt.rows[0] ?? null);

  await workerP;

  const notifRows = await query(`SELECT status, count(*)::int AS c FROM notifications GROUP BY status`);
  check('notifications dispatch state', notifRows.rows.length > 0, notifRows.rows);

  console.log(failures === 0 ? '\nSMOKE TEST PASSED' : `\nSMOKE TEST FAILED (${failures} failures)`);
  httpServer.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});