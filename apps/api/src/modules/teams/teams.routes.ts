import { Router } from 'express';
import { createApiResponse, createTeamSchema, createUserSchema, UserRole } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query } from '../../common/db';
import { generateId } from '../../common/id';
import { listUsers, registerUser, updateUserRole, setUserActive, publicUser } from '../auth/auth.service';
import { NotFoundError } from '../../common/errors';

const router = Router();
router.use(requireAuth());

// ---------------------------------------------------------------- teams
router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT t.id, t.name, t.description, t.created_at,
              count(u.id) FILTER (WHERE u.is_active) AS member_count
       FROM teams t LEFT JOIN users u ON u.team_id = t.id
       GROUP BY t.id ORDER BY t.name`
    );
    ok(res, rows.rows);
  })
);

router.post(
  '/teams',
  requireRole(UserRole.ADMIN),
  validate({ body: createTeamSchema }),
  asyncHandler(async (req, res) => {
    const id = generateId('t');
    const row = await query(
      `INSERT INTO teams (id, name, description) VALUES ($1,$2,$3) RETURNING id, name, description, created_at`,
      [id, req.body.name, req.body.description ?? null]
    );
    res.status(201).json(createApiResponse(true, row.rows[0]));
  })
);

router.patch(
  '/teams/:id',
  requireRole(UserRole.ADMIN),
  validate({ body: createTeamSchema.partial() }),
  asyncHandler(async (req, res) => {
    const sets: string[] = [];
    const params: unknown[] = [req.params.id];
    if (req.body.name !== undefined) { params.push(req.body.name); sets.push(`name = $${params.length}`); }
    if (req.body.description !== undefined) { params.push(req.body.description); sets.push(`description = $${params.length}`); }
    if (sets.length === 0) { ok(res, { unchanged: true }); return; }
    sets.push(`updated_at = now()`);
    const row = await query(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, description, created_at`,
      params
    );
    if (!row.rows[0]) throw new NotFoundError('Team not found');
    ok(res, row.rows[0]);
  })
);

// ---------------------------------------------------------------- users
router.get(
  '/users',
  requireRole(UserRole.VIEWER),
  asyncHandler(async (req, res) => {
    const users = await listUsers(Number(req.query.limit ?? 100));
    ok(res, users.map(publicUser));
  })
);

router.post(
  '/users',
  requireRole(UserRole.ADMIN),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const user = await registerUser(req.body);
    res.status(201).json(createApiResponse(true, publicUser(user)));
  })
);

router.patch(
  '/users/:id/role',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const role = req.body.role as UserRole;
    await updateUserRole(req.params.id, role);
    ok(res, { updated: true });
  })
);

router.patch(
  '/users/:id/active',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const active = Boolean(req.body.active);
    await setUserActive(req.params.id, active);
    ok(res, { updated: true });
  })
);

export default router;