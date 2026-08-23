import { randomBytes } from 'crypto';

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

export function generateRequestId(): string {
  return `req_${randomBytes(6).toString('hex')}`;
}