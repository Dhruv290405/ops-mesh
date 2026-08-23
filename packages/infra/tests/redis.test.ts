import { describe, expect, it } from 'vitest';
import { RedisMemory } from '../src/redis';

describe('RedisMemory', () => {
  const redis = new RedisMemory();

  it('set/get roundtrip', async () => {
    await redis.set('k1', 'v1');
    expect(await redis.get('k1')).toBe('v1');
    expect(await redis.get('missing')).toBeNull();
  });

  it('expires keys after ttl', async () => {
    await redis.set('k2', 'v2', { ttlSeconds: 1 });
    expect(await redis.get('k2')).toBe('v2');
    await delay(1100);
    expect(await redis.get('k2')).toBeNull();
  });

  it('implements ttl semantics (infinite = -1)', async () => {
    await redis.set('k3', 'v3');
    expect(await redis.ttl('k3')).toBe(-1);
    await redis.expire('k3', 5);
    expect(await redis.ttl('k3')).toBeGreaterThan(0);
  });

  it('incr + incrWithTtl', async () => {
    await redis.del('k4');
    expect(await redis.incr('k4')).toBe(1);
    expect(await redis.incr('k4')).toBe(2);
    await redis.del('k5');
    expect(await redis.incrWithTtl('k5', 60)).toBe(1);
    expect(await redis.ttl('k5')).toBeGreaterThan(0);
  });

  it('setNx is exclusive and honours ttl', async () => {
    await redis.del('lock');
    expect(await redis.setNx('lock', '1', 60)).toBe(true);
    expect(await redis.setNx('lock', '2', 60)).toBe(false);
    await redis.del('lock');
  });

  it('hash operations', async () => {
    await redis.hset('h1', 'f1', 'a');
    await redis.hset('h1', 'f2', 'b');
    expect(await redis.hget('h1', 'f1')).toBe('a');
    expect(await redis.hgetall('h1')).toEqual({ f1: 'a', f2: 'b' });
    await redis.hdel('h1', 'f1');
    expect(await redis.hget('h1', 'f1')).toBeNull();
  });

  it('slidingWindowAdd counts within the window and prunes expired', async () => {
    const t0 = 1_700_000_000_000;
    expect(await redis.slidingWindowAdd('sw2', 60, t0)).toBe(1);
    expect(await redis.slidingWindowAdd('sw2', 60, t0 + 30_000)).toBe(2);
    // 61s in: first entry fell out, the 30s one remains
    expect(await redis.slidingWindowAdd('sw2', 60, t0 + 61_000)).toBe(2);
    // 31s later: only the 61s entry remains
    expect(await redis.slidingWindowAdd('sw2', 60, t0 + 92_000)).toBe(2);
  });

  it('exists + ping + close', async () => {
    await redis.set('k6', 'v6');
    expect(await redis.exists('k6')).toBe(true);
    expect(await redis.ping()).toBe(true);
    await redis.close();
    expect(await redis.get('k6')).toBeNull();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}