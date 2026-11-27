# MomoERP production database rollback runbook

This runbook is a release gate. Do not run it against production without an
explicit deployment approval and a fresh logical or platform backup.

## Before deployment

1. Confirm the linked project ref is `lxjkkqypiwnnrjmnpick`.
2. Record `supabase migration list --remote` and the application commit SHA.
3. Create separate schema and data dumps with `supabase db dump --remote`.
4. Store the dumps outside Git, restrict filesystem access to the operator, and
   record SHA-256 hashes.
5. Restore the dumps into an isolated Supabase/PostgreSQL environment and check
   Auth user, profile, organization, role, and orphan counts.
6. Apply every pending migration to the restored copy and run database, RLS,
   authentication, invitation, and browser acceptance tests.

## Rollback decision

Prefer a forward fix when the migration is additive and data remains valid.
Stop application writes before any destructive rollback. If a restore is
required, use the pre-deployment platform backup or the verified logical dump;
do not manually delete production rows or edit Supabase migration history.

The current pending release adds tables, policies, functions, and indexes. It
does not have a safe generic down migration because dropping those objects can
discard newly written production data. Therefore the supported rollback is:

1. redeploy the previous application commit;
2. disable the new feature flags;
3. restore the verified pre-deployment database backup only if schema/data
   compatibility prevents the previous application from operating;
4. rerun Auth login, profile/RBAC, order read, and inventory read acceptance;
5. retain the failed database and logs for investigation.
## Restore validation notes

Auth and public data must be restored with foreign-key triggers disabled only
inside the isolated restore environment. Restore the hosted Auth schema before
Auth data. Defer the `on_auth_user_created` trigger until the public trigger
function exists. For an existing-project restore, one-time bootstrap/verification
migrations are represented by the restored public data and must not be replayed
as new-project seed operations.
