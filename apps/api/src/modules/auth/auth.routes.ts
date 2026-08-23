import { Router, Request, Response } from 'express';
import { createApiResponse, loginSchema, registerSchema } from '@opsmesh/shared';
import { authService } from './auth.service';
import { requireAuth, setSessionCookie, clearSessionCookie } from '../../middleware/auth';
import { asyncHandler } from '../../common/async-handler';
import { validate } from '../../middleware/validate';

const router = Router();

router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService().register(req.body);
    setSessionCookie(res, result.token);
    res.status(201).json(createApiResponse(true, result));
  })
);

router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService().login(email, password);
    setSessionCookie(res, result.token);
    res.json(createApiResponse(true, result));
  })
);

router.post(
  '/logout',
  requireAuth(),
  asyncHandler(async (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json(createApiResponse(true, { loggedOut: true }));
  })
);

router.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      createApiResponse(true, {
        id: req.auth!.sub,
        email: req.auth!.email,
        role: req.auth!.role,
        teamId: req.auth!.teamId
      })
    );
  })
);

export default router;