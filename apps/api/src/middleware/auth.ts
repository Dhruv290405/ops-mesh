import { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '@opsmesh/config';
import { JwtPayload, UserRole, ApiKeyPurpose, ApiKeyAuth } from '@opsmesh/shared';
import { UnauthorizedError, ForbiddenError } from '../common/errors';
import { getContext } from '../common/context';
import { getApiKeyData } from '../modules/auth/api-key-store';

export type AuthInfo = JwtPayload;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
      apiKey?: ApiKeyAuth;
    }
  }
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const config = getConfig();
  return jwt.sign(
    { ...payload, purpose: 'user' },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

export function verifyToken(token: string): JwtPayload {
  const config = getConfig();
  try {
    return jwt.verify(token, config.JWT_SECRET) as JwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/**
 * Auth middleware for user JWTs (dashboard + admin APIs).
 * Accepts a Bearer token or the `opsmesh.sid` httpOnly session cookie
 * (the dashboard's session transport; SameSite=Lax covers our API/dashboard
 * same-site localhost pair).
 */
export const SESSION_COOKIE = 'opsmesh.sid';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}

export function requireAuth(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7);
    } else {
      token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    }
    if (!token) {
      return next(new UnauthorizedError('Missing Bearer token or session cookie'));
    }
    try {
      const payload = verifyToken(token);
      if (payload.purpose !== 'user') {
        return next(new UnauthorizedError('Invalid token purpose'));
      }
      req.auth = payload;
      getContext().actorId = payload.sub;
      getContext().role = payload.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.VIEWER]: 0,
  [UserRole.ENGINEER]: 1,
  [UserRole.ADMIN]: 2
};

/**
 * RBAC guard: rejects users whose role rank is below the minimum.
 */
export function requireRole(minRole: UserRole): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const payload = req.auth;
    if (!payload) return next(new UnauthorizedError());
    if (ROLE_RANK[payload.role] < ROLE_RANK[minRole]) {
      return next(new ForbiddenError(`Requires ${minRole} role`));
    }
    next();
  };
}

/**
 * Auth for the public event-ingestion endpoint.
 * Sources authenticate with an API key (x-opsmesh-key header).
 * The key resolves to a service (the "issued-for" subject) which becomes the
 * event source; the payload `service` field must match, preventing spoofing.
 */
export function requireApiKey(minPurpose: ApiKeyPurpose = ApiKeyPurpose.EVENT_INGEST): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key =
      typeof req.headers['x-opsmesh-key'] === 'string'
        ? req.headers['x-opsmesh-key']
        : undefined;
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const secret = key ?? bearer;
    if (!secret) return next(new UnauthorizedError('Missing x-opsmesh-key header'));

    try {
      const resolved = await getApiKeyData(secret);
      if (!resolved) return next(new UnauthorizedError('Invalid API key'));
      if (resolved.purpose !== minPurpose && resolved.purpose !== ApiKeyPurpose.ADMIN) {
        return next(new ForbiddenError('API key lacks required purpose'));
      }
      req.apiKey = resolved;
      getContext().actorId = resolved.subject;
      getContext().role = 'ENGINEER';
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Allow either a platform user JWT or a service API key (public endpoints). */
export function requireAnyAuth(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      const header = req.headers.authorization as string;
      try {
        const payload = verifyToken(header.slice(7)) as JwtPayload;
        if (payload.purpose === 'api') {
          req.apiKey = {
            subject: payload.sub,
            purpose: ApiKeyPurpose.EVENT_INGEST
          };
          next();
          return;
        }
        req.auth = payload;
        next();
        return;
      } catch {
        return next(new UnauthorizedError('Invalid or expired token'));
      }
    }
    next(new UnauthorizedError('Missing authorization'));
  };
}