import { describe, expect, it, afterEach } from 'vitest';
import { MemoryEventBus } from '../src/eventbus';

describe('MemoryEventBus', () => {
  afterEach(() => {
    // drain handles
  });

  it('delivers published messages to a consumer', async () => {
    const bus = new MemoryEventBus();
    const seen: string[] = [];
    await bus.consume({
      queue: 'test',
      maxRetries: 3,
      retryBaseMs: 1,
      handler: async (m) => {
        seen.push(m.type);
      }
    });
    await bus.publish('event.ingested', { n: 1 });
    await bus.publish('event.ingested', { n: 2 });
    await delay(100);
    expect(seen).toHaveLength(2);
    await bus.close();
  });

  it('retries a failing handler with growing delay up to maxRetries, then dead letters', async () => {
    const bus = new MemoryEventBus();
    let calls = 0;
    await bus.consume({
      queue: 'test',
      maxRetries: 3,
      retryBaseMs: 5,
      handler: async () => {
        calls += 1;
        throw new Error('boom');
      }
    });
    await bus.publish('event.ingested', { n: 1 });
    await delay(300);
    expect(calls).toBe(3);
    expect(bus.deadLettersCount()).toBe(1);
    expect(bus.pendingCount()).toBe(0);
    await bus.close();
  });

  it('recovers after transient failures without dead-lettering', async () => {
    const bus = new MemoryEventBus();
    let calls = 0;
    await bus.consume({
      queue: 'test',
      maxRetries: 3,
      retryBaseMs: 5,
      handler: async () => {
        calls += 1;
        if (calls < 3) throw new Error(`fail ${calls}`);
      }
    });
    await bus.publish('event.ingested', {}); // success on 3rd attempt
    await delay(200);
    expect(calls).toBe(3);
    expect(bus.deadLettersCount()).toBe(0);
    expect(bus.pendingCount()).toBe(0);
    await bus.close();
  });

  it('exposes the published message payload intact', async () => {
    const bus = new MemoryEventBus();
    let payload: unknown = null;
    await bus.consume({
      queue: 'test',
      maxRetries: 2,
      retryBaseMs: 1,
      handler: async (m) => {
        payload = m.payload;
      }
    });
    const data = { a: 1, nested: { b: 'x' } };
    await bus.publish('event.ingested', data);
    await delay(100);
    expect(payload).toEqual(data);
    await bus.close();
  });

  it('routes by subject to separate consumers in one process', async () => {
    const bus = new MemoryEventBus();
    const events: string[] = [];
    const realtime: string[] = [];
    await bus.consume({
      queue: 'opsmesh.events',
      subject: 'event',
      maxRetries: 2,
      retryBaseMs: 1,
      handler: async (m) => {
        events.push(m.type);
      }
    });
    await bus.consume({
      queue: 'opsmesh.realtime',
      subject: 'realtime',
      maxRetries: 2,
      retryBaseMs: 1,
      handler: async (m) => {
        realtime.push(m.type);
      }
    });
    await bus.publish('event.ingested', {});
    await bus.publish('incident.updated', {}, { subject: 'realtime' });
    await delay(100);
    expect(events).toEqual(['event.ingested']);
    expect(realtime).toEqual(['incident.updated']);
    await bus.close();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}