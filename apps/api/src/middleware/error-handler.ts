import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { createApiResponse } from '@opsmesh/shared';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { getContext } from '../common/context';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(createApiResponse(false, undefined, {
    code: 'NOT_FOUND',
    message: 'Route not found'
  }, getContext().requestId));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = getContext().requestId;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId, path: req.originalUrl }, err.message);
    }
    res.status(err.statusCode).json(
      createApiResponse(
        false,
        undefined,
        { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
        requestId
      )
    );
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json(
      createApiResponse(
        false,
        undefined,
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
        },
        requestId
      )
    );
    return;
  }

  logger.error({ err, requestId, path: req.originalUrl }, 'unhandled error');
  // Deliberately generic: never leak internals to clients.
  res.status(500).json(
    createApiResponse(false, undefined, {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    }, requestId)
  );
}