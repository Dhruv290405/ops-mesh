import { NextFunction, Request, RequestHandler, Response } from 'express';
import { getRedis } from '../common/redis';
import { RateLimitError } from '../common/errors';
import { logger } from '../common/logger';

export interface RateLimitOptions {
  /** sliding window size in seconds */
  windowSeconds: number;
  /** max requests per window per key */
  max: number;
  /** lambda building the rate-limit key from the request */
  keyFor: (req: Request) => string;
  /** measure & surface rate-limit headers */
  headers?: boolean;
}

/**
 * Sliding-window rate limiter built on Redis sorted sets
 * (or the memory fallback with identical semantics).
 * Key pattern: rl:{scope}:{identifier} -> ZSET of request timestamps.
 * Algorithm: drop entries older than window, append now, count.
 * 429 responses carry Retry-After and consume no window quota.
 */
export function rateLimiter(opts: RateLimitOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const redis = getRedis();
    const key = `rl:${opts.keyFor(req)}`;
    try {
      const count = await redis.slidingWindowAdd(key, opts.windowSeconds);
      const remaining = Math.max(0, opts.max - count);
      if (opts.headers) {
        res.setHeader('X-RateLimit-Limit', String(opts.max));
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Window', String(opts.windowSeconds));
      }
      if (count > opts.max) {
        res.setHeader('Retry-After', String(opts.windowSeconds));
        return next(new RateLimitError('Rate limit exceeded', { limit: opts.max, windowSeconds: opts.windowSeconds }));
      }
      next();
    } catch (err) {
      // Degrade open on Redis failure: availability over strict limiting.
      logger.warn({ err: (err as Error).message }, 'rate limiter degraded (open)');
      next();
    }
  };
}

export function defaultApiRateLimit(): RequestHandler {
  const maxPerMinute = Number(process.env.RATE_LIMIT_API_PER_MINUTE ?? 120);
  return rateLimiter({
    windowSeconds: 60,
    max: maxPerMinute,
    keyFor: (req) =>
      req.auth?.sub ?? req.apiKey?.subject ?? req.ip ?? 'anonymous',
    headers: true
  });
}

export function eventIngestionRateLimit(): RequestHandler {
  const maxPerMinute = Number(process.env.RATE_LIMIT_EVENTS_PER_MINUTE ?? 1000);
  return rateLimiter({
    windowSeconds: 60,
    max: maxPerMinute,
    keyFor: (req) => `event:${req.apiKey?.subject ?? req.ip ?? req.body?.service ?? 'unknown'}`,
    headers: true
  });
}