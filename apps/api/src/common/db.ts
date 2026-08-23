import pg from 'pg';
import { getConfig } from '@opsmesh/config';
import { logger } from './logger';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const config = getConfig();
  pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    logger.error({ err: err.message }, 'pg pool error');
  });

  return pool;
}

export function closePool(): Promise<void> {
  if (!pool) return Promise.resolve();
  const p = pool;
  pool = null;
  return p.end();
}

export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

export interface Transaction {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
const tx: Transaction = {
      query: <R extends pg.QueryResultRow>(text: string, params?: unknown[]) =>
        client.query<R>(text, params as never[]),
      commit: async () => {
        await client.query('COMMIT');
      },
      rollback: async () => {
        await client.query('ROLLBACK');
      }
    };
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}
