import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { ApiKeyPurpose, EventSeverity, Environment } from '@opsmesh/shared';
import { generateApiKey } from '../src/modules/auth/api-key-store';
import { query } from '../src/common/db';
import { closeRedis } from '../src/common/redis';
import { closeEventBus } from '../src/common/eventbus';

const app = createApp();
const server = app.httpServer;
const BASE = 'http://127.0.0.1:4101';

let token = '';
let adminId = '';
let serviceId = '';
let serviceName = '';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4101, resolve);
  });
});

afterAll(async () => {
  server.close();
  await query(`DELETE FROM api_keys WHERE name = 'itest-key'`).catch(() => {});
  await closeRedis();
  await closeEventBus();
});

describe('health', () => {
  it('live is always ok', async () => {
    const res = await request(BASE).get('/health/live');
    expect(res.status).toBe(200);
  });
});

describe('auth', () => {
  it('rejects invalid credentials', async () => {
    const res = await request(BASE)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@opsmesh.io', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('logs in with seeded admin and returns token + user', async () => {
    const res = await request(BASE)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@opsmesh.io', password: 'ChangeMe123!' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user).toBeTruthy();
    token = res.body.data.token;
    adminId = res.body.data.user.id;
  });

  it('requires auth for /me', async () => {
    const res = await request(BASE).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns identity via /me', async () => {
    const res = await request(BASE).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@opsmesh.io');
    expect(res.body.data.role).toBe('ADMIN');
  });
});

describe('services', () => {
  it('lists seeded services for authenticated users', async () => {
    const res = await request(BASE).get('/api/v1/services').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    serviceName = res.body.data[0].name;
    serviceId = res.body.data[0].id;
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(BASE).get('/api/v1/services');
    expect(res.status).toBe(401);
  });
});

describe('events ingestion', () => {
  let apiKey = '';

  it('creates an API key bound to a service', async () => {
    const k = await generateApiKey('itest-key', serviceId, ApiKeyPurpose.EVENT_INGEST, adminId);
    apiKey = k.plaintext;
    expect(apiKey.startsWith('om_eve_')).toBe(true);
  });

  it('rejects missing API key', async () => {
    const res = await request(BASE).post('/api/v1/events').send({});
    expect(res.status).toBe(401);
  });

  it('rejects invalid payload with 422', async () => {
    const res = await request(BASE)
      .post('/api/v1/events')
      .set('x-opsmesh-key', apiKey)
      .send({ service: serviceName, severity: 'NOT_A_SEVERITY' });
    expect(res.status).toBe(422);
  });

  it('rejects events for services outside the key subject', async () => {
    const res = await request(BASE)
      .post('/api/v1/events')
      .set('x-opsmesh-key', apiKey)
      .send({ service: 'other-service', eventType: 'X', severity: 'LOW', message: 'x', environment: 'production' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid event with 202 and persists it', async () => {
    const res = await request(BASE)
      .post('/api/v1/events')
      .set('x-opsmesh-key', apiKey)
      .send({
        service: serviceName,
        eventType: 'Itest.Event',
        severity: EventSeverity.LOW,
        message: 'integration test event',
        environment: Environment.PRODUCTION,
        metadata: { itest: true }
      });
    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(true);
    const evt = await query(`SELECT id FROM events WHERE id = $1`, [res.body.data.eventId]);
    expect(evt.rows.length).toBe(1);
    await query(`DELETE FROM events WHERE id = $1`, [res.body.data.eventId]);
  });

  it('dedupes an exact retry within the window (200 duplicate)', async () => {
    const payload = {
      service: serviceName,
      eventType: 'Itest.Dedupe',
      severity: EventSeverity.LOW,
      message: 'dedupe me',
      environment: Environment.PRODUCTION
    };
    const first = await request(BASE).post('/api/v1/events').set('x-opsmesh-key', apiKey).send(payload);
    const second = await request(BASE).post('/api/v1/events').set('x-opsmesh-key', apiKey).send(payload);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    await query(`DELETE FROM events WHERE id = $1`, [first.body.data.eventId]);
  });
});

describe('RBAC', () => {
  it('blocks non-admins from creating on-call schedules', async () => {
    const login = await request(BASE)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@opsmesh.io', password: 'ChangeMe123!' });
    const res = await request(BASE)
      .post('/api/v1/on-call/schedules')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({
        teamId: 't_platform',
        name: 'rbac-test-schedule',
        timezone: 'UTC',
        rotationOrder: ['u_alice'],
        startTime: '09:00',
        endTime: '17:00'
      });
    expect(res.status).toBe(403);
    await query(`DELETE FROM on_call_schedules WHERE name = 'rbac-test-schedule'`).catch(() => {});
  });

  it('allows admins to create on-call schedules', async () => {
    const res = await request(BASE)
      .post('/api/v1/on-call/schedules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        teamId: 't_platform',
        name: 'rbac-test-schedule',
        timezone: 'UTC',
        rotationOrder: ['u_alice'],
        startTime: '09:00',
        endTime: '17:00'
      });
    expect(res.status).toBe(201);
    await query(`DELETE FROM on_call_schedules WHERE id = $1`, [res.body.data.id]);
  });
});

describe('incidents', () => {
  it('returns incident list for authenticated users', async () => {
    const res = await request(BASE).get('/api/v1/incidents?limit=5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.data)).toBe(true);
  });

  it('404s for unknown incident ids', async () => {
    const res = await request(BASE)
      .get('/api/v1/incidents/inc_does_not_exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});