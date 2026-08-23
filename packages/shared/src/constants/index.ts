export const SEVERITY_WEIGHTS: Record<string, number> = {
  'SEV-1': 100,
  'SEV-2': 75,
  'SEV-3': 50,
  'SEV-4': 25,
};

export const CRITICALITY_WEIGHTS: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const ENVIRONMENT_WEIGHTS: Record<string, number> = {
  development: 1,
  staging: 2,
  production: 3,
};

export const DEFAULT_RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 1000,
};

export const DEFAULT_ESCALATION_DELAYS = [5, 10, 15, 30];

export const FINGERPRINT_FIELDS = ['service', 'eventType', 'environment', 'message'];

export const EVENT_RETENTION_DAYS = 90;
export const INCIDENT_RETENTION_DAYS = 365;
export const AUDIT_LOG_RETENTION_DAYS = 2555;

export const MAX_RETRY_ATTEMPTS = 5;
export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 60000;

export const WEBSOCKET_PING_INTERVAL = 30000;
export const WEBSOCKET_PONG_TIMEOUT = 5000;

export const CACHE_TTL = {
  SERVICE: 300,
  SERVICE_HEALTH: 60,
  INCIDENT: 30,
  USER: 300,
  TEAM: 300,
  ONCALL: 60,
  ESCALATION_POLICY: 300,
};

export const DATABASE_INDEXES = {
  events: [
    ['serviceId', 'timestamp'],
    ['fingerprint', 'timestamp'],
    ['incidentId'],
    ['timestamp'],
  ],
  incidents: [
    ['serviceId', 'status'],
    ['assignedEngineerId', 'status'],
    ['severity', 'status'],
    ['createdAt'],
  ],
  audit_logs: [
    ['actorId', 'createdAt'],
    ['targetType', 'targetId', 'createdAt'],
    ['action', 'createdAt'],
  ],
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
} as const;

export const INCIDENT_STATE_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ACKNOWLEDGED', 'ESCALATED'],
  ACKNOWLEDGED: ['INVESTIGATING', 'ESCALATED'],
  INVESTIGATING: ['MITIGATED', 'ESCALATED', 'ACKNOWLEDGED'],
  MITIGATED: ['RESOLVED', 'INVESTIGATING'],
  RESOLVED: [],
  ESCALATED: ['ACKNOWLEDGED', 'INVESTIGATING'],
};

export const PRIORITY_CALCULATION = {
  SEVERITY_WEIGHT: 0.5,
  CRITICALITY_WEIGHT: 0.3,
  ENVIRONMENT_WEIGHT: 0.1,
  FREQUENCY_WEIGHT: 0.1,
};