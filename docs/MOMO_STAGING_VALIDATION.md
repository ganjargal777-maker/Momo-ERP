# MOMO isolated staging validation — 2026-11-27

Production `lxjkkqypiwnnrjmnpick`, the production domain and existing Messenger
service were not deployed, migrated, reset or reconfigured by this run. No real
Messenger message or external email was sent. No paid resource was created.

## Actual isolated targets

- Supabase: `mmvmvweitrhlgqtjadaz`, **MOMO ERP Social Sandbox**, Momoshop Free,
  quoted creation cost **$0/month**, Singapore, PostgreSQL17.12, ACTIVE_HEALTHY.
- Applied the18 curated migrations, excluding the3 historical owner-specific
  bootstrap/assertion/admin-update scripts. The migration inventory and hashes
  are in `docs/evidence/core-pg15-validation.json`.
- Deployed `social-integration`, `invite-user` and `social-access-recheck`.
  The first two retain gateway JWT verification and verify the caller again.
  Recheck accepts an opaque server credential and authenticates it itself;
  its `verify_jwt=false` does not make its business handler public.
- Free Render static staging: `https://momo-erp-social-sandbox.onrender.com`,
  service `srv-dc4gugm1egvs738d5vfg`, separate from the existing bot service.
  Source is the overnight ERP feature branch; the first frontend build is99809e7.
  The public runtime points only to the sandbox. The allowlisted build excludes
  the legacy product cost/stock export, server sources, environment and Git files.
- Sandbox signup is disabled. Auth callback/site URLs point to the staging
  origin. JWT expiry was temporarily60s for a real expiry test, then restored
  to its exact prior3600s. No production Auth settings changed.

## Implemented server contract

The browser gateway derives delivery identity from the real JWT/profile and
`get_social_delivery_context(target_page)`. It forwards only SQL-derived
`X-Momo-Erp-Actor`, `X-Momo-Erp-Organization` and `X-Momo-Erp-Team` values when
`SOCIAL_STAFF_RECHECK_ENABLED=true`. This opt-in is false by default. A bot that
requires actor recheck cannot be sent a legacy context-free gateway request.
The selected team is an active primary/backup team with active membership;
primary wins when both are eligible. Explicit Page denies override membership.
This preserves Page-wide inbox policy; it is not an own-assigned-only rule.

The deployed **sandbox-only** `POST /functions/v1/social-access-recheck` requires
the dedicated `Authorization: Bearer <server-secret>`, JSON, no browser Origin
or cookie, and an `X-Momo-Request-Id` matching the body. Request example:

```json
{"requestId":"<UUID>","subjectId":"<staff UUID>","organizationId":"<org UUID>","pageId":"<Meta numeric ID>","teamId":"<team UUID>","permission":"social_inbox.reply_send"}
```

Successful protocol responses, including confirmed denials, are HTTP200 with:

```json
{"active":true,"userId":"<staff UUID>","organizationId":"<org UUID>","teamIds":["<team UUID>"],"pageIds":["<Meta ID>"],"permissions":["social_inbox.reply_send"],"expiresAt":1795755600000,"requestId":"<same UUID>"}
```

The example timestamp is illustrative; actual decisions expire5s after the
server clock. An unauthorized decision omits effective Page/team/permission
grants. Backend uncertainty returns503 and becomes `access_unknown`, not a
confirmed revocation. The service-only `get_social_access_recheck` RPC evaluates
current profile, organization, permissions, Page, team/link/membership, explicit
Page override and feature flags. Authenticated/anonymous callers cannot invoke
that arbitrary-subject RPC. No browser JWT or credential is persisted in queues.

The bot enforces its5s deadline even if a transport ignores AbortSignal before
headers or while reading the body. A held job cannot block the next authorized
job. Late bodies/rejections cannot authorize an expired request.

## Evidence and boundaries

- `social-delivery-local.json`:8 actual local Auth/PostgREST/PG/HTTP/SQLite checks
  PASS. Draft/edit/approve/send, one mock delivery, replay, post-enqueue team
  revocation, restart and real RPC privilege failure are covered. Meta calls0.
- `hosted-social-access-expiry-20261127.json`:11 hosted Auth/RLS/Edge checks PASS,
  0 FAIL/SKIPPED, including a genuinely expired previously valid signed JWT.
  Owned synthetic Auth/profile/Page/team/role/org cleanupPASS, remaining0.
- `hosted-social-access-staging-origin-20261127.json`:10 PASS with the final
  staging-only CORS origin. The repeated expiry case is explicitly skipped after
  restoring the normal TTL; the separate genuine-expiry proof remains above.
