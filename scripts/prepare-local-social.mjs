import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Refusing to prepare a non-local database.');
const files = [
  'supabase/migrations/202609170001_core_schema.sql',
  'supabase/migrations/202609170002_auth_rbac_rls.sql',
  'supabase/migrations/202611260001_momo_ai_social_phase2.sql',
  'supabase/migrations/202611260002_multi_page_team_management.sql',
  'supabase/migrations/202611260003_social_operations.sql',
  'supabase/migrations/202611260004_social_real_data.sql',
  'supabase/migrations/20261126111223_social_contract_alignment.sql'
];
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('create table if not exists public.phase4_local_migrations(name text primary key, applied_at timestamptz not null default now())');
  for (const file of files) {
    const applied = await client.query('select 1 from public.phase4_local_migrations where name=$1', [file]);
    if (applied.rowCount) { console.log(`skip ${file}`); continue; }
    const sql = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into public.phase4_local_migrations(name) values($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`${file} failed and was rolled back: ${error.message}`);
    }
  }
} finally { await client.end(); }
