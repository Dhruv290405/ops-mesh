import { randomBytes } from 'crypto';

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(8).toString('hex');
  return `${prefix}${prefix ? '_' : ''}${timestamp}_${randomPart}`;
}

export function generateRequestId(): string {
  return `req_${generateId()}`;
}

export function generateEventId(): string {
  return generateId('evt');
}

export function generateIncidentId(): string {
  return generateId('inc');
}

export function generateUserId(): string {
  return generateId('usr');
}

export function generateTeamId(): string {
  return generateId('t');
}

export function generateServiceId(): string {
  return generateId('svc');
}