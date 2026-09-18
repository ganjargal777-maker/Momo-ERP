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
