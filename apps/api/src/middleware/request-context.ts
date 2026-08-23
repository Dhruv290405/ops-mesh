import { RequestHandler } from 'express';
import { createContext, getContext, runWithContext } from '../common/context';
import { logger } from '../common/logger';
import { generateId } from '../common/id';

/** Assigns requestId and starts per-request logging. Uses AsyncLocalStorage. */
export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incomingId =
    typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].length > 0
      ? req.headers['x-request-id']
      : generateId('req')
  const ctx = createContext({
    requestId: incomingId ?? undefined,
    actorId: req.headers['x-actor-id'] ? String(req.headers['x-actor-id']) : undefined
  });

  const startedAt = Date.now();
  runWithContext(ctx, () => {
    res.setHeader('x-request-id', ctx.requestId);
    logger.info(
      {
        requestId: ctx.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      },
      'request start'
    );
    next();
  });

  res.on('finish', () => {
    const c = getContext();
    logger.info(
      {
        requestId: c.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      },
      'request end'
    );
  });
};