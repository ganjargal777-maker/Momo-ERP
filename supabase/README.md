# NexERP Supabase Development Setup

This directory contains the first production-backend migration for NexERP.

## Migration order

1. `202609170001_core_schema.sql`
2. `202609170002_auth_rbac_rls.sql`

## First development administrator

After the migrations are applied:

1. Disable public sign-up and create the first user in Supabase Authentication.
2. Copy that user's UUID from Authentication > Users.
3. Run the following once in the SQL editor, replacing the UUID:

```sql
select public.bootstrap_first_admin(
  'AUTH_USER_UUID'::uuid,
  'Momoshop',
  'momoshop'
);
```

The bootstrap creates the organization, Admin/Manager/Operator roles, the first
Admin assignment, the default branch, warehouse, and Facebook page records.

## Security rules

- Public sign-up stays disabled; users are invited by an administrator.
- The anon role has no table access.
- The browser uses only the publishable/anon key.
- The service-role key is server-only and must never use a `VITE_` prefix.
- Every exposed business table has RLS enabled.

## Phase 4 isolated local social tests

The repository pins Supabase CLI v3 as a development dependency. Docker Desktop
is still required on Windows. These commands target the local stack only; do not
add `--remote`.

```powershell
npx supabase start
$env:LOCAL_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run supabase:local:prepare
npm run test:db
```

`prepare-local-social.mjs` refuses any database host except localhost/127.0.0.1,
applies core/auth and social migrations 001 through 004 transactionally, and
records its local-only migration state. It intentionally skips the historical
production bootstrap migration because that migration references the real first
administrator UUID. The integration test creates synthetic `example.test` users,
tests RLS and concurrent assignment, then removes all synthetic organization and
user records. A failed migration is rolled back before the test starts.

The normal browser mock remains available at:

```text
http://localhost:4173/?socialMock=1#ai-inbox
```
