import { createHash, randomBytes } from 'crypto';
import { ApiKeyPurpose } from '@opsmesh/shared';
import { query, transaction } from '../../common/db';
import { ConflictError, NotFoundError } from '../../common/errors';

export interface StoredApiKey {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  subject: string;
  purpose: ApiKeyPurpose;
  created_by: string;
  created_at: Date;
  revoked_at?: Date;
}

/**
 * API keys for machine sources (event ingestion).
 * Only a sha256 hash is stored - the plaintext key exists exactly once, at
 * creation time, and is returned to the caller to save with their own vault.
 */
export function generateApiKey(name: string, subject: string, purpose: ApiKeyPurpose, createdBy: string): Promise<{ plaintext: string; stored: StoredApiKey }> {
  return transaction(async (tx) => {
    const plaintext = `om_${purpose.slice(0, 3)}_${randomBytes(22).toString('base64url')}`;
    const keyPrefix = plaintext.slice(0, 12);
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const res = await tx.query<StoredApiKey>(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, subject, purpose, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, key_prefix, key_hash, subject, purpose, created_by, created_at`,
      [
        `key_${randomBytes(8).toString('hex')}`,
        name,
        keyPrefix,
        keyHash,
        subject,
        purpose,
        createdBy
      ]
    );
    return { plaintext, stored: res.rows[0] };
  });
}

/** Resolve a plaintext key to its metadata (by prefix lookup + hash compare). */
export async function getApiKeyData(plaintext: string): Promise<{
  keyId: string;
  subject: string;
  purpose: ApiKeyPurpose;
} | null> {
  if (!plaintext.startsWith('om_')) return null;
  const keyPrefix = plaintext.slice(0, 12);
  const keyHash = createHash('sha256').update(plaintext).digest('hex');
  const res = await query<StoredApiKey>(
    `SELECT * FROM api_keys WHERE key_prefix = $1 AND revoked_at IS NULL LIMIT 1`,
    [keyPrefix]
  );
  if (res.rows.length === 0) return null;
  const key = res.rows[0];
  if (key.key_hash !== keyHash) return null;
  return { keyId: key.id, subject: key.subject, purpose: key.purpose };
}

export async function revokeApiKey(id: string): Promise<void> {
  await query(`UPDATE api_keys SET revoked_at = now(), updated_at = now() WHERE id = $1`, [id]);
}

export async function listApiKeys(limit = 50): Promise<StoredApiKey[]> {
  const res = await query<StoredApiKey>(
    `SELECT id, name, key_prefix, key_hash, subject, purpose, created_by, created_at, revoked_at
     FROM api_keys ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function requireServiceExists(serviceId: string): Promise<void> {
  const res = await query(`SELECT id FROM services WHERE id = $1 AND deleted_at IS NULL`, [serviceId]);
  if (res.rows.length === 0) {
    throw new NotFoundError(`Service ${serviceId} not found`);
  }
}

export async function serviceNameExists(name: string, excludeId?: string): Promise<boolean> {
  const res = await query(
    `SELECT id FROM services WHERE name = $1 AND ($2::text IS NULL OR id <> $2) AND deleted_at IS NULL`,
    [name, excludeId ?? null]
  );
  return res.rows.length > 0;
}

export async function ensureUniqueServiceName(name: string, excludeId?: string): Promise<void> {
  if (await serviceNameExists(name, excludeId)) {
    throw new ConflictError(`Service name '${name}' already exists`);
  }
}