import { Router } from 'express';
import { createApiResponse, createApiKeySchema } from '@opsmesh/shared';
import { asyncHandler, ok } from '../../common/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import { UserRole } from '@opsmesh/shared';
import { validate } from '../../middleware/validate';
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
  requireServiceExists
} from '../auth/api-key-store';
import { NotFoundError } from '../../common/errors';

const router = Router();
router.use(requireAuth(), requireRole(UserRole.ADMIN));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const keys = await listApiKeys(100);
    ok(res, keys.map((k) => ({ ...k, key_hash: undefined })));
  })
);

router.post(
  '/',
  validate({ body: createApiKeySchema }),
  asyncHandler(async (req, res) => {
    await requireServiceExists(req.body.subject);
    const { plaintext, stored } = await generateApiKey(
      req.body.name,
      req.body.subject,
      req.body.purpose,
      req.auth!.sub
    );
    // plaintext is returned exactly once
    res.status(201).json(createApiResponse(true, { key: stored, plaintext }));
  })
);

router.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const existing = (await listApiKeys(500)).find((k) => k.id === req.params.id);
    if (!existing) throw new NotFoundError('API key not found');
    await revokeApiKey(req.params.id);
    ok(res, { revoked: true });
  })
);

export default router;