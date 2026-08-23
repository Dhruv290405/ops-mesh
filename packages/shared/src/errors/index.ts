export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public isOperational: boolean;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_REQUIRED', 401, details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions', details?: Record<string, unknown>) {
    super(message, 'AUTHORIZATION_FAILED', 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(message, 'RESOURCE_NOT_FOUND', 404, { resource, id });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RESOURCE_CONFLICT', 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, { retryAfter });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, details);
    this.isOperational = false;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: Record<string, unknown>) {
    super(message, 'SERVICE_UNAVAILABLE', 503, details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(key: string) {
    super(`Request with idempotency key ${key} already processed`, 'IDEMPOTENCY_CONFLICT', 409, { key });
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(current: string, target: string) {
    super(
      `Invalid state transition from ${current} to ${target}`,
      'INVALID_STATE_TRANSITION',
      422,
      { current, target }
    );
  }
}

export class DuplicateEventError extends AppError {
  constructor(fingerprint: string, incidentId: string) {
    super(
      'Duplicate event detected',
      'DUPLICATE_EVENT',
      200,
      { fingerprint, incidentId }
    );
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isOperationalError(error: unknown): boolean {
  return isAppError(error) && error.isOperational;
}

export function formatErrorResponse(error: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  statusCode: number;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
      statusCode: 500,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred',
    statusCode: 500,
  };
}