import { query, transaction } from '../../common/db';
import { logger } from '../../common/logger';
import { generateId } from '../../common/id';

interface ScheduleRow {
  id: string;
  name: string;
  team_id: string;
  timezone: string;
  rotation_order: string[];
  start_time: string;
  end_time: string;
}

export function weekStart(now: Date = new Date()): Date {
  const d = new Date(now);
  // ISO week starts Monday. Standardize on UTC for determinism.
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function weekIndex(now: Date): number {
  const ms = weekStart(now).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Materializes on_call_shifts for the current week for every schedule.
 * Deterministic: rotation_order[weekIndex % len]. Re-run idempotently.
 */
export async function materializeShifts(now: Date = new Date()): Promise<{ shifts: number }> {
  const schedules = await query<ScheduleRow>(
    `SELECT id, name, team_id, timezone, rotation_order, start_time, end_time FROM on_call_schedules`
  );
  const start = weekStart(now);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const wi = weekIndex(now);
  let shifts = 0;

  await transaction(async (tx) => {
    for (const s of schedules.rows) {
      const order = s.rotation_order ?? [];
      if (order.length === 0) continue;
      const activeUserId = order[wi % order.length];
      if (!activeUserId) continue;

      // idempotent upsert per (schedule, week)
      const key = `${s.id}:${start.toISOString()}`;
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM on_call_shifts WHERE id = $1`,
        [key]
      );
      if (existing.rows.length === 0) {
        await tx.query(
          `INSERT INTO on_call_shifts (id, schedule_id, user_id, starts_at, ends_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [key, s.id, activeUserId, start, end]
        );
        shifts++;
      }
    }
    // expire old shifts beyond a past week window to bound table growth
    await tx.query(
      `DELETE FROM on_call_shifts WHERE ends_at < now() - interval '30 days'`
    );
  });

  if (shifts > 0) {
    logger.info({ shifts }, 'on-call shifts materialized');
  }
  return { shifts };
}
