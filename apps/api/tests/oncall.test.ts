import { describe, expect, it } from 'vitest';
import { computeActiveEngineer } from '../src/modules/oncall/oncall.routes';

describe('computeActiveEngineer', () => {
  const rotation = ['user-a', 'user-b', 'user-c'];

  it('returns null for empty rotation', () => {
    expect(computeActiveEngineer([], 'UTC', '09:00', '17:00', new Date('2026-01-05T12:00:00Z'))).toBeNull();
  });

  it('returns a member inside the on-call window', () => {
    const d = new Date('2026-01-05T12:00:00Z'); // Monday noon UTC
    const active = computeActiveEngineer(rotation, 'UTC', '09:00', '17:00', d);
    expect(rotation).toContain(active);
  });

  it('returns null outside the window', () => {
    const d = new Date('2026-01-05T20:00:00Z');
    expect(computeActiveEngineer(rotation, 'UTC', '09:00', '17:00', d)).toBeNull();
  });

  it('handles overnight windows (start > end)', () => {
    // 22:00 -> 06:00 ; 01:00 is inside, 12:00 is outside
    const inside = new Date('2026-01-05T01:00:00Z');
    const outside = new Date('2026-01-05T12:00:00Z');
    expect(rotation).toContain(computeActiveEngineer(rotation, 'UTC', '22:00', '06:00', inside) as string);
    expect(computeActiveEngineer(rotation, 'UTC', '22:00', '06:00', outside)).toBeNull();
  });

  it('is deterministic within the same week', () => {
    const a = new Date('2026-01-05T10:00:00Z'); // Monday
    const b = new Date('2026-01-07T10:00:00Z'); // Wednesday same week
    expect(computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', a)).toBe(
      computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', b)
    );
  });

  it('rotates every week', () => {
    const week0 = new Date('2026-01-05T10:00:00Z'); // week of Jan 5
    const week1 = new Date('2026-01-12T10:00:00Z'); // week of Jan 12
    const week2 = new Date('2026-01-19T10:00:00Z'); // week of Jan 19
    const week3 = new Date('2026-01-26T10:00:00Z'); // week of Jan 26
    const w0 = computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', week0);
    const w1 = computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', week1);
    const w2 = computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', week2);
    const w3 = computeActiveEngineer(rotation, 'UTC', '00:00', '23:59', week3);
    expect(w0).not.toBe(w1);
    expect(w1).not.toBe(w2);
    expect(w3).toBe(w0); // 3-person rotation cycles every 3 weeks
  });

  it('accounts for timezone by shifting local time', () => {
    // 2026-01-05T02:00Z is 2026-01-04 18:00 in America/Los_Angeles (PST, outside 09-17)
    // and 2026-01-05 11:00 in Asia/Tokyo (inside 09-17)
    const d = new Date('2026-01-05T02:00:00Z');
    expect(computeActiveEngineer(['u1', 'u2'], 'America/Los_Angeles', '09:00', '17:00', d)).toBeNull();
    expect(['u1', 'u2']).toContain(
      computeActiveEngineer(['u1', 'u2'], 'Asia/Tokyo', '09:00', '17:00', d) as string
    );
  });
});