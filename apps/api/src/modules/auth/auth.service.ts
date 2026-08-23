import bcrypt from 'bcryptjs';
import { UserRole } from '@opsmesh/shared';
import { query, transaction } from '../../common/db';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/errors';
import { generateId } from '../../common/id';
import { signToken } from '../../middleware/auth';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  team_id: string | null;
  is_active: boolean;
}

export function publicUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    teamId: u.team_id
  };
}

export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  teamId?: string;
}): Promise<UserRecord> {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [input.email.toLowerCase()]);
  if (existing.rows.length > 0) {
    throw new ConflictError('Email already registered');
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const id = generateId('usr');
  const res = await query<UserRecord>(
    `INSERT INTO users (id, email, name, password_hash, role, team_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, input.email.toLowerCase(), input.name, passwordHash, input.role, input.teamId ?? null]
  );
  return res.rows[0];
}

export async function loginUser(email: string, password: string): Promise<{ user: UserRecord; token: string }> {
  const res = await query<UserRecord>(
    `SELECT * FROM users WHERE email = $1 AND is_active = true`,
    [email.toLowerCase()]
  );
  const user = res.rows[0];
  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new UnauthorizedError('Invalid credentials');
  }
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  const token = signToken({ sub: user.id, email: user.email, role: user.role, teamId: user.team_id ?? undefined });
  return { user, token };
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const res = await query<UserRecord>(`SELECT * FROM users WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listUsers(limit = 50): Promise<UserRecord[]> {
  const res = await query<UserRecord>(
    `SELECT id, email, name, role, team_id, is_active, last_login_at, created_at, updated_at
     FROM users ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function updateUserRole(id: string, role: UserRole): Promise<void> {
  await query(`UPDATE users SET role = $2, updated_at = now() WHERE id = $1`, [id, role]);
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1`, [id, active]);
}

export async function findOnCallEngineerForTeam(teamId: string): Promise<UserRecord | null> {
  // Prefer the currently active on-call shift, else the team's first engineer.
  const res = await query<UserRecord>(
    `SELECT u.* FROM on_call_shifts s
     JOIN on_call_schedules sc ON sc.id = s.schedule_id
     JOIN users u ON u.id = s.user_id
     WHERE sc.team_id = $1 AND s.starts_at <= now() AND s.ends_at > now()
     ORDER BY s.ends_at LIMIT 1`,
    [teamId]
  );
  if (res.rows.length > 0) return res.rows[0];
  const fallback = await query<UserRecord>(
    `SELECT * FROM users WHERE team_id = $1 AND role IN ('ENGINEER','ADMIN') AND is_active = true ORDER BY created_at LIMIT 1`,
    [teamId]
  );
  return fallback.rows[0] ?? null;
}

export interface AuthResult {
  user: ReturnType<typeof publicUser>;
  token: string;
}

export function authService(): {
  register: (input: Parameters<typeof registerUser>[0]) => Promise<AuthResult>;
  login: (email: string, password: string) => Promise<AuthResult>;
} {
  return {
    register: async (input) => {
      const user = await registerUser(input);
      const token = signToken({ sub: user.id, email: user.email, role: user.role, teamId: user.team_id ?? undefined });
      return { user: publicUser(user), token };
    },
    login: async (email, password) => {
      const { user, token } = await loginUser(email, password);
      return { user: publicUser(user), token };
    }
  };
}