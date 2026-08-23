import { describe, expect, it } from 'vitest';
import { calculateFingerprint, normalizeMessage } from '../fingerprint';
import { EventSeverity } from '../../types';

describe('normalizeMessage', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeMessage('  DB Timeout   AGAIN ')).toBe('db timeout again');
  });

  it('replaces numeric IDs with N', () => {
    expect(normalizeMessage('user 12345 failed at order 9876')).toBe('user n failed at order n');
  });

  it('replaces hashes and UUIDs', () => {
    expect(normalizeMessage('hash a1b2c3d4e5f6a7b8c9d0e1f2 broken')).toBe('hash hash broken');
    expect(normalizeMessage('uuid 550e8400-e29b-41d4-a716-446655440000 gone')).toBe('uuid uuid gone');
  });
});

describe('calculateFingerprint', () => {
  const base = {
    service: 'payment-service',
    eventType: 'DATABASE_TIMEOUT',
    environment: 'production',
    severity: EventSeverity.HIGH,
    message: 'Database connection timeout'
  };

  it('is deterministic', () => {
    expect(calculateFingerprint(base)).toBe(calculateFingerprint(base));
  });

  it('is stable across runs (hash format)', () => {
    // sha256 truncated to 32 hex chars
    expect(calculateFingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs when any core field changes', () => {
    const changed = { ...base, message: 'Database connection refused' };
    expect(calculateFingerprint(changed)).not.toBe(calculateFingerprint(base));

    const otherService = { ...base, service: 'order-service' };
    expect(calculateFingerprint(otherService)).not.toBe(calculateFingerprint(base));
  });

  it('groups messages that differ only by IDs/timestamps', () => {
    const a = calculateFingerprint({ ...base, message: 'timeout for req_123 at 12:04' });
    const b = calculateFingerprint({ ...base, message: 'timeout for req_999 at 13:11' });
    expect(a).toBe(b);
  });
});
