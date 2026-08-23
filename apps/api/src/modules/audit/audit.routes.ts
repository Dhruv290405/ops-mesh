import { Router } from 'express';
import { UserRole, paginationSchema } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query } from '../../common/db';

const router = Router();
router.use(requireAuth(), requireRole(UserRole.VIEWER));

router.get(
  '/',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (req.query.action) { params.push(req.query.action); conds.push(`action = $${params.length}`); }
    if (req.query.targetType) { params.push(req.query.targetType); conds.push(`target_type = $${params.length}`); }
    if (req.query.targetId) { params.push(req.query.targetId); conds.push(`target_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT id, actor_id, actor_email, action, target_type, target_id, metadata, created_at
         FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params
      ),
      query(`SELECT count(*) FROM audit_logs ${where}`, params)
    ]);
    ok(res, {
      data: rowsRes.rows,
      total: Number(countRes.rows[0]?.count ?? 0),
      page,
      limit
    });
  })
);

export default router;