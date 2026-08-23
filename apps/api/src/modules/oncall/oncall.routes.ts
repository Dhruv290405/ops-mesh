import { Router } from 'express';
import { createApiResponse, createScheduleSchema, UserRole } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query } from '../../common/db';
import { generateId } from '../../common/id';
import { NotFoundError } from '../../common/errors';

const router = Router();
router.use(requireAuth());

function hourToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Deterministic offset (minutes) of `timezone` from UTC at the given instant,
 * using the well-known two-Intl-format trick (both formatted outputs are parsed
 * by the host as local time, so their difference is the TZ offset).
 */
function tzOffsetMinutes(date: Date, timezone: string): number {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const utcMs = Date.parse(new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date));
  const tzMs = Date.parse(new Intl.DateTimeFormat('en-US', { ...opts }).format(date));
  return (utcMs - tzMs) / 60000;
}

/**
 * Deterministic rotation: the active engineer for team+time is
 * rotation_order[weekIndex % len]. Week-indexed instead of day-indexed so a
 * primary on-call is stable across SRE rotations (documented in README).
 * All computations are done in the schedule's timezone.
 */
export function computeActiveEngineer(
  rotationOrder: string[],
  timezone: string,
  startTime: string,
  endTime: string,
  now: Date = new Date()
): string | null {
  if (rotationOrder.length === 0) return null;
  const offsetMinutes = tzOffsetMinutes(now, timezone);
  const localMs = now.getTime() - offsetMinutes * 60000;
  const localMinutes = (Math.floor(localMs / 60000) % 1440 + 1440) % 1440;
  const start = hourToMinutes(startTime);
  const end = hourToMinutes(endTime);
  // overnight shifts wrap
  const inside = start <= end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
  if (!inside) return null;

  const localDay = Math.floor(localMs / 86_400_000);
  const weekIndex = Math.floor(localDay / 7);
  return rotationOrder[weekIndex % rotationOrder.length];
}

router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, team_id, name, timezone, rotation_order, start_time, end_time, escalation_target_id, created_at, updated_at
       FROM on_call_schedules ORDER BY name`
    );
    ok(res, rows.rows);
  })
);

router.post(
  '/schedules',
  requireRole(UserRole.ADMIN),
  validate({ body: createScheduleSchema }),
  asyncHandler(async (req, res) => {
    const id = generateId('sch');
    const row = await query(
      `INSERT INTO on_call_schedules (id, team_id, name, timezone, rotation_order, start_time, end_time, escalation_target_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, team_id, name, timezone, rotation_order, start_time, end_time, escalation_target_id`,
      [
        id, req.body.teamId, req.body.name, req.body.timezone,
        req.body.rotationOrder, req.body.startTime, req.body.endTime,
        req.body.escalationTargetId ?? null
      ]
    );
    res.status(201).json(createApiResponse(true, row.rows[0]));
  })
);

router.delete(
  '/schedules/:id',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const row = await query(`DELETE FROM on_call_schedules WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!row.rows[0]) throw new NotFoundError('Schedule not found');
    ok(res, { deleted: true });
  })
);

/** POST /on-call/current - returns the active engineer for a schedule/team. */
router.post(
  '/current',
  asyncHandler(async (req, res) => {
    const scheduleId = (req.body.scheduleId as string) ?? (req.body.schedule_id as string);
    const teamId = (req.body.teamId as string) ?? (req.body.team_id as string);
    if (!scheduleId && !teamId) {
      return res.status(400).json(createApiResponse(false, undefined, {
        code: 'VALIDATION_ERROR',
        message: 'Provide scheduleId or teamId'
      }));
    }
    const rows = await query(
      `SELECT s.id, s.team_id, s.name, s.timezone, s.rotation_order, s.start_time, s.end_time,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM on_call_schedules s
       JOIN LATERAL (
         SELECT u2.id, u2.name, u2.email FROM users u2 WHERE u2.id = ANY(s.rotation_order)
       ) u ON true
       WHERE ($1::text IS NULL OR s.id = $1) AND ($2::text IS NULL OR s.team_id = $2)`,
      [scheduleId ?? null, teamId ?? null]
    );
    const schedule = rows.rows[0];
    if (!schedule) throw new NotFoundError('No matching schedule');

    const activeUserId = computeActiveEngineer(
      schedule.rotation_order, schedule.timezone, schedule.start_time, schedule.end_time
    );
    const user = rows.rows.find((r) => r.user_id === activeUserId) ?? null;
    ok(res, {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      active: user ? { id: user.user_id, name: user.user_name, email: user.user_email } : null,
      rotation: schedule.rotation_order,
      asOf: new Date().toISOString()
    });
  })
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const scheduleId = req.query.scheduleId as string | undefined;
    const teamId = req.query.teamId as string | undefined;
    const rows = await query(
      `SELECT s.id, s.team_id, s.name, s.timezone, s.rotation_order, s.start_time, s.end_time,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM on_call_schedules s
       JOIN LATERAL (
         SELECT u2.id, u2.name, u2.email FROM users u2 WHERE u2.id = ANY(s.rotation_order)
       ) u ON true
       WHERE ($1::text IS NULL OR s.id = $1) AND ($2::text IS NULL OR s.team_id = $2)`,
      [scheduleId ?? null, teamId ?? null]
    );
    const schedule = rows.rows[0];
    if (!schedule) throw new NotFoundError('No matching schedule');
    const activeUserId = computeActiveEngineer(
      schedule.rotation_order, schedule.timezone, schedule.start_time, schedule.end_time
    );
    const user = rows.rows.find((r) => r.user_id === activeUserId) ?? null;
    ok(res, {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      active: user ? { id: user.user_id, name: user.user_name, email: user.user_email } : null,
      rotation: schedule.rotation_order,
      asOf: new Date().toISOString()
    });
  })
);

export default router;