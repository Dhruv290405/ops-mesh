import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') });
dotenv.config();
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const SEEDS_DIR = join(__dirname, 'seeds');

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:@localhost:5432/postgres';
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

const pool = new pg.Pool({ connectionString, ssl, max: 3 });

function listSql(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function appliedMigrations() {
  const res = await pool.query('SELECT name FROM schema_migrations');
  return new Set(res.rows.map((r) => r.name));
}

async function up() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = await appliedMigrations();
  const files = listSql(MIGRATIONS_DIR);
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED ${file}: ${err.message}`);
      process.exitCode = 1;
      return;
    } finally {
      client.release();
    }
  }
  if (ran === 0) console.log('[migrate] nothing to apply - schema up to date');
}

async function seed() {
  for (const file of listSql(SEEDS_DIR)) {
    const sql = readFileSync(join(SEEDS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`[seed] applied ${file}`);
    } catch (err) {
      console.error(`[seed] FAILED ${file}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function status() {
  const applied = await appliedMigrations();
  for (const file of listSql(MIGRATIONS_DIR)) {
    console.log(file, applied.has(file) ? 'APPLIED' : 'PENDING');
  }
}

async function reset() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    );
    const tables = res.rows
      .map((r) => `public."${r.table_name}"`)
      .join(', ');
    if (tables) await client.query(`DROP TABLE IF EXISTS ${tables} CASCADE`);
    await client.query('COMMIT');
    console.log('[reset] dropped all public tables');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[reset] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  await up();
}

const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') await up();
  else if (cmd === 'seed') await seed();
  else if (cmd === 'status') await status();
  else if (cmd === 'reset') await reset();
  else {
    console.error(`unknown command: ${cmd} (use up|down|seed|status|reset)`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}