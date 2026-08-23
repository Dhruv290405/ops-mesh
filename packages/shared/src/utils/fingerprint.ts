import { createHash } from 'crypto';
import { IngestEventInput, EventSeverity } from '../types';

export interface FingerprintInput {
  service: string;
  eventType: string;
  environment: string;
  message: string;
  severity: EventSeverity;
}

export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, 'uuid')
    .replace(/\b[0-9a-f]{8,}\b/gi, 'hash')
    // identifiers mixing letters/underscores with digits (req_123, svc-9, oid_42x)
    .replace(/\b[a-z]+[_-]\d+[a-z0-9_-]*\b/gi, 'id')
    // standalone numbers (also inside colon/time groups like "12:04" -> "n:n")
    .replace(/\b\d+\b/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateFingerprint(input: FingerprintInput): string {
  const normalized = normalizeMessage(input.message);
  const parts = [
    input.service,
    input.eventType,
    input.environment,
    input.severity,
    normalized
  ];
  
  const hash = createHash('sha256');
  hash.update(parts.join('|'));
  return hash.digest('hex').substring(0, 32);
}

export function createFingerprintFromEvent(event: IngestEventInput): string {
  return calculateFingerprint({
    service: event.service,
    eventType: event.eventType,
    environment: event.environment,
    message: event.message,
    severity: event.severity
  });
}