- `browser-erp-acceptance.json`:27 fresh local browser checksPASS with17
  migrations, real Auth/PostgREST/PG/Mailpit and synthetic data only.
- `hosted-erp-browser-final-20261127.json`:15 hosted Chromium/Auth/PostgREST
  checksPASS,0FAIL,1SKIPPED. Actual product/warehouse/stock/order/lead/delivery/
  cashflow, reload, audit, permission revocation and logout are verified against
  the public staging site and real isolated backend. External recovery/invitation
  email is skipped; real local Mailpit evidence covers those flows separately.
  All owned synthetic fixtures were removed. Two earlier runner failures
  (modern-public-key comparison and canonical login screenshot URL) were fixed;
  the final run is authoritative. The public empty login screenshot contains no
  credentials or authorized shell.
- Static HTTP checks return200 for the app/runtime,404 for legacy catalog,
  environment and server config. Staging-only `Cache-Control: no-store` was
  saved and observed after CDN propagation; production headers were untouched.
- Current TAP files record the full unit and PostgreSQL regressions. PostgreSQL
  evidence now includes the actual child exit status and uses a unique path per
  run; stale or failed evidence cannot make the sandbox bundle appear ready.
- Final ERP regression:184PASS/0FAIL/2SKIPPED; full real PostgreSQL15 regression:
  253PASS/0FAIL/2SKIPPED. The focused DB run is69PASS/0FAIL/1own-assigned-policy
  SKIP. A new18-migration/29-file offline bundle was built from fresh evidence.
- Final hardening migration removes direct PUBLIC/anon execution on three Auth
  helpers and removes client execution on the profile trigger helper. Actual
  authenticated RLS, invitations/profile trigger and core CRUD still pass.
  Hosted direct anonymous calls return SQLSTATE42501, and anonymous SECURITY
  DEFINER advisor findings fell from4 to0. The remaining18 signed-in definer
  warnings cover intentional guarded RPCs; do not blanket-revoke or convert them
  to invoker. See `sandbox-security-advisors-20261127.json` and
  [Supabase's advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- `hosted-erp-browser-hardened-20261127.json` repeats15PASS/0FAIL/1emailSKIP
  after hardening. `hosted-social-access-hardened-20261127.json` repeats10PASS
  after hardening; its already-proven signed expiry is not repeated at3600s.
- `erp-staging-preview.json` records the prepared public-only static artifact
  and unavailable Vercel login. Render is the working alternative; a Vercel
  login is not needed to continue this staging plan.

## Remaining gates and rollback

The private Bot repository is not available to the connected Render GitHub app:
it can currently access only the older thesanjiandinjasti-art repository. Do not
publish the private repository or silently push its code to the older owner.
The scoped Bot Bearer and no-send Render environment are generated in a private
Windows ACL directory outside Git/OneDrive, but **not installed in a new Render
service yet**. New Bot hosted acceptance is blocked on repository-scoped access.
Free ephemeral storage cannot prove hosted SQLite persistence. The existing
unchanged bot already has0.5CPU/512MB compute and a1GB `/var/data` disk; no new
paid purchase was made. Its visible snapshot is not a restore rehearsal.

Production backup inventory returned0 visible backups and PITRdisabled. No
existing PostgreSQL credential was found in the approved project/private files.
A strictly read-only production dump/PG17 restore is therefore BLOCKED. Do not
use CLI temporary-login creation against production without separate approval.
`production-backup-readonly-20261127.json` records this limitation.

Safe rollback keeps all new send flags false, disables the isolated connector,
and serves the previous reviewed static build. Leave additive schema/data in
place until a reviewed migration/restore is approved. Local transaction rollback
already verifies function definitions/ACL restoration, and local pg_dump/restore
preserves data, audit and idempotency. No destructive production down migration
or unverified production backup restore is prepared as an automatic action.

Meta UI observation found Khorooolol390502957490832 subscribed to `messages`,
v27.0 and the existing Render webhook. The local token belongs to another Page;
it was not used. Meta now requires developer-account confirmation. Token
validity, current Business AI state and real delivery remain unverified. Do not
click Meta Test against the existing live callback: it could trigger a reply.

After repository access and account/backup prerequisites are resolved, finish
the separate Bot hosted reader/dry-run and cross-service acceptance first.
Production migration/deploy, real Messenger sends and any paid resource remain
separate explicit owner approvals, after backup/rollback/authorization gates.
