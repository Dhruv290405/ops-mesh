import IORedis from 'ioredis';

/**
 * Redis abstraction.
 *
 * OpsMesh uses Redis for: event dedup state, rate limiting, service cache,
 * dashboard metrics cache, distributed locks, on-call hot state.
 *
 * Production: real Redis via ioredis.
 * Local dev/tests without Redis: in-memory implementation with the same
 * semantics (best-effort TTL with lazy expiration). NEVER use the memory
 * fallback for multi-instance deployments - it exists only so the entire
 * system runs end-to-end in a single box / CI with zero external infra.
 *
 * Selection: REDIS_URL=memory enables the fallback. Default: URL form.
 */

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  /** Fixed-window + sliding-window building block: increments and sets TTL on first call. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /** Sets key only if it does not exist (lock). Returns true if acquired. */
  setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  /** Sliding window log for rate limiting. Returns current count. */
  slidingWindowAdd(key: string, windowSeconds: number, now?: number): Promise<number>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// ioredis implementation (production)
// ---------------------------------------------------------------------------

export class RedisRemote implements RedisClient {
  private redis: IORedis | null = null;

  constructor(private readonly url: string) {}

  private client(): IORedis {
    if (!this.redis) {
      this.redis = new IORedis(this.url, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        retryStrategy: (times: number) => Math.min(times * 200, 3000)
      });
      this.redis.on('error', () => {
        /* reconnects internally; errors surfaced via ping/ops */
      });
    }
    return this.redis;
  }

  async get(key: string): Promise<string | null> {
    return this.client().get(key);
  }

  async set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void> {
    if (opts?.ttlSeconds) {
      await this.client().set(key, value, 'EX', opts.ttlSeconds);
    } else {
      await this.client().set(key, value);
    }
  }

  async del(...keys: string[]): Promise<void> {
    await this.client().del(keys);
  }

  async incr(key: string): Promise<number> {
    return this.client().incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client().expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client().ttl(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client().exists(key)) > 0;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client().hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client().hget(key, field);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client().hdel(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client().hgetall(key);
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const multi = this.client().multi().incr(key).expire(key, ttlSeconds);
    const res = await multi.exec();
    return Number(res?.[0]?.[1] ?? 0);
  }

  async setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (ttlSeconds) {
      const res = await this.client().set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    }
    const res = await this.client().setnx(key, value);
    return res === 1;
  }

  async slidingWindowAdd(key: string, windowSeconds: number, now: number = Date.now()): Promise<number> {
    const member = `${now}-${Math.random()}`;
    const multi = this.client()
      .multi()
      .zremrangebyscore(key, 0, now - windowSeconds * 1000)
      .zadd(key, now, member)
      .zcard(key)
      .expire(key, windowSeconds);
    const res = await multi.exec();
    return Number(res?.[2]?.[1] ?? 0);
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.client().ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (dev/tests only)
// ---------------------------------------------------------------------------

interface MemEntry {
  value: string;
  expiresAt: number | null;
}

export class RedisMemory implements RedisClient {
  private store = new Map<string, MemEntry>();
  private hashStore = new Map<string, Map<string, string>>();
  private sortedSets = new Map<string, Map<string, number>>();

  private live(key: string): MemEntry | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: opts?.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null
    });
  }

  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.store.delete(k);
  }

  async incr(key: string): Promise<number> {
    const cur = this.live(key);
    const next = (cur ? Number(cur.value) : 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: cur?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    const e = this.live(key);
    if (e) e.expiresAt = Date.now() + seconds * 1000;
  }

  async ttl(key: string): Promise<number> {
    const e = this.live(key);
    if (!e || e.expiresAt === null) return -1;
    return Math.max(0, Math.floor((e.expiresAt - Date.now()) / 1000));
  }

  async exists(key: string): Promise<boolean> {
    return this.live(key) !== null;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.hashStore.has(key)) this.hashStore.set(key, new Map());
    this.hashStore.get(key)!.set(field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashStore.get(key)?.get(field) ?? null;
  }

  async hdel(key: string, field: string): Promise<void> {
    this.hashStore.get(key)?.delete(field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const m = this.hashStore.get(key);
    if (!m) return {};
    return Object.fromEntries(m.entries());
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.incr(key);
    const e = this.live(key);
    if (e && e.expiresAt === null) e.expiresAt = Date.now() + ttlSeconds * 1000;
    return n;
  }

  async setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSeconds ? { ttlSeconds } : undefined);
    return true;
  }

  async slidingWindowAdd(key: string, windowSeconds: number, now: number = Date.now()): Promise<number> {
    let zs = this.sortedSets.get(key);
    if (!zs) {
      zs = new Map();
      this.sortedSets.set(key, zs);
    }
    const cutoff = now - windowSeconds * 1000;
    for (const [member, score] of [...zs.entries()]) {
      if (score < cutoff) zs.delete(member);
    }
    zs.set(`${now}-${Math.random()}`, now);
    return zs.size;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.store.clear();
    this.hashStore.clear();
    this.sortedSets.clear();
  }
}

let instance: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (instance) return instance;
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  instance = url === 'memory' ? new RedisMemory() : new RedisRemote(url);
  return instance;
}

/** Factory used by tests to inject a fresh Redis. */
export function createRedis(url?: string): RedisClient {
  if (!url || url === 'memory') return new RedisMemory();
  return new RedisRemote(url);
}

export async function closeRedis(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export async function redisPing(): Promise<boolean> {
  return getRedis().ping();
}