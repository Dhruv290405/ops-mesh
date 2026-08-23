// Aggregated utility surface for OpsMesh. Each concern lives in its own file;
// this index is the single import point.

export {
  generateId,
  generateRequestId,
  generateEventId,
  generateIncidentId,
  generateUserId,
  generateTeamId,
  generateServiceId
} from './id';

export {
  calculateFingerprint,
  normalizeMessage,
  createFingerprintFromEvent,
  FingerprintInput
} from './fingerprint';

export {
  calculateSeverity,
  severityToPriority,
  getSeverityDescription,
  SeverityCalculationInput
} from './severity';

export {
  IncidentStateMachine,
  isValidTransition,
  INCIDENT_TRANSITIONS,
  validateStatusTransition
} from './state-machine';

export {
  formatDate,
  parseDate,
  getCurrentTimestamp,
  addMinutes,
  diffMinutes,
  isOlderThan
} from './date';

export { validateEnvironmentVariables } from './env';
export { createApiResponse, createPaginatedResponse } from './api-response';
export { renderNotification, RenderNotificationOptions } from './notifications';

import {
  SEVERITY_WEIGHTS,
  CRITICALITY_WEIGHTS,
  ENVIRONMENT_WEIGHTS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_ESCALATION_DELAYS,
  FINGERPRINT_FIELDS,
  EVENT_RETENTION_DAYS,
  INCIDENT_RETENTION_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  MAX_RETRY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  WEBSOCKET_PING_INTERVAL,
  WEBSOCKET_PONG_TIMEOUT,
  CACHE_TTL,
  HTTP_STATUS
} from '../constants';

export const OPSMESH_CONSTANTS = {
  SEVERITY_WEIGHTS,
  CRITICALITY_WEIGHTS,
  ENVIRONMENT_WEIGHTS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_ESCALATION_DELAYS,
  FINGERPRINT_FIELDS,
  EVENT_RETENTION_DAYS,
  INCIDENT_RETENTION_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  MAX_RETRY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  WEBSOCKET_PING_INTERVAL,
  WEBSOCKET_PONG_TIMEOUT,
  CACHE_TTL,
  HTTP_STATUS
};

// --- reliability helpers ----------------------------------------------------

export function calculateBackoff(
  attempt: number,
  baseDelay: number = BASE_RETRY_DELAY_MS,
  maxDelay: number = MAX_RETRY_DELAY_MS
): number {
  const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  baseDelay: number = BASE_RETRY_DELAY_MS,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        resolve(await fn());
        return;
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        if (shouldRetry && !shouldRetry(error)) break;
        await sleep(calculateBackoff(attempt, baseDelay));
      }
    }
    reject(lastError);
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function sanitizeMessage(message: string): string {
  return message
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

export function maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'passwordHash', 'token', 'secret', 'key', 'authorization'];
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      result[key] = '***MASKED***';
    }
  }
  return result;
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function getCurrentOnCallUser(
  rotationOrder: string[],
  currentIndex: number,
  startDate: Date
): string {
  const now = new Date();
  const start = new Date(startDate);
  const daysDiff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const rotationLength = rotationOrder.length;
  if (rotationLength === 0) return '';
  return rotationOrder[(currentIndex + daysDiff) % rotationLength];
}