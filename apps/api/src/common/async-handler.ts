import { NextFunction, Request, RequestHandler, Response } from 'express';
import { createApiResponse } from '@opsmesh/shared';
import { getContext } from './context';

/**
 * Wraps async route handlers so rejections reach the error middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(createApiResponse(true, data, undefined, getContext().requestId));
}