import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../common/errors';

/**
 * Validates req.params, req.query and req.body against zod schemas.
 * Usage: validate({ body: createServiceSchema, query: paginationSchema })
 */
export function validate(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as unknown as Request['params'];
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as unknown as Request['query'];
      }
      if (schemas.body && req.body !== undefined) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      const issues =
        (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues ?? [];
      const details = issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message
      }));
      next(new ValidationError('Invalid request payload', details));
    }
  };
}