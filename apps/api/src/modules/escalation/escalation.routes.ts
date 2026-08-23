import { Router } from 'express';
import { createPolicySchema, UserRole } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { query, transaction } from '../../common/db';
import { generateId } from '../../common/id';
import { ConflictError, NotFoundError } from '../../common/errors';

const router = Router();
router.use(requireAuth());

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT ep.id, ep.name, ep.description, ep.service_id, ep.team_id, ep.updated_at,
              es.steps
       FROM escalation_policies ep
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'id', id, 'level', level, 'delayMinutes', delay_minutes,
           'targetType', target_type, 'targetId', target_id, 'notifyChannels', notify_channels
         ) ORDER BY level) AS steps
         FROM escalation_steps WHERE policy_id = ep.id
       ) es ON true
       ORDER BY ep.name`
    );
    ok(res, rows.rows);
  })
);

router.post(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: createPolicySchema }),
  asyncHandler(async (req, res) => {
    const policyId = generateId('pol');
    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO escalation_policies (id, name, description, service_id, team_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [policyId, req.body.name, req.body.description ?? null, req.body.serviceId ?? null, req.body.teamId ?? null]
      );
      for (const step of req.body.steps) {
        await tx.query(
          `INSERT INTO escalation_steps (id, policy_id, level, delay_minutes, target_type, target_id, notify_channels)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            generateId('est'), policyId, step.level, step.delayMinutes,
            step.targetType, step.targetId, step.notifyChannels
          ]
        );
      }
    });
    res.status(201).json({ success: true, data: { id: policyId } });
  })
);

router.delete(
  '/:id',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req, res) => {
    const row = await query(`DELETE FROM escalation_policies WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!row.rows[0]) throw new NotFoundError('Policy not found');
    ok(res, { deleted: true });
  })
);

/** Which policy applies to a service? (service-bound or team-bound fallback) */
export async function resolvePolicyForService(serviceId: string): Promise<{ id: string } | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM escalation_policies WHERE service_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [serviceId]
  );
  if (res.rows[0]) return res.rows[0];
  const fallback = await query<{ id: string }>(
    `SELECT ep.id FROM escalation_policies ep
     JOIN services s ON s.owner_team_id = ep.team_id
     WHERE s.id = $1 AND ep.team_id IS NOT NULL
     ORDER BY ep.updated_at DESC LIMIT 1`,
    [serviceId]
  );
  return fallback.rows[0] ?? null;
}

export interface ResolvedEscalationStep {
  step: {
    id: string;
    level: number;
    delayMinutes: number;
    targetType: string;
    targetId: string;
    notifyChannels: string[];
  };
  policyId: string;
}

export async function loadPolicySteps(policyId: string): Promise<ResolvedEscalationStep[]> {
  const res = await query(
    `SELECT id, level, delay_minutes, target_type, target_id, notify_channels
     FROM escalation_steps WHERE policy_id = $1 ORDER BY level`,
    [policyId]
  );
  return res.rows.map((r) => ({
    step: {
      id: r.id,
      level: r.level,
      delayMinutes: r.delay_minutes,
      targetType: r.target_type,
      targetId: r.target_id,
      notifyChannels: r.notify_channels
    },
    policyId
  }));
}

export { ConflictError };

export default router;